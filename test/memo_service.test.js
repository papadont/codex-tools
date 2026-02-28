"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { createMemoService } = require("../scripts/memo_service");
const { createAdapterRegistry } = require("../scripts/adapter_registry");

function createTimestamp(date) {
  return {
    toDate() {
      return date;
    }
  };
}

function createFirestoreMock(initialDocs = {}) {
  const docs = new Map(Object.entries(initialDocs).map(([id, data]) => [id, { ...data }]));
  let idCounter = 0;

  function snapshotFor(id) {
    const data = docs.get(id);
    return {
      id,
      exists: data !== undefined,
      data() {
        return data === undefined ? undefined : { ...data };
      }
    };
  }

  return {
    collection() {
      return {
        doc(id) {
          const docId = id || `doc_${++idCounter}`;
          return {
            id: docId,
            async get() {
              return snapshotFor(docId);
            },
            async set(payload) {
              docs.set(docId, { ...payload });
            },
            async update(patch) {
              const current = docs.get(docId);
              if (!current) throw new Error("Document does not exist");
              docs.set(docId, { ...current, ...patch });
            },
            async delete() {
              docs.delete(docId);
            }
          };
        },
        limit() {
          return {
            async get() {
              return {
                docs: Array.from(docs.entries()).map(([id]) => snapshotFor(id))
              };
            }
          };
        }
      };
    }
  };
}

class FakeBucketFile {
  constructor(bucket, name) {
    this.bucket = bucket;
    this.name = name;
  }

  async save(bytes, options = {}) {
    const buffer = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes);
    this.bucket.objects.set(this.name, {
      bytes: buffer,
      metadata: options.metadata || {}
    });
  }

  async exists() {
    return [this.bucket.objects.has(this.name)];
  }

  async getSignedUrl(options = {}) {
    return [`https://signed.example/${encodeURIComponent(this.name)}?expires=${encodeURIComponent(String(options.expires || ""))}`];
  }

  async delete() {
    this.bucket.objects.delete(this.name);
  }

  async download() {
    const object = this.bucket.objects.get(this.name);
    if (!object) {
      const error = new Error(`Object not found: ${this.name}`);
      error.code = 404;
      throw error;
    }
    return [Buffer.from(object.bytes)];
  }
}

class FakeBucket {
  constructor(name = "test-bucket") {
    this.name = name;
    this.objects = new Map();
  }

  file(name) {
    return new FakeBucketFile(this, name);
  }

  async getFiles(options = {}) {
    const prefix = String(options.prefix || "");
    return [[...this.objects.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => this.file(name))];
  }
}

function createAdminMock(bucket = null) {
  return {
    firestore: {
      Timestamp: {
        fromDate(date) {
          return createTimestamp(date);
        }
      }
    },
    storage() {
      return {
        bucket(name) {
          if (!bucket) {
            throw new Error(`Missing fake bucket for ${name}`);
          }
          return bucket;
        }
      };
    }
  };
}

function toMemoDto(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    datetimeISO: data.datetime && typeof data.datetime.toDate === "function"
      ? data.datetime.toDate().toISOString()
      : data.datetimeISO || data.createdAtISO || ""
  };
}

async function readPathIfExists(targetPath) {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function createServiceContext({ docs = {}, icloudDir, bucket, bucketName = "test-bucket" }) {
  const admin = createAdminMock(bucket);
  const adapterRegistry = createAdapterRegistry({
    icloud: { baseDir: icloudDir },
    firebase: { admin, bucket, bucketName }
  });
  const db = createFirestoreMock(docs);
  const memoService = createMemoService({
    db,
    collection: "codex-memo",
    runtimeConfig: {
      allowedAdapters: ["icloud", "firebase"],
      defaultStorageKind: "firebase"
    },
    adapterRegistry,
    admin,
    toMemoDto
  });
  return { admin, adapterRegistry, db, memoService };
}

test("iCloud -> Firebase migration rewrites attachment metadata and removes source files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memo-service-"));
  const icloudDir = path.join(root, "icloud");
  const bucket = new FakeBucket();
  const memoId = "memo_icloud_to_firebase";
  const attachmentId = "att_demo";
  const now = new Date("2026-02-28T00:00:00.000Z");

  const { adapterRegistry, memoService } = createServiceContext({
    docs: {
      [memoId]: {
        projectName: "codex-tools",
        memoType: "memo",
        memoBody: "![demo](attachment://att_demo)",
        threadTitle: "migration test",
        storageKind: "icloud",
        attachments: [],
        datetime: createTimestamp(now),
        createdAtISO: now.toISOString(),
        updatedAtISO: now.toISOString()
      }
    },
    icloudDir,
    bucket
  });

  const icloudAdapter = adapterRegistry.getAdapter("icloud");
  const savedAttachment = await icloudAdapter.saveAttachment({
    memoId,
    attachmentId,
    fileName: "demo.png",
    mimeType: "image/png",
    bytes: Buffer.from("demo")
  });
  await icloudAdapter.saveMemo({
    memoId,
    memoBody: "![demo](attachment://att_demo)",
    attachments: [savedAttachment]
  });

  const updated = await memoService.updateMemo(memoId, {
    projectName: "codex-tools",
    memoType: "memo",
    memoBody: "![demo](attachment://att_demo)",
    threadTitle: "migration test",
    storageKind: "firebase",
    attachments: [savedAttachment]
  });

  assert.equal(updated.storageKind, "firebase");
  assert.equal(updated.attachments.length, 1);
  assert.equal(updated.attachments[0].storagePath, "memos/memo_icloud_to_firebase/attachments/att_demo.png");
  assert.equal(bucket.objects.has(updated.attachments[0].storagePath), true);
  assert.equal(await readPathIfExists(path.join(icloudDir, memoId, "body.md")), null);

  await fs.rm(root, { recursive: true, force: true });
});

test("Firebase -> iCloud migration rewrites attachment metadata and removes source objects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memo-service-"));
  const icloudDir = path.join(root, "icloud");
  const bucket = new FakeBucket();
  const memoId = "memo_firebase_to_icloud";
  const attachmentId = "att_demo";
  const now = new Date("2026-02-28T00:00:00.000Z");

  const { adapterRegistry, memoService } = createServiceContext({
    docs: {
      [memoId]: {
        projectName: "codex-tools",
        memoType: "memo",
        memoBody: "![demo](attachment://att_demo)",
        threadTitle: "migration reverse test",
        storageKind: "firebase",
        attachments: [],
        datetime: createTimestamp(now),
        createdAtISO: now.toISOString(),
        updatedAtISO: now.toISOString()
      }
    },
    icloudDir,
    bucket
  });

  const firebaseAdapter = adapterRegistry.getAdapter("firebase");
  const savedAttachment = await firebaseAdapter.saveAttachment({
    memoId,
    attachmentId,
    fileName: "demo.png",
    mimeType: "image/png",
    bytes: Buffer.from("demo")
  });

  const updated = await memoService.updateMemo(memoId, {
    projectName: "codex-tools",
    memoType: "memo",
    memoBody: "![demo](attachment://att_demo)",
    threadTitle: "migration reverse test",
    storageKind: "icloud",
    attachments: [savedAttachment]
  });

  assert.equal(updated.storageKind, "icloud");
  assert.equal(updated.attachments.length, 1);
  assert.match(updated.attachments[0].storagePath, new RegExp(`${path.sep}icloud${path.sep}`));
  assert.equal(bucket.objects.size, 0);
  assert.equal(
    await readPathIfExists(path.join(icloudDir, memoId, "body.md")),
    "![demo](attachment://att_demo)"
  );

  await fs.rm(root, { recursive: true, force: true });
});

test("Attachment-less iCloud -> Firebase migration succeeds", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memo-service-"));
  const icloudDir = path.join(root, "icloud");
  const bucket = new FakeBucket();
  const memoId = "memo_no_attachments";
  const now = new Date("2026-02-28T00:00:00.000Z");

  const { adapterRegistry, memoService } = createServiceContext({
    docs: {
      [memoId]: {
        projectName: "codex-tools",
        memoType: "memo",
        memoBody: "plain body",
        threadTitle: "plain migration test",
        storageKind: "icloud",
        attachments: [],
        datetime: createTimestamp(now),
        createdAtISO: now.toISOString(),
        updatedAtISO: now.toISOString()
      }
    },
    icloudDir,
    bucket
  });

  await adapterRegistry.getAdapter("icloud").saveMemo({
    memoId,
    memoBody: "plain body",
    attachments: []
  });

  const updated = await memoService.updateMemo(memoId, {
    projectName: "codex-tools",
    memoType: "memo",
    memoBody: "plain body",
    threadTitle: "plain migration test",
    storageKind: "firebase",
    attachments: []
  });

  assert.equal(updated.storageKind, "firebase");
  assert.deepEqual(updated.attachments, []);
  assert.equal(bucket.objects.size, 0);

  await fs.rm(root, { recursive: true, force: true });
});

test("createMemo persists Firebase attachments from dataUrl and strips transient fields", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memo-service-"));
  const icloudDir = path.join(root, "icloud");
  const bucket = new FakeBucket();

  const { memoService } = createServiceContext({
    docs: {},
    icloudDir,
    bucket
  });

  const created = await memoService.createMemo({
    projectName: "codex-tools",
    memoType: "memo",
    memoBody: "![demo](attachment://att_new)",
    threadTitle: "create with attachment",
    storageKind: "firebase",
    attachments: [{
      id: "att_new",
      fileName: "demo.png",
      mimeType: "image/png",
      caption: "demo",
      dataUrl: "data:image/png;base64,ZGVtbw=="
    }]
  });

  assert.equal(created.storageKind, "firebase");
  assert.equal(created.attachments.length, 1);
  assert.equal(created.attachments[0].storagePath, `memos/${created.id}/attachments/att_new.png`);
  assert.equal(created.attachments[0].caption, "demo");
  assert.equal("dataUrl" in created.attachments[0], false);
  assert.equal(bucket.objects.has(created.attachments[0].storagePath), true);

  await fs.rm(root, { recursive: true, force: true });
});

test("updateMemo removes unreferenced Firebase attachments and source objects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memo-service-"));
  const icloudDir = path.join(root, "icloud");
  const bucket = new FakeBucket();
  const memoId = "memo_remove_attachment";
  const now = new Date("2026-02-28T00:00:00.000Z");

  const { memoService } = createServiceContext({
    docs: {
      [memoId]: {
        projectName: "codex-tools",
        memoType: "memo",
        memoBody: "![demo](attachment://att_demo)",
        threadTitle: "remove attachment test",
        storageKind: "firebase",
        attachments: [{
          id: "att_demo",
          kind: "image",
          fileName: "demo.png",
          mimeType: "image/png",
          size: 4,
          caption: "demo",
          storagePath: `memos/${memoId}/attachments/att_demo.png`,
          createdAtISO: now.toISOString()
        }],
        datetime: createTimestamp(now),
        createdAtISO: now.toISOString(),
        updatedAtISO: now.toISOString()
      }
    },
    icloudDir,
    bucket
  });

  bucket.objects.set(`memos/${memoId}/attachments/att_demo.png`, {
    bytes: Buffer.from("demo"),
    metadata: { contentType: "image/png" }
  });

  const updated = await memoService.updateMemo(memoId, {
    projectName: "codex-tools",
    memoType: "memo",
    memoBody: "plain body",
    threadTitle: "remove attachment test",
    attachments: []
  });

  assert.deepEqual(updated.attachments, []);
  assert.equal(bucket.objects.size, 0);

  await fs.rm(root, { recursive: true, force: true });
});

test("Firebase adapter saves attachments and returns signed URLs", async () => {
  const bucket = new FakeBucket();
  const admin = createAdminMock(bucket);
  const adapterRegistry = createAdapterRegistry({
    firebase: { admin, bucket, bucketName: "test-bucket" }
  });
  const firebaseAdapter = adapterRegistry.getAdapter("firebase");

  const saved = await firebaseAdapter.saveAttachment({
    memoId: "memo_a",
    attachmentId: "att_a",
    fileName: "demo.png",
    mimeType: "image/png",
    bytes: Buffer.from("demo")
  });
  const url = await firebaseAdapter.resolveAttachmentUrl({
    memoId: "memo_a",
    attachmentId: "att_a",
    attachment: saved
  });

  assert.equal(saved.storagePath, "memos/memo_a/attachments/att_a.png");
  assert.match(url, /^https:\/\/signed\.example\//);
});

test("Firebase attachment delete is idempotent", async () => {
  const bucket = new FakeBucket();
  const admin = createAdminMock(bucket);
  const adapterRegistry = createAdapterRegistry({
    firebase: { admin, bucket, bucketName: "test-bucket" }
  });
  const firebaseAdapter = adapterRegistry.getAdapter("firebase");

  await firebaseAdapter.deleteAttachment("memo_missing", "att_missing");
  assert.equal(bucket.objects.size, 0);
});

test("Firebase attachment operations require bucket configuration", async () => {
  const admin = createAdminMock();
  const adapterRegistry = createAdapterRegistry({
    firebase: { admin, bucketName: "" }
  });
  const firebaseAdapter = adapterRegistry.getAdapter("firebase");

  await assert.rejects(
    firebaseAdapter.saveAttachment({
      memoId: "memo_a",
      attachmentId: "att_a",
      fileName: "demo.png",
      mimeType: "image/png",
      bytes: Buffer.from("demo")
    }),
    /CODEX_MEMO_FIREBASE_BUCKET is not set/
  );
});

test("Local storage memos are excluded from visible records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memo-service-"));
  const icloudDir = path.join(root, "icloud");
  const bucket = new FakeBucket();
  const now = new Date("2026-02-28T00:00:00.000Z");

  const { memoService } = createServiceContext({
    docs: {
      memo_local_legacy: {
        projectName: "codex-tools",
        memoType: "memo",
        memoBody: "legacy local memo",
        threadTitle: "legacy",
        storageKind: "local",
        attachments: [],
        datetime: createTimestamp(now),
        createdAtISO: now.toISOString(),
        updatedAtISO: now.toISOString()
      }
    },
    icloudDir,
    bucket
  });

  const listed = await memoService.listMemos(10);
  const loaded = await memoService.getMemo("memo_local_legacy");
  assert.deepEqual(listed, []);
  assert.equal(loaded, null);

  await fs.rm(root, { recursive: true, force: true });
});
