import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import multer from "multer";

const ALLOWED_MEMO_TYPES = new Set(["handover memo", "memo", "propomemo", "keep"]);
const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_MUTATION_ID_BYTES = 200;
const CAPTURE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTRACT_REVISION = "2026-07-30";

const CAPABILITIES = Object.freeze({
  apiVersion: "1",
  contractRevision: CONTRACT_REVISION,
  features: {
    "memo.read": true,
    "memo.create": true,
    "memo.create.captureIdempotency": true,
    "memo.updateText.conflictSafe": true,
    "memo.updateMetadata.conflictSafe": true,
    "attachment.upload.image": true,
    "attachment.mutation.conflictSafe": true,
    "attachment.mutation.idempotent": true,
    "error.code": true
  },
  limits: {
    listMax: 500,
    attachmentMaxCount: MAX_ATTACHMENT_COUNT,
    attachmentMaxBytes: MAX_ATTACHMENT_BYTES,
    attachmentFilesPerRequest: 1
  },
  memoTypes: [...ALLOWED_MEMO_TYPES]
});

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

function requestId() {
  return `req_${randomUUID().replaceAll("-", "")}`;
}

function sendError(res, status, code, error, extras = {}) {
  res.status(status).json({
    error,
    code,
    requestId: res.locals.sitesRequestId,
    ...extras
  });
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function captureId(value) {
  const normalized = compactText(value);
  if (!CAPTURE_ID_PATTERN.test(normalized)) {
    throw Object.assign(new Error("captureID must be a lowercase UUID."), {
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      publicMessage: "captureID must be a lowercase UUID."
    });
  }
  return normalized;
}

function safeMutationHeaders(req) {
  const mutationID = String(req.get("x-codex-mutation-id") || "");
  const expectedUpdatedAtISO = compactText(req.get("x-codex-expected-updated-at"));
  if (!mutationID && !expectedUpdatedAtISO) return null;
  if (
    !mutationID.trim()
    || Buffer.byteLength(mutationID, "utf8") > MAX_MUTATION_ID_BYTES
    || !expectedUpdatedAtISO
  ) {
    throw Object.assign(new Error("Safe attachment mutation headers are invalid."), {
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      publicMessage: "X-Codex-Mutation-ID and X-Codex-Expected-Updated-At are required."
    });
  }
  return { mutationID, expectedUpdatedAtISO };
}

function normalizeMemoType(value) {
  const memoType = compactText(value) || "memo";
  if (!ALLOWED_MEMO_TYPES.has(memoType)) {
    throw Object.assign(new Error("Invalid memoType."), {
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      publicMessage: "Invalid memoType."
    });
  }
  return memoType;
}

function normalizeOptionalProjectName(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error("Invalid projectName."), {
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      publicMessage: "projectName must be a non-empty string."
    });
  }
  return value.trim();
}

function normalizeOptionalMemoType(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw Object.assign(new Error("Invalid memoType."), {
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      publicMessage: "Invalid memoType."
    });
  }
  return normalizeMemoType(value);
}

function boolValue(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw Object.assign(new Error("Boolean value must be true or false."), {
    statusCode: 400,
    apiCode: "VALIDATION_FAILED",
    publicMessage: "Boolean value must be true or false."
  });
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

  router.use((_req, res, next) => {
    res.locals.sitesRequestId = requestId();
    next();
  });

  router.use((req, res, next) => {
    if (!sameSecret(bearerToken(req), apiKey)) {
      sendError(res, 401, "UNAUTHORIZED", "Unauthorized.");
      return;
    }
    next();
  });

  router.get("/health", (_req, res) => res.json({ ok: true }));
  router.get("/capabilities", (_req, res) => res.json(CAPABILITIES));

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
    const input = {
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
    };
    if (req.body?.captureID === undefined) {
      const created = await memoService.createMemo(input);
      res.status(201).json({ item: publicMemo(created) });
      return;
    }
    if (typeof memoService.createMemoForCapture !== "function") {
      throw new Error("Capture idempotency is unavailable.");
    }
    const normalizedCaptureID = captureId(req.body.captureID);
    const outcome = await memoService.createMemoForCapture({
      captureID: normalizedCaptureID,
      fingerprint: fingerprint(input),
      input
    });
    if (outcome.status === "reused" || outcome.status === "gone") {
      sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for a different payload.");
      return;
    }
    const replayed = outcome.status === "replayed";
    res.status(replayed ? 200 : 201).json({
      item: publicMemo(outcome.memo),
      captureID: normalizedCaptureID,
      replayed
    });
  }));

  router.get("/memos/:id", asyncRoute(async (req, res) => {
    const memo = await memoService.getMemo(req.params.id);
    if (!memo || compactText(memo.storageKind || "firebase") !== "firebase") {
      sendError(res, 404, "MEMO_NOT_FOUND", "Memo not found.");
      return;
    }
    res.json({ item: publicMemo(memo) });
  }));

  router.put("/memos/:id", asyncRoute(async (req, res) => {
    const expectedUpdatedAtISO = compactText(req.body?.expectedUpdatedAtISO);
    if (!expectedUpdatedAtISO) {
      sendError(res, 400, "VALIDATION_FAILED", "expectedUpdatedAtISO is required.");
      return;
    }
    const current = await memoService.getMemo(req.params.id);
    if (!current) {
      sendError(res, 404, "MEMO_NOT_FOUND", "Memo not found.");
      return;
    }
    if (typeof memoService.updateTextMemoIfUnchanged !== "function") {
      throw new Error("Conflict-safe update is unavailable.");
    }
    const outcome = await memoService.updateTextMemoIfUnchanged(req.params.id, expectedUpdatedAtISO, {
      memoBody: req.body?.memoBody === undefined ? undefined : String(req.body.memoBody),
      threadTitle: req.body?.threadTitle === undefined ? undefined : compactText(req.body.threadTitle),
      projectName: normalizeOptionalProjectName(req.body?.projectName),
      memoType: normalizeOptionalMemoType(req.body?.memoType)
    });
    if (outcome.status === "conflict") {
      sendError(res, 409, "UPDATE_CONFLICT", "Update conflict.", {
        item: publicMemo(outcome.current),
        conflict: true
      });
      return;
    }
    if (outcome.status === "missing" || outcome.status === "unsupported") {
      sendError(res, 404, "MEMO_NOT_FOUND", "Memo not found.");
      return;
    }
    res.json({ item: publicMemo(outcome.updated) });
  }));

  for (const [route, field] of [["pin", "pinned"], ["deletable", "deletable"]]) {
    router.patch(`/memos/:id/${route}`, asyncRoute(async (req, res) => {
      const current = await memoService.getMemo(req.params.id);
      if (!current) {
        sendError(res, 404, "MEMO_NOT_FOUND", "Memo not found.");
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
      sendError(res, 404, "MEMO_NOT_FOUND", "Memo not found.");
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
      sendError(res, 404, "MEMO_NOT_FOUND", "Memo not found.");
      return;
    }
    const format = compactText(req.query.format).toLowerCase() || "md";
    if (!["md", "txt", "json"].includes(format)) {
      sendError(res, 400, "VALIDATION_FAILED", "format must be md, txt, or json.");
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
      sendError(res, 400, "VALIDATION_FAILED", "One image file is required.");
      return;
    }
    const safeHeaders = safeMutationHeaders(req);
    if (safeHeaders) {
      if (typeof memoService.uploadAttachmentIfUnchanged !== "function") {
        throw new Error("Conflict-safe attachment upload is unavailable.");
      }
      const caption = compactText(req.body?.caption) || compactText(req.file.originalname) || "image";
      const payloadFingerprint = fingerprint({
        operation: "attachment.upload",
        memoID: req.params.id,
        mutationID: safeHeaders.mutationID,
        caption,
        fileName: compactText(req.file.originalname),
        mimeType: req.file.mimetype,
        size: req.file.size,
        sha256: createHash("sha256").update(req.file.buffer).digest("hex")
      });
      const attachmentId = `att_${fingerprint({
        memoID: req.params.id,
        mutationID: safeHeaders.mutationID
      }).slice(0, 32)}`;
      const outcome = await memoService.uploadAttachmentIfUnchanged({
        memoId: req.params.id,
        mutationID: safeHeaders.mutationID,
        fingerprint: payloadFingerprint,
        expectedUpdatedAtISO: safeHeaders.expectedUpdatedAtISO,
        attachmentId,
        fileName: compactText(req.file.originalname),
        mimeType: req.file.mimetype,
        bytes: req.file.buffer,
        caption,
        maxAttachmentCount: MAX_ATTACHMENT_COUNT
      });
      if (outcome.status === "missing") {
        sendError(res, 404, "MEMO_NOT_FOUND", "Memo not found.");
        return;
      }
      if (outcome.status === "conflict") {
        sendError(res, 409, "UPDATE_CONFLICT", "Update conflict.", {
          item: publicMemo(outcome.current),
          conflict: true
        });
        return;
      }
      if (outcome.status === "limit") {
        sendError(res, 409, "ATTACHMENT_LIMIT_EXCEEDED", `A memo can contain up to ${MAX_ATTACHMENT_COUNT} attachments.`);
        return;
      }
      if (outcome.status === "reused") {
        sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for a different payload.");
        return;
      }
      const replayed = outcome.status === "replayed";
      res.status(replayed ? 200 : 201).json({
        item: publicMemo(outcome.current),
        attachmentId,
        mutationID: safeHeaders.mutationID,
        replayed
      });
      return;
    }
    const current = await memoService.getMemo(req.params.id);
    if (!current) {
      sendError(res, 404, "MEMO_NOT_FOUND", "Memo not found.");
      return;
    }
    if ((current.attachments || []).length >= MAX_ATTACHMENT_COUNT) {
      sendError(res, 409, "ATTACHMENT_LIMIT_EXCEEDED", `A memo can contain up to ${MAX_ATTACHMENT_COUNT} attachments.`);
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
      sendError(res, 404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
      return;
    }
    const url = await memoService.resolveAttachmentUrl(req.params.id, attachment);
    if (!url || !/^https:\/\//i.test(url)) {
      sendError(res, 404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
      return;
    }
    res.redirect(url);
  }));

  router.delete("/memos/:id/attachments/:attachmentId", asyncRoute(async (req, res) => {
    const safeHeaders = safeMutationHeaders(req);
    if (safeHeaders) {
      if (typeof memoService.deleteAttachmentIfUnchanged !== "function") {
        throw new Error("Conflict-safe attachment delete is unavailable.");
      }
      const outcome = await memoService.deleteAttachmentIfUnchanged({
        memoId: req.params.id,
        attachmentId: req.params.attachmentId,
        mutationID: safeHeaders.mutationID,
        expectedUpdatedAtISO: safeHeaders.expectedUpdatedAtISO,
        fingerprint: fingerprint({
          operation: "attachment.delete",
          memoID: req.params.id,
          attachmentID: req.params.attachmentId,
          mutationID: safeHeaders.mutationID
        })
      });
      if (outcome.status === "missing") {
        sendError(res, 404, "MEMO_NOT_FOUND", "Memo not found.");
        return;
      }
      if (outcome.status === "attachment-missing") {
        sendError(res, 404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
        return;
      }
      if (outcome.status === "conflict") {
        sendError(res, 409, "UPDATE_CONFLICT", "Update conflict.", {
          item: publicMemo(outcome.current),
          conflict: true
        });
        return;
      }
      if (outcome.status === "reused") {
        sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used for a different payload.");
        return;
      }
      res.json({
        item: publicMemo(outcome.current),
        attachmentId: req.params.attachmentId,
        mutationID: safeHeaders.mutationID,
        replayed: outcome.status === "replayed"
      });
      return;
    }
    const current = await memoService.getMemo(req.params.id);
    const attachments = current?.attachments?.filter((item) => item.id !== req.params.attachmentId) || [];
    if (!current || attachments.length === (current.attachments || []).length) {
      sendError(res, 404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
      return;
    }
    const memoBody = removeAttachmentReference(current.memoBody, req.params.attachmentId);
    const updated = await memoService.updateMemo(req.params.id, fullMemoUpdate(current, { memoBody, attachments }));
    res.json({ item: publicMemo(updated) });
  }));

  router.use((error, _req, res, _next) => {
    logger.warn?.(`[sites-api] request ${res.locals.sitesRequestId} failed: ${error?.message || "request failed"}`);
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      sendError(res, 413, "PAYLOAD_TOO_LARGE", `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes.`);
      return;
    }
    sendError(
      res,
      Number(error?.statusCode) || 500,
      error?.apiCode || "INTERNAL_ERROR",
      error?.publicMessage || "Request failed."
    );
  });

  return router;
}

export const sitesApiInternals = {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  CAPABILITIES,
  publicMemo,
  removeAttachmentReference,
  sameSecret
};
