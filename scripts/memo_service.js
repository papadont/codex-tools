"use strict";

const { normalizeStorageKind } = require("./runtime_config");
const { normalizeAttachments, syncMemoBodyAndAttachments } = require("./memo_sync_service");

function createMemoService({ db, collection, runtimeConfig, adapterRegistry, admin, toMemoDto }) {
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
    const payload = {
      projectName: input.projectName,
      memoType: input.memoType,
      memoBody: persistResult.normalizedBody,
      threadTitle: input.threadTitle,
      deletable: Boolean(input.deletable),
      pinned: Boolean(input.pinned),
      storageKind,
      attachments: persistResult.attachments,
      datetime: admin.firestore.Timestamp.fromDate(now),
      createdAtISO: now.toISOString(),
      updatedAtISO: now.toISOString(),
      createdBy: input.createdBy || "codex-memo-web",
      sourceThread: input.sourceThread || process.cwd()
    };

    await ref.set(payload);
    const created = await ref.get();
    return normalizeMemoRecord(created);
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
    updateMemo,
    deleteMemo
  };
}

module.exports = {
  createMemoService
};
