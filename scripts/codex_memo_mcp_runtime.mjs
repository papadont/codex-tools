import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");
const { createAdapterRegistry } = require("./adapter_registry");
const { createMemoService } = require("./memo_service");
const { normalizeAttachments } = require("./memo_sync_service");
const { normalizeStorageKind } = require("./runtime_config");

const COLLECTION = "codex-memo";

function toMemoDto(doc) {
  const data = doc.data() || {};
  const datetime = data.datetime && typeof data.datetime.toDate === "function"
    ? data.datetime.toDate()
    : null;
  let storageKind;
  try {
    storageKind = normalizeStorageKind(data.storageKind, "firebase");
  } catch (_error) {
    storageKind = String(data.storageKind || "firebase").trim().toLowerCase() || "firebase";
  }
  return {
    id: doc.id,
    projectName: data.projectName || "",
    memoType: data.memoType || "memo",
    memoBody: data.memoBody || "",
    threadTitle: data.threadTitle || "",
    storageKind,
    attachments: normalizeAttachments(data.attachments),
    deletable: Boolean(data.deletable),
    pinned: Boolean(data.pinned),
    createdAtISO: data.createdAtISO || (datetime ? datetime.toISOString() : null),
    updatedAtISO: data.updatedAtISO || null,
    createdBy: data.createdBy || "",
    sourceThread: data.sourceThread || "",
    datetimeISO: datetime ? datetime.toISOString() : null
  };
}

export function createFirebaseMemoService(options = {}) {
  const requireCredentials = Boolean(options.requireCredentials);
  const requireBucket = Boolean(options.requireBucket);
  if (requireCredentials && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required.");
  }
  const bucketName = String(process.env.CODEX_MEMO_FIREBASE_BUCKET || "").trim();
  if (requireBucket && !bucketName) throw new Error("CODEX_MEMO_FIREBASE_BUCKET is required.");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      storageBucket: bucketName || undefined
    });
  }
  const db = admin.firestore();
  const bucket = admin.storage().bucket(bucketName || undefined);
  const adapterRegistry = createAdapterRegistry({
    firebase: { db, collection: COLLECTION, admin, bucket, bucketName }
  });
  const memoService = createMemoService({
    db,
    collection: COLLECTION,
    runtimeConfig: {
      storageMode: "fixed",
      fixedAdapter: "firebase",
      defaultStorageKind: "firebase",
      availableAdapters: ["firebase"],
      allowedAdapters: ["firebase"]
    },
    adapterRegistry,
    admin,
    toMemoDto
  });

  memoService.updateTextMemoIfUnchanged = async (id, expectedUpdatedAtISO, input) => {
    const ref = db.collection(COLLECTION).doc(id);
    const outcome = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { status: "missing" };
      const current = toMemoDto(snapshot);
      if (current.storageKind !== "firebase") return { status: "unsupported", current };
      if (String(current.updatedAtISO || "") !== expectedUpdatedAtISO) {
        return { status: "conflict", current };
      }
      const patch = {
        memoBody: input.memoBody === undefined ? current.memoBody : input.memoBody,
        threadTitle: input.threadTitle === undefined ? current.threadTitle : input.threadTitle,
        updatedAtISO: new Date().toISOString()
      };
      transaction.update(ref, patch);
      return { status: "updated" };
    });
    if (outcome.status !== "updated") return outcome;
    return { status: "updated", updated: toMemoDto(await ref.get()) };
  };

  return memoService;
}
