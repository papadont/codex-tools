"use strict";

const ATTACHMENT_REF_REGEX = /(?:!\[(.*?)\]|\[(.*?)\])\(attachment:\/\/([A-Za-z0-9._-]+)\)/g;

function normalizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object" && item.id)
    .map((item) => {
      const normalized = {
        id: String(item.id),
        kind: item.kind || "image",
        fileName: item.fileName ? String(item.fileName) : "",
        mimeType: item.mimeType || "application/octet-stream",
        size: Number(item.size || 0),
        caption: item.caption ? String(item.caption) : "",
        storagePath: item.storagePath ? String(item.storagePath) : "",
        previewUrl: item.previewUrl ? String(item.previewUrl) : "",
        dataUrl: item.dataUrl ? String(item.dataUrl) : "",
        dataBase64: item.dataBase64 ? String(item.dataBase64) : "",
        createdAtISO: item.createdAtISO ? String(item.createdAtISO) : new Date().toISOString()
      };
      if (item.width !== undefined) {
        normalized.width = Number(item.width);
      }
      if (item.height !== undefined) {
        normalized.height = Number(item.height);
      }
      return normalized;
    });
}

function syncMemoBodyAndAttachments(input) {
  const memoBody = String(input.memoBody || "");
  const attachments = normalizeAttachments(input.attachments);
  const attachmentIds = attachments.map((item) => item.id);
  const duplicateAttachmentIds = attachmentIds.filter((id, index) => attachmentIds.indexOf(id) !== index);
  const refs = [];
  ATTACHMENT_REF_REGEX.lastIndex = 0;
  let match = ATTACHMENT_REF_REGEX.exec(memoBody);
  while (match) {
    refs.push({
      id: String(match[3]),
      caption: String(match[1] || match[2] || "").trim()
    });
    match = ATTACHMENT_REF_REGEX.exec(memoBody);
  }

  const byId = new Map(attachments.map((item) => [item.id, item]));
  const missingAttachmentIds = refs
    .map((ref) => ref.id)
    .filter((id, index, list) => !byId.has(id) && list.indexOf(id) === index);
  const ordered = refs
    .map((ref) => {
      const current = byId.get(ref.id);
      if (!current) return null;
      return {
        ...current,
        caption: ref.caption || current.caption || ""
      };
    })
    .filter(Boolean);

  const referenced = new Set(ordered.map((item) => item.id));
  const orphanAttachmentIds = attachments
    .filter((item) => !referenced.has(item.id))
    .map((item) => item.id);

  return {
    normalizedBody: memoBody,
    attachments: ordered,
    orphanAttachmentIds,
    missingAttachmentIds,
    duplicateAttachmentIds: duplicateAttachmentIds.filter((id, index, list) => list.indexOf(id) === index)
  };
}

module.exports = {
  normalizeAttachments,
  syncMemoBodyAndAttachments
};
