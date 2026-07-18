import { randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import multer from "multer";

const ALLOWED_MEMO_TYPES = new Set(["handover memo", "memo", "propomemo", "keep"]);
const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function bearerToken(req) {
  const match = String(req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function sameSecret(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function compactText(value) {
  return String(value || "").trim();
}

function normalizeMemoType(value) {
  const memoType = compactText(value) || "memo";
  if (!ALLOWED_MEMO_TYPES.has(memoType)) {
    throw Object.assign(new Error("Invalid memoType."), { statusCode: 400 });
  }
  return memoType;
}

function boolValue(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw Object.assign(new Error("Boolean value must be true or false."), { statusCode: 400 });
}

function publicAttachment(item) {
  return {
    id: compactText(item?.id),
    kind: compactText(item?.kind) || "image",
    fileName: compactText(item?.fileName),
    mimeType: compactText(item?.mimeType) || "application/octet-stream",
    size: Number(item?.size || 0),
    caption: compactText(item?.caption),
    width: item?.width === undefined ? undefined : Number(item.width),
    height: item?.height === undefined ? undefined : Number(item.height),
    createdAtISO: item?.createdAtISO || null
  };
}

function publicMemo(memo) {
  if (!memo) return null;
  return {
    id: compactText(memo.id),
    projectName: compactText(memo.projectName),
    memoType: compactText(memo.memoType) || "memo",
    memoBody: String(memo.memoBody || ""),
    threadTitle: compactText(memo.threadTitle),
    storageKind: compactText(memo.storageKind) || "firebase",
    attachments: (Array.isArray(memo.attachments) ? memo.attachments : []).map(publicAttachment),
    deletable: Boolean(memo.deletable),
    pinned: Boolean(memo.pinned),
    createdAtISO: memo.createdAtISO || memo.datetimeISO || null,
    updatedAtISO: memo.updatedAtISO || memo.createdAtISO || memo.datetimeISO || null
  };
}

function fullMemoUpdate(current, patch = {}) {
  return {
    projectName: patch.projectName ?? current.projectName,
    memoType: patch.memoType ?? current.memoType,
    memoBody: patch.memoBody ?? current.memoBody,
    threadTitle: patch.threadTitle ?? current.threadTitle,
    storageKind: current.storageKind,
    attachments: patch.attachments ?? current.attachments,
    deletable: patch.deletable ?? current.deletable,
    pinned: patch.pinned ?? current.pinned
  };
}

function updatedTime(memo) {
  return new Date(memo?.updatedAtISO || memo?.createdAtISO || memo?.datetimeISO || 0).getTime();
}

function attachmentReference(attachmentId, caption) {
  const label = compactText(caption).replace(/[\[\]]/g, "") || "image";
  return `![${label}](attachment://${attachmentId})`;
}

function removeAttachmentReference(memoBody, attachmentId) {
  const escapedId = String(attachmentId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`!?\\[[^\\]]*\\]\\(attachment:\/\/${escapedId}\\)[ \\t]*(?:\\r?\\n)?`, "g");
  return String(memoBody || "").replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim();
}

function downloadPayload(memo, format) {
  if (format === "json") return JSON.stringify(publicMemo(memo), null, 2);
  if (format === "md") {
    return [
      `# ${memo.threadTitle || memo.id}`,
      "",
      `- project: ${memo.projectName || ""}`,
      `- type: ${memo.memoType || "memo"}`,
      `- updated: ${memo.updatedAtISO || memo.createdAtISO || ""}`,
      "",
      String(memo.memoBody || "")
    ].join("\n");
  }
  return String(memo.memoBody || "");
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    callback(null, /^image\//i.test(String(file.mimetype || "")));
  }
});

function receiveUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("file")(req, res, (error) => error ? reject(error) : resolve());
  });
}

export function createSitesApiRouter({ memoService, apiKey, logger = console }) {
  if (!memoService) throw new Error("memoService is required.");
  if (!apiKey) throw new Error("CODEX_MEMO_SITES_API_KEY is required.");

  const router = express.Router();

  router.use((req, res, next) => {
    if (!sameSecret(bearerToken(req), apiKey)) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    next();
  });

  router.get("/health", (_req, res) => res.json({ ok: true }));

  router.get("/memos", asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const scanLimit = Math.min(Math.max(limit * 5, limit), 500);
    const projectName = compactText(req.query.projectName).toLowerCase();
    const memoType = compactText(req.query.memoType).toLowerCase();
    const query = compactText(req.query.q).toLowerCase();
    let items = (await memoService.listMemos(scanLimit)).filter((memo) => {
      if (compactText(memo.storageKind || "firebase") !== "firebase") return false;
      if (projectName && !compactText(memo.projectName).toLowerCase().includes(projectName)) return false;
      if (memoType && compactText(memo.memoType).toLowerCase() !== memoType) return false;
      if (query) {
        const haystack = `${memo.id} ${memo.threadTitle} ${memo.memoBody} ${memo.projectName}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    items.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || updatedTime(b) - updatedTime(a));
    res.json({ items: items.slice(0, limit).map(publicMemo), hasMore: items.length > limit });
  }));

  router.post("/memos", asyncRoute(async (req, res) => {
    const memoBody = String(req.body?.memoBody || "");
    const threadTitle = compactText(req.body?.threadTitle) || compactText(memoBody).slice(0, 40) || "Untitled memo";
    const created = await memoService.createMemo({
      projectName: compactText(req.body?.projectName) || "codex-memo-sites",
      memoType: normalizeMemoType(req.body?.memoType),
      memoBody,
      threadTitle,
      storageKind: "firebase",
      attachments: [],
      deletable: boolValue(req.body?.deletable, false),
      pinned: boolValue(req.body?.pinned, false),
      createdBy: "codex-memo-sites",
      sourceThread: "chatgpt-sites"
    });
    res.status(201).json({ item: publicMemo(created) });
  }));

  router.get("/memos/:id", asyncRoute(async (req, res) => {
    const memo = await memoService.getMemo(req.params.id);
    if (!memo || compactText(memo.storageKind || "firebase") !== "firebase") {
      res.status(404).json({ error: "Memo not found." });
      return;
    }
    res.json({ item: publicMemo(memo) });
  }));

  router.put("/memos/:id", asyncRoute(async (req, res) => {
    const expectedUpdatedAtISO = compactText(req.body?.expectedUpdatedAtISO);
    if (!expectedUpdatedAtISO) {
      res.status(400).json({ error: "expectedUpdatedAtISO is required." });
      return;
    }
    const current = await memoService.getMemo(req.params.id);
    if (!current) {
      res.status(404).json({ error: "Memo not found." });
      return;
    }
    if (typeof memoService.updateTextMemoIfUnchanged !== "function") {
      throw new Error("Conflict-safe update is unavailable.");
    }
    const outcome = await memoService.updateTextMemoIfUnchanged(req.params.id, expectedUpdatedAtISO, {
      memoBody: req.body?.memoBody === undefined ? undefined : String(req.body.memoBody),
      threadTitle: req.body?.threadTitle === undefined ? undefined : compactText(req.body.threadTitle)
    });
    if (outcome.status === "conflict") {
      res.status(409).json({ error: "Update conflict.", item: publicMemo(outcome.current), conflict: true });
      return;
    }
    if (outcome.status === "missing" || outcome.status === "unsupported") {
      res.status(404).json({ error: "Memo not found." });
      return;
    }
    res.json({ item: publicMemo(outcome.updated) });
  }));

  for (const [route, field] of [["pin", "pinned"], ["deletable", "deletable"]]) {
    router.patch(`/memos/:id/${route}`, asyncRoute(async (req, res) => {
      const current = await memoService.getMemo(req.params.id);
      if (!current) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }
      const value = boolValue(req.body?.value, !Boolean(current[field]));
      const patch = { [field]: value };
      if (field === "pinned" && value) patch.deletable = false;
      if (field === "deletable" && value) patch.pinned = false;
      const updated = await memoService.updateMemo(req.params.id, fullMemoUpdate(current, patch));
      res.json({ item: publicMemo(updated) });
    }));
  }

  router.delete("/memos/:id", asyncRoute(async (req, res) => {
    const current = await memoService.getMemo(req.params.id);
    if (!current) {
      res.status(404).json({ error: "Memo not found." });
      return;
    }
    if (!current.deletable || req.get("x-codex-delete-confirm") !== `DELETE:${req.params.id}`) {
      res.status(409).json({ error: "Deletion is not allowed or not confirmed." });
      return;
    }
    await memoService.deleteMemo(req.params.id);
    res.json({ ok: true });
  }));

  router.get("/memos/:id/download", asyncRoute(async (req, res) => {
    const memo = await memoService.getMemo(req.params.id);
    if (!memo) {
      res.status(404).json({ error: "Memo not found." });
      return;
    }
    const format = compactText(req.query.format).toLowerCase() || "md";
    if (!["md", "txt", "json"].includes(format)) {
      res.status(400).json({ error: "format must be md, txt, or json." });
      return;
    }
    const safeTitle = (memo.threadTitle || memo.id).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 50) || memo.id;
    res.setHeader("content-type", format === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${safeTitle}.${format}"`);
    res.send(downloadPayload(memo, format));
  }));

  router.post("/memos/:id/attachments", asyncRoute(async (req, res) => {
    await receiveUpload(req, res);
    if (!req.file || !/^image\//i.test(req.file.mimetype)) {
      res.status(400).json({ error: "One image file is required." });
      return;
    }
    const current = await memoService.getMemo(req.params.id);
    if (!current) {
      res.status(404).json({ error: "Memo not found." });
      return;
    }
    if ((current.attachments || []).length >= MAX_ATTACHMENT_COUNT) {
      res.status(409).json({ error: `A memo can contain up to ${MAX_ATTACHMENT_COUNT} attachments.` });
      return;
    }
    const attachmentId = `att_${randomUUID().replaceAll("-", "")}`;
    const caption = compactText(req.body?.caption) || compactText(req.file.originalname) || "image";
    const reference = attachmentReference(attachmentId, caption);
    const memoBody = `${String(current.memoBody || "").trim()}${current.memoBody ? "\n\n" : ""}${reference}`;
    const attachments = [...(current.attachments || []), {
      id: attachmentId,
      kind: "image",
      fileName: compactText(req.file.originalname),
      mimeType: req.file.mimetype,
      size: req.file.size,
      caption,
      dataBase64: req.file.buffer.toString("base64")
    }];
    const updated = await memoService.updateMemo(req.params.id, fullMemoUpdate(current, { memoBody, attachments }));
    res.status(201).json({ item: publicMemo(updated), attachmentId });
  }));

  router.get("/memos/:id/attachments/:attachmentId", asyncRoute(async (req, res) => {
    const memo = await memoService.getMemo(req.params.id);
    const attachment = memo?.attachments?.find((item) => item.id === req.params.attachmentId);
    if (!memo || !attachment || typeof memoService.resolveAttachmentUrl !== "function") {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const url = await memoService.resolveAttachmentUrl(req.params.id, attachment);
    if (!url || !/^https:\/\//i.test(url)) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    res.redirect(url);
  }));

  router.delete("/memos/:id/attachments/:attachmentId", asyncRoute(async (req, res) => {
    const current = await memoService.getMemo(req.params.id);
    const attachments = current?.attachments?.filter((item) => item.id !== req.params.attachmentId) || [];
    if (!current || attachments.length === (current.attachments || []).length) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const memoBody = removeAttachmentReference(current.memoBody, req.params.attachmentId);
    const updated = await memoService.updateMemo(req.params.id, fullMemoUpdate(current, { memoBody, attachments }));
    res.json({ item: publicMemo(updated) });
  }));

  router.use((error, _req, res, _next) => {
    logger.warn?.(`[sites-api] ${error?.message || "request failed"}`);
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes.` });
      return;
    }
    res.status(Number(error?.statusCode) || 500).json({ error: "Request failed." });
  });

  return router;
}

export const sitesApiInternals = {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  publicMemo,
  removeAttachmentReference,
  sameSecret
};
