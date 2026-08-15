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
  const collections = new Map([
    ["codex-memo", new Map(Object.entries(initialDocs).map(([id, data]) => [id, { ...data }]))]
  ]);
  let idCounter = 0;
  let transactionTail = Promise.resolve();

  function docsFor(collectionName) {
    if (!collections.has(collectionName)) collections.set(collectionName, new Map());
    return collections.get(collectionName);
  }

  function snapshotFor(collectionName, id) {
    const docs = docsFor(collectionName);
    const data = docs.get(id);
    return {
      id,
      exists: data !== undefined,
      data() {
        return data === undefined ? undefined : { ...data };
      }
    };
  }

  function queryFor(collectionName, entries) {
    return {
      async get() {
        return {
          docs: entries.map(([id]) => snapshotFor(collectionName, id))
        };
      },
      count() {
        return {
          async get() {
            return {
              data() {
                return { count: entries.length };
              }
            };
          }
        };
      },
      limit() {
        return {
          async get() {
            return {
              docs: entries.map(([id]) => snapshotFor(collectionName, id))
            };
          }
        };
      }
    };
  }

  return {
    collection(collectionName) {
      const docs = docsFor(collectionName);
      return {
        ...queryFor(collectionName, Array.from(docs.entries())),
        doc(id) {
          const docId = id || `doc_${++idCounter}`;
          return {
            id: docId,
            collectionName,
            async get() {
              return snapshotFor(collectionName, docId);
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
        where(field, operator, value) {
          assert.equal(operator, "==");
          return queryFor(
            collectionName,
            Array.from(docs.entries()).filter(([, data]) => data[field] === value)
          );
        }
      };
    },
    async runTransaction(callback) {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const operations = [];
      const transaction = {
        async get(ref) {
          return snapshotFor(ref.collectionName, ref.id);
        },
        set(ref, payload) {
          operations.push(["set", ref, payload]);
        },
        update(ref, patch) {
          operations.push(["update", ref, patch]);
        },
        delete(ref) {
          operations.push(["delete", ref]);
        }
      };
      try {
        const result = await callback(transaction);
        for (const [operation, ref, value] of operations) {
          const docs = docsFor(ref.collectionName);
          if (operation === "set") docs.set(ref.id, { ...value });
          if (operation === "update") {
            const current = docs.get(ref.id);
            if (!current) throw new Error("Document does not exist");
            docs.set(ref.id, { ...current, ...value });
          }
          if (operation === "delete") docs.delete(ref.id);
        }
        return result;
      } finally {
        release();
      }
    }
  };
}

test("countMemosByStorageKind includes legacy missing storageKind as Firebase", async () => {
  const { memoService } = createServiceContext({
    docs: {
      firebase: { storageKind: "firebase" },
      icloud: { storageKind: "icloud" },
      local: { storageKind: "local" },
      legacy: {}
    }
  });

  assert.deepEqual(await memoService.countMemosByStorageKind(), {
    total: 3,
    firebase: 2,
    icloud: 1
  });
});

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

function createServiceContext({ docs = {}, icloudDir, archiveBaseDir, bucket, bucketName = "test-bucket" }) {
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
    toMemoDto,
    archiveBaseDir
  });
  return { admin, adapterRegistry, db, memoService };
}

test("Firebase memo archive verifies a portable local package before deleting Firebase data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memo-archive-"));
  const archiveBaseDir = path.join(root, "archive");
  const bucket = new FakeBucket();
  const memoId = "memo_archive_demo";
  const attachmentId = "att_archive_demo";
  const updatedAtISO = "2026-08-15T01:00:00.000Z";
  const { memoService, adapterRegistry } = createServiceContext({
    docs: {
      [memoId]: {
        projectName: "codex-tools",
        memoType: "memo",
        memoBody: "![archive](attachment://att_archive_demo)",
        threadTitle: "archive test",
        storageKind: "firebase",
        attachments: [],
        createdAtISO: updatedAtISO,
        updatedAtISO
      }
    },
    archiveBaseDir,
    bucket
  });
  const attachment = await adapterRegistry.getAdapter("firebase").saveAttachment({
    memoId,
    attachmentId,
    fileName: "archive.png",
    mimeType: "image/png",
    bytes: Buffer.from("archive bytes")
  });
  await memoService.updateMemo(memoId, {
    projectName: "codex-tools",
    memoType: "memo",
    memoBody: "![archive](attachment://att_archive_demo)",
    threadTitle: "archive test",
    storageKind: "firebase",
    attachments: [attachment]
  });
  const current = await memoService.getMemo(memoId);

  const archived = await memoService.archiveMemo(memoId, {
    expectedUpdatedAtISO: current.updatedAtISO
  });

  assert.equal(archived.status, "archived");
  assert.equal(archived.deleted, true);
  assert.equal(await memoService.getMemo(memoId), null);
  assert.equal(bucket.objects.size, 0);
  const manifest = JSON.parse(await fs.readFile(path.join(archived.archivePath, "manifest.json"), "utf8"));
  const metadata = JSON.parse(await fs.readFile(path.join(archived.archivePath, "metadata.json"), "utf8"));
  assert.equal(manifest.memoId, memoId);
  assert.deepEqual(manifest.files.map((entry) => entry.path).sort(), [
    "attachments/att_archive_demo.png",
    "memo.md",
    "metadata.json"
  ]);
  assert.equal(metadata.memo.attachments[0].storagePath, undefined);
  assert.equal(metadata.memo.attachments[0].archivePath, "attachments/att_archive_demo.png");
  assert.equal(
    await fs.readFile(path.join(archived.archivePath, "attachments", "att_archive_demo.png"), "utf8"),
    "archive bytes"
  );
  await fs.rm(root, { recursive: true, force: true });
});

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

test("capture creation is transactionally idempotent and detects payload reuse", async () => {
  const bucket = new FakeBucket();
  const { memoService } = createServiceContext({ docs: {}, bucket });
  const input = {
    projectName: "codex-memo-macos",
    memoType: "memo",
    memoBody: "captured once",
    threadTitle: "capture",
    storageKind: "firebase",
    attachments: [],
    deletable: false,
    pinned: false,
    createdBy: "codex-memo-sites",
    sourceThread: "chatgpt-sites"
  };

  const [first, second] = await Promise.all([
    memoService.createMemoForCapture({
      captureID: "11111111-1111-4111-8111-111111111111",
      fingerprint: "same-fingerprint",
      input
    }),
    memoService.createMemoForCapture({
      captureID: "11111111-1111-4111-8111-111111111111",
      fingerprint: "same-fingerprint",
      input
    })
  ]);

  assert.deepEqual([first.status, second.status].sort(), ["created", "replayed"]);
  assert.equal(first.memo.id, second.memo.id);
  assert.equal((await memoService.listMemos(10)).length, 1);

  const reused = await memoService.createMemoForCapture({
    captureID: "11111111-1111-4111-8111-111111111111",
    fingerprint: "different-fingerprint",
    input: { ...input, memoBody: "different" }
  });
  assert.equal(reused.status, "reused");

  assert.equal(await memoService.deleteMemo(first.memo.id), true);
  const afterDeletion = await memoService.createMemoForCapture({
    captureID: "11111111-1111-4111-8111-111111111111",
    fingerprint: "same-fingerprint",
    input
  });
  assert.equal(afterDeletion.status, "gone");
  assert.equal((await memoService.listMemos(10)).length, 0);
});

test("conflict-safe memo update atomically applies metadata and preserves omissions", async () => {
  const updatedAtISO = "2026-07-30T00:00:00.000Z";
  const { memoService } = createServiceContext({
    docs: {
      "memo-gate-d": {
        projectName: "codex-tools",
        memoType: "memo",
        memoBody: "base body",
        threadTitle: "base title",
        storageKind: "firebase",
        attachments: [],
        createdAtISO: updatedAtISO,
        updatedAtISO
      }
    }
  });

  const first = await memoService.updateTextMemoIfUnchanged(
    "memo-gate-d",
    updatedAtISO,
    {
      memoBody: "updated body",
      threadTitle: "updated title",
      projectName: "codex-memo-macos",
      memoType: "keep"
    }
  );
  assert.equal(first.status, "updated");
  assert.equal(first.updated.projectName, "codex-memo-macos");
  assert.equal(first.updated.memoType, "keep");
  assert.equal(first.updated.memoBody, "updated body");
  assert.equal(first.updated.threadTitle, "updated title");

  const second = await memoService.updateTextMemoIfUnchanged(
    "memo-gate-d",
    first.updated.updatedAtISO,
    { memoBody: "text only" }
  );
  assert.equal(second.status, "updated");
  assert.equal(second.updated.projectName, "codex-memo-macos");
  assert.equal(second.updated.memoType, "keep");
  assert.equal(second.updated.memoBody, "text only");
  assert.equal(second.updated.threadTitle, "updated title");

  const conflict = await memoService.updateTextMemoIfUnchanged(
    "memo-gate-d",
    "stale",
    {
      memoBody: "stale body",
      threadTitle: "stale title",
      projectName: "stale-project",
      memoType: "propomemo"
    }
  );
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(conflict.current, second.updated);
  assert.deepEqual(await memoService.getMemo("memo-gate-d"), second.updated);
});

test("safe attachment mutations replay before checking stale preconditions", async () => {
  const bucket = new FakeBucket();
  const { memoService } = createServiceContext({ docs: {}, bucket });
  const memo = await memoService.createMemo({
    projectName: "codex-memo-macos",
    memoType: "memo",
    memoBody: "body",
    threadTitle: "attachments",
    storageKind: "firebase",
    attachments: []
  });
  const uploadInput = {
    memoId: memo.id,
    mutationID: "upload-queue-item-1",
    fingerprint: "upload-fingerprint",
    expectedUpdatedAtISO: memo.updatedAtISO,
    attachmentId: "att_safe",
    fileName: "safe.png",
    mimeType: "image/png",
    bytes: Buffer.from("safe image"),
    caption: "safe",
    maxAttachmentCount: 5
  };

  const [first, second] = await Promise.all([
    memoService.uploadAttachmentIfUnchanged(uploadInput),
    memoService.uploadAttachmentIfUnchanged(uploadInput)
  ]);
  assert.deepEqual([first.status, second.status].sort(), ["replayed", "updated"]);
  assert.equal(first.current.attachments.length, 1);
  assert.equal(second.current.attachments.length, 1);
  assert.equal(bucket.objects.size, 1);

  const replayedUpload = await memoService.uploadAttachmentIfUnchanged({
    ...uploadInput,
    expectedUpdatedAtISO: "stale"
  });
  assert.equal(replayedUpload.status, "replayed");

  const reusedUpload = await memoService.uploadAttachmentIfUnchanged({
    ...uploadInput,
    fingerprint: "different-upload-fingerprint"
  });
  assert.equal(reusedUpload.status, "reused");

  const staleUpload = await memoService.uploadAttachmentIfUnchanged({
    ...uploadInput,
    mutationID: "upload-queue-item-2",
    fingerprint: "second-upload-fingerprint",
    attachmentId: "att_safe_2",
    expectedUpdatedAtISO: "stale"
  });
  assert.equal(staleUpload.status, "conflict");

  const current = await memoService.getMemo(memo.id);
  const deleteInput = {
    memoId: memo.id,
    attachmentId: "att_safe",
    mutationID: "delete-queue-item-1",
    fingerprint: "delete-fingerprint",
    expectedUpdatedAtISO: current.updatedAtISO
  };
  const deleted = await memoService.deleteAttachmentIfUnchanged(deleteInput);
  assert.equal(deleted.status, "updated");
  assert.equal(deleted.current.attachments.length, 0);
  assert.equal(bucket.objects.size, 0);

  const replayedDelete = await memoService.deleteAttachmentIfUnchanged({
    ...deleteInput,
    expectedUpdatedAtISO: "stale"
  });
  assert.equal(replayedDelete.status, "replayed");
  assert.equal(replayedDelete.current.attachments.length, 0);

  const reusedDelete = await memoService.deleteAttachmentIfUnchanged({
    ...deleteInput,
    fingerprint: "different-delete-fingerprint"
  });
  assert.equal(reusedDelete.status, "reused");
});
