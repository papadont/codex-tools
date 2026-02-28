"use strict";

const { StorageAdapter } = require("./base");
const { extensionFromMimeType } = require("./local_adapter");

const DEFAULT_SIGNED_URL_TTL_MS = 15 * 60 * 1000;

class FirebaseAdapter extends StorageAdapter {
  constructor(options = {}) {
    super("firebase");
    this.db = options.db || null;
    this.collection = options.collection || "codex-memo";
    this.admin = options.admin || null;
    this.bucketName = options.bucketName || process.env.CODEX_MEMO_FIREBASE_BUCKET || "";
    this.bucketInstance = options.bucket || null;
    this.signedUrlTtlMs = Number(options.signedUrlTtlMs || DEFAULT_SIGNED_URL_TTL_MS);
  }

  async saveMemo(_input) {
    return;
  }

  async loadMemo(_memoId) {
    return null;
  }

  bucket() {
    if (this.bucketInstance) return this.bucketInstance;
    if (!this.bucketName) {
      throw new Error("CODEX_MEMO_FIREBASE_BUCKET is not set.");
    }
    if (!this.admin || typeof this.admin.storage !== "function") {
      throw new Error("Firebase storage is not available.");
    }
    this.bucketInstance = this.admin.storage().bucket(this.bucketName);
    return this.bucketInstance;
  }

  attachmentPath(memoId, attachmentId, mimeType = "application/octet-stream") {
    const ext = extensionFromMimeType(mimeType);
    return `memos/${memoId}/attachments/${attachmentId}.${ext}`;
  }

  async saveAttachment(input) {
    const objectPath = this.attachmentPath(input.memoId, input.attachmentId, input.mimeType);
    const bucket = this.bucket();
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
    await bucket.file(objectPath).save(bytes, {
      resumable: false,
      metadata: {
        contentType: input.mimeType || "application/octet-stream"
      }
    });
    return {
      id: input.attachmentId,
      kind: "image",
      fileName: input.fileName ? String(input.fileName) : "",
      mimeType: input.mimeType || "application/octet-stream",
      size: bytes.byteLength,
      width: input.width === undefined ? undefined : Number(input.width),
      height: input.height === undefined ? undefined : Number(input.height),
      storagePath: objectPath,
      createdAtISO: new Date().toISOString()
    };
  }

  async deleteAttachment(memoId, attachmentId) {
    const [files] = await this.bucket().getFiles({
      prefix: `memos/${memoId}/attachments/${attachmentId}.`
    });
    await Promise.all(files.map((file) => file.delete().catch(() => {})));
    return;
  }

  async resolveAttachmentUrl(input) {
    const objectPath = String(
      input?.attachment?.storagePath
      || this.attachmentPath(input.memoId, input.attachmentId, input?.attachment?.mimeType)
    );
    if (!objectPath) return null;
    const file = this.bucket().file(objectPath);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + this.signedUrlTtlMs
    });
    return url;
  }

  async deleteMemo(memoId) {
    const [files] = await this.bucket().getFiles({
      prefix: `memos/${memoId}/`
    });
    await Promise.all(files.map((file) => file.delete().catch(() => {})));
  }

  async copyMemoTo(targetAdapter, payload) {
    const resolvedMemoId = String(payload?.memoId || "");
    if (!resolvedMemoId) {
      throw new Error("copyMemoTo requires memoId for firebase.");
    }
    const memoBody = String(payload.memoBody || "");
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const bucket = this.bucket();
    const copiedAttachments = [];
    for (const item of attachments) {
      const objectPath = String(item.storagePath || this.attachmentPath(resolvedMemoId, item.id, item.mimeType));
      const [bytes] = await bucket.file(objectPath).download();
      const saved = await targetAdapter.saveAttachment({
        memoId: resolvedMemoId,
        attachmentId: item.id,
        fileName: item.fileName,
        mimeType: item.mimeType,
        bytes,
        width: item.width,
        height: item.height
      });
      copiedAttachments.push({
        ...item,
        ...saved,
        caption: item.caption || saved.caption || ""
      });
    }
    await targetAdapter.saveMemo({
      memoId: resolvedMemoId,
      memoBody,
      attachments: copiedAttachments
    });
    return {
      memoBody,
      attachments: copiedAttachments
    };
  }
}

module.exports = {
  FirebaseAdapter
};
