"use strict";

const { createHash } = require("node:crypto");
const { normalizeStorageKind } = require("./runtime_config");
const { normalizeAttachments, syncMemoBodyAndAttachments } = require("./memo_sync_service");

function createMemoService({ db, collection, runtimeConfig, adapterRegistry, admin, toMemoDto }) {
  const sitesIdempotencyCollection = `${collection}-sites-idempotency-v1`;

  function sitesReceiptId(kind, key) {
    return createHash("sha256").update(`${kind}\0${key}`).digest("hex");
  }

  function attachmentReference(attachmentId, caption) {
    const label = String(caption || "").trim().replace(/[\[\]]/g, "") || "image";
    return `![${label}](attachment://${attachmentId})`;
  }

  function removeAttachmentReference(memoBody, attachmentId) {
    const escapedId = String(attachmentId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`!?\\[[^\\]]*\\]\\(attachment:\/\/${escapedId}\\)[ \\t]*(?:\\r?\\n)?`, "g");
    return String(memoBody || "").replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  function memoPayload(input, storageKind, now) {
    return {
      projectName: input.projectName,
      memoType: input.memoType,
      memoBody: String(input.memoBody || ""),
      threadTitle: input.threadTitle,
      deletable: Boolean(input.deletable),
      pinned: Boolean(input.pinned),
      storageKind,
      attachments: normalizePersistedAttachments(input.attachments),
      datetime: admin.firestore.Timestamp.fromDate(now),
      createdAtISO: now.toISOString(),
      updatedAtISO: now.toISOString(),
      createdBy: input.createdBy || "codex-memo-web",
      sourceThread: input.sourceThread || process.cwd()
    };
  }

  function normalizeStorageKindLoose(raw, fallback = "firebase") {
    try {
      return normalizeStorageKind(raw, fallback);
    } catch (_error) {
      return String(raw || fallback).trim().toLowerCase() || fallback;
    }
  }

  function normalizePersistedAttachments(raw) {
    return normalizeAttachments(raw).map((item) => {
      const next = { ...item };
      delete next.dataUrl;
      delete next.dataBase64;
      delete next.previewUrl;
      return next;
    });
  }

  function normalizeMemoRecord(doc) {
    const memo = toMemoDto(doc);
    return {
      ...memo,
      storageKind: normalizeStorageKindLoose(memo.storageKind, "firebase"),
      attachments: normalizePersistedAttachments(memo.attachments)
    };
  }

  function isAllowedStorageKind(kind) {
    try {
      return runtimeConfig.allowedAdapters.includes(normalizeStorageKind(kind, "firebase"));
    } catch (_error) {
      return false;
    }
  }

  function assertAllowedStorageKind(kind) {
    if (!isAllowedStorageKind(kind)) {
      throw new Error(`storageKind ${kind} is not allowed in current mode.`);
    }
  }

  function canMigrateStorageKind(fromKind, toKind) {
    const from = normalizeStorageKind(fromKind, "firebase");
    const to = normalizeStorageKind(toKind, "firebase");
    if (from === to) return true;
    return (from === "icloud" && to === "firebase")
      || (from === "firebase" && to === "icloud");
  }

  function resolveCreateStorageKind(raw) {
    if (runtimeConfig.allowedAdapters.length === 1) {
      return runtimeConfig.allowedAdapters[0];
    }
    const fallback = runtimeConfig.defaultStorageKind || "firebase";
    return normalizeStorageKind(raw, fallback);
  }

  function decodeAttachmentBytes(item) {
    const dataUrl = String(item.dataUrl || "").trim();
    if (dataUrl) {
      const match = dataUrl.match(/^data:([^;,]+)?;base64,(.+)$/);
      if (!match) {
        throw new Error(`Invalid dataUrl for attachment ${item.id}.`);
      }
      return {
        mimeType: item.mimeType || match[1] || "application/octet-stream",
        bytes: Buffer.from(match[2], "base64")
      };
    }

    const dataBase64 = String(item.dataBase64 || "").trim();
    if (dataBase64) {
      return {
        mimeType: item.mimeType || "application/octet-stream",
        bytes: Buffer.from(dataBase64, "base64")
      };
    }

    return null;
  }

  async function ensureAttachmentFilesExist({ memoId, storageKind, attachments }) {
    const adapter = adapterRegistry.getAdapter(storageKind);
    for (const item of normalizeAttachments(attachments)) {
      const upload = decodeAttachmentBytes(item);
      if (upload) continue;
      const resolved = await adapter.resolveAttachmentUrl({
        memoId,
        attachmentId: item.id,
        attachment: item
      });
      if (!resolved) {
        throw new Error(`Attachment file missing for: ${item.id}`);
      }
    }
  }

  async function persistAdapterMemo(record) {
    const syncResult = syncMemoBodyAndAttachments({
      memoBody: record.memoBody,
      attachments: record.attachments
    });
    if (syncResult.duplicateAttachmentIds.length > 0) {
      throw new Error(`Duplicate attachment ids: ${syncResult.duplicateAttachmentIds.join(", ")}`);
    }
    if (syncResult.missingAttachmentIds.length > 0) {
      throw new Error(`Missing attachment metadata for: ${syncResult.missingAttachmentIds.join(", ")}`);
    }
    await ensureAttachmentFilesExist({
      memoId: record.id,
      storageKind: record.storageKind,
      attachments: syncResult.attachments
    });
    const adapter = adapterRegistry.getAdapter(record.storageKind);
    const previousAttachments = normalizeAttachments(record.previousAttachments);
    const persistedAttachments = [];
    for (const item of syncResult.attachments) {
      const upload = decodeAttachmentBytes(item);
      if (upload) {
        const saved = await adapter.saveAttachment({
          memoId: record.id,
          attachmentId: item.id,
          kind: item.kind,
          fileName: item.fileName,
          mimeType: upload.mimeType,
          bytes: upload.bytes,
          caption: item.caption,
          width: item.width,
          height: item.height
        });
        persistedAttachments.push({
          ...item,
          ...saved,
          caption: item.caption || saved.caption || ""
        });
        continue;
      }
      persistedAttachments.push(item);
    }

    const deletedAttachmentIds = new Set(syncResult.orphanAttachmentIds);
    const persistedAttachmentIds = new Set(persistedAttachments.map((item) => item.id));
    for (const item of previousAttachments) {
      if (!persistedAttachmentIds.has(item.id)) {
        deletedAttachmentIds.add(item.id);
      }
    }

    for (const attachmentId of deletedAttachmentIds) {
      await adapter.deleteAttachment(record.id, attachmentId);
    }

    const normalizedAttachments = normalizePersistedAttachments(persistedAttachments);
    await adapter.saveMemo({
      memoId: record.id,
      memoBody: syncResult.normalizedBody,
      attachments: normalizedAttachments
    });
    return {
      normalizedBody: syncResult.normalizedBody,
      attachments: normalizedAttachments
    };
  }

  async function migrateAdapterMemo({ memoId, memoBody, attachments, fromStorageKind, toStorageKind }) {
    if (fromStorageKind === toStorageKind) return;
    if (!canMigrateStorageKind(fromStorageKind, toStorageKind)) {
      throw new Error("storageKind migration is supported only between iCloud and Firestore.");
    }
    const sourceAdapter = adapterRegistry.getAdapter(fromStorageKind);
    const targetAdapter = adapterRegistry.getAdapter(toStorageKind);
    return sourceAdapter.copyMemoTo(targetAdapter, {
      memoId,
      memoBody,
      attachments
    });
  }

  async function listMemos(limit) {
    const snap = await db.collection(collection).limit(limit).get();
    return snap.docs
      .map(normalizeMemoRecord)
      .filter((memo) => isAllowedStorageKind(memo.storageKind));
  }

  async function countMemosByStorageKind() {
    const collectionRef = db.collection(collection);
    const [allSnap, icloudSnap, localSnap] = await Promise.all([
      collectionRef.count().get(),
      collectionRef.where("storageKind", "==", "icloud").count().get(),
      collectionRef.where("storageKind", "==", "local").count().get()
    ]);
    const total = Math.max(
      0,
      Number(allSnap.data().count || 0) - Number(localSnap.data().count || 0)
    );
    const icloud = Number(icloudSnap.data().count || 0);
    return {
      total,
      firebase: Math.max(0, total - icloud),
      icloud
    };
  }

  async function getMemo(id) {
    const doc = await db.collection(collection).doc(id).get();
    if (!doc.exists) return null;
    const memo = normalizeMemoRecord(doc);
    if (!isAllowedStorageKind(memo.storageKind)) {
      return null;
    }
    return memo;
  }

  async function createMemo(input) {
    const now = new Date();
    const storageKind = resolveCreateStorageKind(input.storageKind);
    assertAllowedStorageKind(storageKind);
    const requestedId = String(input.id || "").trim();
    const ref = requestedId ? db.collection(collection).doc(requestedId) : db.collection(collection).doc();
    const persistResult = await persistAdapterMemo({
      id: ref.id,
      memoBody: input.memoBody,
      storageKind,
      attachments: input.attachments,
      previousAttachments: []
    });
    const payload = memoPayload({
      ...input,
      memoBody: persistResult.normalizedBody,
      attachments: persistResult.attachments
    }, storageKind, now);

    await ref.set(payload);
    const created = await ref.get();
    return normalizeMemoRecord(created);
  }

  async function createMemoForCapture({ captureID, fingerprint, input }) {
    const storageKind = resolveCreateStorageKind(input.storageKind);
    assertAllowedStorageKind(storageKind);
    const syncResult = syncMemoBodyAndAttachments({
      memoBody: input.memoBody,
      attachments: input.attachments
    });
    if (syncResult.duplicateAttachmentIds.length > 0 || syncResult.missingAttachmentIds.length > 0) {
      throw new Error("Capture memo attachments are invalid.");
    }

    const receiptId = sitesReceiptId("capture", captureID);
    const memoId = `sites_${receiptId.slice(0, 32)}`;
    const receiptRef = db.collection(sitesIdempotencyCollection).doc(receiptId);
    const memoRef = db.collection(collection).doc(memoId);
    const now = new Date();
    const payload = memoPayload({
      ...input,
      memoBody: syncResult.normalizedBody,
      attachments: syncResult.attachments
    }, storageKind, now);

    const outcome = await db.runTransaction(async (transaction) => {
      const [receipt, memo] = await Promise.all([
        transaction.get(receiptRef),
        transaction.get(memoRef)
      ]);
      if (receipt.exists) {
        const data = receipt.data() || {};
        if (data.fingerprint !== fingerprint) return { status: "reused" };
        if (!memo.exists) return { status: "gone" };
        return { status: "replayed" };
      }
      if (memo.exists) return { status: "reused" };
      transaction.set(memoRef, payload);
      transaction.set(receiptRef, {
        kind: "capture",
        keyHash: receiptId,
        fingerprint,
        memoId,
        status: "success",
        createdAtISO: now.toISOString()
      });
      return { status: "created" };
    });

    if (outcome.status === "reused" || outcome.status === "gone") return outcome;
    const memo = await memoRef.get();
    if (!memo.exists) return { status: "gone" };
    return {
      status: outcome.status,
      memo: normalizeMemoRecord(memo)
    };
  }

  async function clearPendingAttachmentReceipt(receiptRef, fingerprint) {
    await db.runTransaction(async (transaction) => {
      const receipt = await transaction.get(receiptRef);
      if (!receipt.exists) return;
      const data = receipt.data() || {};
      if (data.status === "pending" && data.fingerprint === fingerprint) {
        transaction.delete(receiptRef);
      }
    });
  }

  async function uploadAttachmentIfUnchanged(input) {
    const memoRef = db.collection(collection).doc(input.memoId);
    const receiptId = sitesReceiptId("attachment", `${input.memoId}\0${input.mutationID}`);
    const receiptRef = db.collection(sitesIdempotencyCollection).doc(receiptId);
    const attachmentId = input.attachmentId;

    const preflight = await db.runTransaction(async (transaction) => {
      const [receipt, memo] = await Promise.all([
        transaction.get(receiptRef),
        transaction.get(memoRef)
      ]);
      if (receipt.exists) {
        const data = receipt.data() || {};
        if (data.fingerprint !== input.fingerprint) return { status: "reused" };
        if (!memo.exists) return { status: "missing" };
        if (data.status === "success") {
          return { status: "replayed", current: normalizeMemoRecord(memo) };
        }
        return { status: "pending" };
      }
      if (!memo.exists) return { status: "missing" };
      const current = normalizeMemoRecord(memo);
      if (current.storageKind !== "firebase") return { status: "missing" };
      if (String(current.updatedAtISO || "") !== input.expectedUpdatedAtISO) {
        return { status: "conflict", current };
      }
      if (current.attachments.length >= input.maxAttachmentCount) {
        return { status: "limit", current };
      }
      transaction.set(receiptRef, {
        kind: "attachment.upload",
        keyHash: receiptId,
        fingerprint: input.fingerprint,
        memoId: input.memoId,
        attachmentId,
        expectedUpdatedAtISO: input.expectedUpdatedAtISO,
        status: "pending",
        createdAtISO: new Date().toISOString()
      });
      return { status: "pending" };
    });

    if (preflight.status !== "pending") {
      if (preflight.status === "replayed") {
        const attachment = preflight.current.attachments.find((item) => item.id === attachmentId);
        if (!attachment) return { status: "reused" };
      }
      return preflight;
    }

    const adapter = adapterRegistry.getAdapter("firebase");
    let savedAttachment;
    try {
      savedAttachment = await adapter.saveAttachment({
        memoId: input.memoId,
        attachmentId,
        kind: "image",
        fileName: input.fileName,
        mimeType: input.mimeType,
        bytes: input.bytes,
        caption: input.caption
      });
    } catch (error) {
      await clearPendingAttachmentReceipt(receiptRef, input.fingerprint);
      throw error;
    }

    const finalized = await db.runTransaction(async (transaction) => {
      const [receipt, memo] = await Promise.all([
        transaction.get(receiptRef),
        transaction.get(memoRef)
      ]);
      if (!receipt.exists) return { status: "conflict" };
      const receiptData = receipt.data() || {};
      if (receiptData.fingerprint !== input.fingerprint) return { status: "reused" };
      if (!memo.exists) {
        transaction.delete(receiptRef);
        return { status: "missing" };
      }
      const current = normalizeMemoRecord(memo);
      if (receiptData.status === "success") return { status: "replayed", current };
      if (String(current.updatedAtISO || "") !== input.expectedUpdatedAtISO) {
        transaction.delete(receiptRef);
        return { status: "conflict", current };
      }
      if (current.attachments.length >= input.maxAttachmentCount) {
        transaction.delete(receiptRef);
        return { status: "limit", current };
      }
      const reference = attachmentReference(attachmentId, input.caption);
      const memoBody = `${String(current.memoBody || "").trim()}${current.memoBody ? "\n\n" : ""}${reference}`;
      const attachments = normalizePersistedAttachments([...current.attachments, savedAttachment]);
      const updatedAtISO = new Date().toISOString();
      transaction.update(memoRef, { memoBody, attachments, updatedAtISO });
      transaction.set(receiptRef, {
        ...receiptData,
        status: "success",
        completedAtISO: updatedAtISO
      });
      return { status: "updated" };
    });

    if (["conflict", "missing", "limit", "reused"].includes(finalized.status)) {
      await adapter.deleteAttachment(input.memoId, attachmentId);
      return finalized;
    }
    if (finalized.status === "replayed") {
      return finalized;
    }
    const updated = await memoRef.get();
    return {
      status: "updated",
      current: normalizeMemoRecord(updated)
    };
  }

  async function deleteAttachmentIfUnchanged(input) {
    const memoRef = db.collection(collection).doc(input.memoId);
    const receiptId = sitesReceiptId("attachment", `${input.memoId}\0${input.mutationID}`);
    const receiptRef = db.collection(sitesIdempotencyCollection).doc(receiptId);
    const outcome = await db.runTransaction(async (transaction) => {
      const [receipt, memo] = await Promise.all([
        transaction.get(receiptRef),
        transaction.get(memoRef)
      ]);
      if (receipt.exists) {
        const data = receipt.data() || {};
        if (data.fingerprint !== input.fingerprint) return { status: "reused" };
        if (!memo.exists) return { status: "missing" };
        if (data.status === "success") {
          return { status: "replayed", current: normalizeMemoRecord(memo) };
        }
      }
      if (!memo.exists) return { status: "missing" };
      const current = normalizeMemoRecord(memo);
      if (current.storageKind !== "firebase") return { status: "missing" };
      if (String(current.updatedAtISO || "") !== input.expectedUpdatedAtISO) {
        return { status: "conflict", current };
      }
      if (!current.attachments.some((item) => item.id === input.attachmentId)) {
        return { status: "attachment-missing", current };
      }
      const attachments = current.attachments.filter((item) => item.id !== input.attachmentId);
      const memoBody = removeAttachmentReference(current.memoBody, input.attachmentId);
      const updatedAtISO = new Date().toISOString();
      transaction.update(memoRef, { memoBody, attachments, updatedAtISO });
      transaction.set(receiptRef, {
        kind: "attachment.delete",
        keyHash: receiptId,
        fingerprint: input.fingerprint,
        memoId: input.memoId,
        attachmentId: input.attachmentId,
        status: "success",
        createdAtISO: updatedAtISO
      });
      return { status: "updated" };
    });

    if (outcome.status === "updated" || outcome.status === "replayed") {
      await adapterRegistry.getAdapter("firebase").deleteAttachment(input.memoId, input.attachmentId);
    }
    if (outcome.status === "updated") {
      const updated = await memoRef.get();
      return { status: "updated", current: normalizeMemoRecord(updated) };
    }
    return outcome;
  }

  async function updateMemo(id, input) {
    const ref = db.collection(collection).doc(id);
    const exists = await ref.get();
    if (!exists.exists) return null;

    const current = normalizeMemoRecord(exists);
    assertAllowedStorageKind(current.storageKind);
    const requestedStorageKind = input.storageKind === undefined
      ? current.storageKind
      : normalizeStorageKind(input.storageKind, current.storageKind);
    assertAllowedStorageKind(requestedStorageKind);
    if (
      requestedStorageKind !== current.storageKind
      && !canMigrateStorageKind(current.storageKind, requestedStorageKind)
    ) {
      throw new Error("storageKind migration is supported only between iCloud and Firestore.");
    }

    const persistResult = await persistAdapterMemo({
      id,
      memoBody: input.memoBody,
      storageKind: current.storageKind,
      attachments: input.attachments === undefined ? current.attachments : input.attachments,
      previousAttachments: current.attachments
    });
    const patch = {
      projectName: input.projectName,
      memoType: input.memoType,
      memoBody: persistResult.normalizedBody,
      threadTitle: input.threadTitle,
      storageKind: current.storageKind,
      attachments: persistResult.attachments,
      updatedAtISO: new Date().toISOString()
    };
    if (input.deletable !== undefined) patch.deletable = Boolean(input.deletable);
    if (input.pinned !== undefined) patch.pinned = Boolean(input.pinned);

    if (requestedStorageKind !== current.storageKind) {
      const migrationResult = await migrateAdapterMemo({
        memoId: id,
        memoBody: persistResult.normalizedBody,
        attachments: persistResult.attachments,
        fromStorageKind: current.storageKind,
        toStorageKind: requestedStorageKind
      });
      patch.storageKind = requestedStorageKind;
      patch.attachments = normalizePersistedAttachments(
        migrationResult?.attachments || persistResult.attachments
      );
    }

    await ref.update(patch);
    if (requestedStorageKind !== current.storageKind) {
      const previousAdapter = adapterRegistry.getAdapter(current.storageKind);
      await previousAdapter.deleteMemo(id).catch((error) => {
        console.warn(`[memo_service] failed to delete migrated source memo ${id}: ${error.message}`);
      });
    }
    const updated = await ref.get();
    return normalizeMemoRecord(updated);
  }

  async function deleteMemo(id) {
    const current = await getMemo(id);
    if (!current) return false;
    const adapter = adapterRegistry.getAdapter(current.storageKind);
    await adapter.deleteMemo(id);
    await db.collection(collection).doc(id).delete();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await db.collection(sitesIdempotencyCollection)
      .where("memoId", "==", id)
      .get()
      .then((snapshot) => Promise.all(snapshot.docs.map(async (doc) => {
        const receipt = doc.data() || {};
        if (!String(receipt.kind || "").startsWith("attachment.")) return;
        await db.collection(sitesIdempotencyCollection).doc(doc.id).update({
          memoDeletedAtISO: new Date().toISOString(),
          expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
          expiresAtISO: expiresAt.toISOString()
        });
      })))
      .catch((error) => {
        console.warn(`[memo_service] failed to mark attachment receipts for ${id}: ${error.message}`);
      });
    return true;
  }

  return {
    resolveCreateStorageKind,
    isAllowedStorageKind,
    assertAllowedStorageKind,
    canMigrateStorageKind,
    listMemos,
    countMemosByStorageKind,
    getMemo,
    createMemo,
    createMemoForCapture,
    uploadAttachmentIfUnchanged,
    deleteAttachmentIfUnchanged,
    updateMemo,
    deleteMemo
  };
}

module.exports = {
  createMemoService
};
