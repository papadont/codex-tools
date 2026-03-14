"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { StorageAdapter } = require("./base");

function extensionFromMimeType(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("png")) return "png";
  if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("pdf")) return "pdf";
  if (value.includes("json")) return "json";
  if (value.includes("plain")) return "txt";
  if (value.includes("markdown")) return "md";
  if (value.includes("zip")) return "zip";
  return "bin";
}

class LocalAdapter extends StorageAdapter {
  constructor(options = {}) {
    super(options.kind || "local");
    this.baseDir = options.baseDir
      || process.env.CODEX_MEMO_LOCAL_DIR
      || path.join(os.homedir(), ".codex-memo", this.kind);
  }

  memoDir(memoId) {
    return path.join(this.baseDir, memoId);
  }

  attachmentPath(memoId, attachmentId, mimeType = "application/octet-stream") {
    return path.join(this.memoDir(memoId), "attachments", `${attachmentId}.${extensionFromMimeType(mimeType)}`);
  }

  async saveMemo(input) {
    const memoDir = this.memoDir(input.memoId);
    await fs.mkdir(path.join(memoDir, "attachments"), { recursive: true });
    await fs.writeFile(path.join(memoDir, "body.md"), String(input.memoBody || ""), "utf8");
    await fs.writeFile(
      path.join(memoDir, "attachments.json"),
      JSON.stringify(Array.isArray(input.attachments) ? input.attachments : [], null, 2),
      "utf8"
    );
  }

  async loadMemo(memoId) {
    try {
      const memoDir = this.memoDir(memoId);
      const [memoBody, attachmentsRaw] = await Promise.all([
        fs.readFile(path.join(memoDir, "body.md"), "utf8"),
        fs.readFile(path.join(memoDir, "attachments.json"), "utf8").catch(() => "[]")
      ]);
      return {
        memoBody,
        attachments: JSON.parse(attachmentsRaw)
      };
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async deleteMemo(memoId) {
    await fs.rm(this.memoDir(memoId), { recursive: true, force: true });
  }

  async saveAttachment(input) {
    const targetPath = this.attachmentPath(input.memoId, input.attachmentId, input.mimeType);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
    await fs.writeFile(targetPath, bytes);
    return {
      id: input.attachmentId,
      kind: input.kind ? String(input.kind) : "image",
      fileName: input.fileName ? String(input.fileName) : "",
      mimeType: input.mimeType,
      size: bytes.byteLength,
      caption: input.caption ? String(input.caption) : "",
      width: input.width === undefined ? undefined : Number(input.width),
      height: input.height === undefined ? undefined : Number(input.height),
      storagePath: targetPath,
      createdAtISO: new Date().toISOString()
    };
  }

  async deleteAttachment(memoId, attachmentId) {
    const attachmentDir = path.join(this.memoDir(memoId), "attachments");
    const entries = await fs.readdir(attachmentDir).catch(() => []);
    const targets = entries.filter((name) => name.startsWith(`${attachmentId}.`));
    if (!targets.length) return;
    await Promise.all(
      targets.map((name) => fs.unlink(path.join(attachmentDir, name)).catch(() => {}))
    );
  }

  async resolveAttachmentUrl(input) {
    const attachmentDir = path.join(this.memoDir(input.memoId), "attachments");
    const entries = await fs.readdir(attachmentDir).catch(() => []);
    const target = entries.find((name) => name.startsWith(`${input.attachmentId}.`));
    return target ? path.join(attachmentDir, target) : null;
  }

  async copyMemoTo(targetAdapter, memoId) {
    const payload = memoId && typeof memoId === "object" ? memoId : { memoId };
    const resolvedMemoId = String(payload.memoId || "");
    if (!resolvedMemoId) {
      throw new Error(`copyMemoTo requires memoId for ${this.kind}.`);
    }
    const memoBody = String(payload.memoBody || "");
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const copiedAttachments = [];
    for (const item of attachments) {
      const sourcePath = await this.resolveAttachmentUrl({
        memoId: resolvedMemoId,
        attachmentId: item.id,
        attachment: item
      });
      if (!sourcePath) {
        throw new Error(`Attachment file missing for: ${item.id}`);
      }
      const bytes = await fs.readFile(sourcePath);
      const saved = await targetAdapter.saveAttachment({
        memoId: resolvedMemoId,
        attachmentId: item.id,
        kind: item.kind,
        fileName: item.fileName,
        mimeType: item.mimeType,
        bytes,
        caption: item.caption,
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
  LocalAdapter,
  extensionFromMimeType
};
