import { z } from "zod";

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SEARCH_SCAN_LIMIT = 200;
const MAX_SEARCH_SCAN_LIMIT = 500;

function clampNumber(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function getMemoTime(memo) {
  return new Date(memo.updatedAtISO || memo.datetimeISO || memo.createdAtISO || 0).getTime() || 0;
}

function sortRecent(memos) {
  return [...memos].sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff !== 0) return pinDiff;
    return getMemoTime(b) - getMemoTime(a);
  });
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function defaultTitle(memoBody) {
  return compactText(memoBody).slice(0, 40) || "Untitled memo";
}

function publicAttachments(attachments) {
  return (Array.isArray(attachments) ? attachments : []).map((item) => ({
    id: item.id || "",
    kind: item.kind || "",
    fileName: item.fileName || "",
    mimeType: item.mimeType || "",
    size: Number(item.size || 0),
    caption: item.caption || "",
    width: item.width === undefined ? null : Number(item.width),
    height: item.height === undefined ? null : Number(item.height)
  }));
}

function toPublicMemo(memo) {
  return {
    id: memo.id,
    projectName: memo.projectName || "",
    memoType: memo.memoType || "memo",
    memoBody: memo.memoBody || "",
    threadTitle: memo.threadTitle || "",
    storageKind: memo.storageKind || "firebase",
    pinned: Boolean(memo.pinned),
    deletable: Boolean(memo.deletable),
    createdAtISO: memo.createdAtISO || null,
    updatedAtISO: memo.updatedAtISO || null,
    datetimeISO: memo.datetimeISO || null,
    attachments: publicAttachments(memo.attachments)
  };
}

function summarizeMemo(memo) {
  const item = toPublicMemo(memo);
  delete item.memoBody;
  delete item.attachments;
  return {
    ...item,
    excerpt: compactText(memo.memoBody).slice(0, 240)
  };
}

function matchesMemo(memo, filters) {
  const projectName = compactText(filters.projectName).toLowerCase();
  const memoType = compactText(filters.memoType).toLowerCase();
  const query = compactText(filters.query).toLowerCase();

  if (projectName && !String(memo.projectName || "").toLowerCase().includes(projectName)) return false;
  if (memoType && String(memo.memoType || "").toLowerCase() !== memoType) return false;
  if (!query) return true;

  return [memo.id, memo.projectName, memo.memoType, memo.threadTitle, memo.memoBody]
    .some((value) => String(value || "").toLowerCase().includes(query));
}

function formatMemoList(memos) {
  if (!memos.length) return "No memos found.";
  return memos.map((memo, index) => {
    const title = memo.threadTitle || "(no title)";
    const time = memo.updatedAtISO || memo.datetimeISO || memo.createdAtISO || "-";
    return `${index + 1}. ${title}\n   id: ${memo.id}\n   project: ${memo.projectName || "-"} / type: ${memo.memoType || "-"} / time: ${time}`;
  }).join("\n");
}

function formatMemoDetail(memo) {
  return [
    `# ${memo.threadTitle || "(no title)"}`,
    "",
    `- id: ${memo.id}`,
    `- projectName: ${memo.projectName || ""}`,
    `- memoType: ${memo.memoType || ""}`,
    `- storageKind: ${memo.storageKind || ""}`,
    `- pinned: ${Boolean(memo.pinned)}`,
    `- deletable: ${Boolean(memo.deletable)}`,
    `- createdAtISO: ${memo.createdAtISO || ""}`,
    `- updatedAtISO: ${memo.updatedAtISO || ""}`,
    "",
    "## Body",
    "",
    memo.memoBody || ""
  ].join("\n");
}

function successResult(text, item) {
  return {
    content: [{ type: "text", text }],
    structuredContent: item
  };
}

function errorResult(text, item = { item: null }) {
  return {
    content: [{ type: "text", text }],
    structuredContent: item,
    isError: true
  };
}

export function registerMemoTools(server, memoService, options = {}) {
  const writeEnabled = Boolean(options.writeEnabled);
  const createDefaults = {
    projectName: compactText(options.createDefaults?.projectName) || "perplexity",
    createdBy: compactText(options.createDefaults?.createdBy) || "perplexity-remote-mcp",
    sourceThread: compactText(options.createDefaults?.sourceThread) || "perplexity-remote-mcp"
  };

  server.tool(
    "list_recent_memos",
    "List recent codex-memo records. Results contain a 240-character excerpt, not the full body.",
    {
      limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
      projectName: z.string().optional(),
      memoType: z.string().optional()
    },
    async ({ limit, projectName, memoType }) => {
      const safeLimit = clampNumber(limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
      const scanLimit = Math.min(Math.max(safeLimit * 5, safeLimit), MAX_SEARCH_SCAN_LIMIT);
      const memos = sortRecent(await memoService.listMemos(scanLimit))
        .filter((memo) => matchesMemo(memo, { projectName, memoType }))
        .slice(0, safeLimit);
      return successResult(formatMemoList(memos), { items: memos.map(summarizeMemo) });
    }
  );

  server.tool(
    "search_memos",
    "Search only the most recent records (up to 500), not the full collection. Results contain a 240-character excerpt.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
      scanLimit: z.number().int().min(1).max(MAX_SEARCH_SCAN_LIMIT).optional(),
      projectName: z.string().optional(),
      memoType: z.string().optional()
    },
    async ({ query, limit, scanLimit, projectName, memoType }) => {
      const safeLimit = clampNumber(limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
      const safeScanLimit = clampNumber(scanLimit, DEFAULT_SEARCH_SCAN_LIMIT, safeLimit, MAX_SEARCH_SCAN_LIMIT);
      const memos = sortRecent(await memoService.listMemos(safeScanLimit))
        .filter((memo) => matchesMemo(memo, { query, projectName, memoType }))
        .slice(0, safeLimit);
      return successResult(formatMemoList(memos), { items: memos.map(summarizeMemo) });
    }
  );

  server.tool(
    "get_memo",
    "Get one codex-memo record by id, including its full body and safe attachment metadata.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const memo = await memoService.getMemo(id);
      if (!memo) return errorResult(`Memo not found: ${id}`);
      const item = toPublicMemo(memo);
      return successResult(formatMemoDetail(item), { item });
    }
  );

  if (!writeEnabled) return;

  server.tool(
    "create_memo",
    "Create a Firebase-backed memo. Attachments, pinning, deletion flags, and custom ids are not supported.",
    {
      memoBody: z.string().min(1),
      threadTitle: z.string().optional(),
      projectName: z.string().optional(),
      memoType: z.enum(["handover memo", "memo", "propomemo", "keep"]).optional()
    },
    async ({ memoBody, threadTitle, projectName, memoType }) => {
      const created = await memoService.createMemo({
        memoBody,
        threadTitle: compactText(threadTitle) || defaultTitle(memoBody),
        projectName: compactText(projectName) || createDefaults.projectName,
        memoType: compactText(memoType) || "memo",
        storageKind: "firebase",
        attachments: [],
        createdBy: createDefaults.createdBy,
        sourceThread: createDefaults.sourceThread,
        pinned: false,
        deletable: false
      });
      const item = toPublicMemo(created);
      return successResult(`Created memo: ${item.id}`, { item });
    }
  );

  server.tool(
    "update_memo",
    "Safely update only a memo body and/or title. expectedUpdatedAtISO must match the current memo.",
    {
      id: z.string().min(1),
      expectedUpdatedAtISO: z.string().min(1),
      memoBody: z.string().optional(),
      threadTitle: z.string().optional()
    },
    async ({ id, expectedUpdatedAtISO, memoBody, threadTitle }) => {
      if (memoBody === undefined && threadTitle === undefined) {
        return errorResult("Provide memoBody and/or threadTitle.");
      }
      if (threadTitle !== undefined && !compactText(threadTitle)) {
        return errorResult("threadTitle must not be empty.");
      }

      if (typeof memoService.updateTextMemoIfUnchanged === "function") {
        const outcome = await memoService.updateTextMemoIfUnchanged(id, expectedUpdatedAtISO, {
          memoBody,
          threadTitle
        });
        if (outcome.status === "missing") return errorResult(`Memo not found: ${id}`);
        if (outcome.status === "unsupported") {
          return errorResult(`Memo ${id} is not Firebase-backed and cannot be updated remotely.`);
        }
        if (outcome.status === "conflict") {
          return errorResult(
            `Update conflict for ${id}. Fetch the memo again before retrying.`,
            { item: toPublicMemo(outcome.current), conflict: true }
          );
        }
        const item = toPublicMemo(outcome.updated);
        return successResult(`Updated memo: ${id}`, { item });
      }

      const current = await memoService.getMemo(id);
      if (!current) return errorResult(`Memo not found: ${id}`);
      if (String(current.updatedAtISO || "") !== expectedUpdatedAtISO) {
        return errorResult(
          `Update conflict for ${id}. Fetch the memo again before retrying.`,
          { item: toPublicMemo(current), conflict: true }
        );
      }

      const updated = await memoService.updateMemo(id, {
        projectName: current.projectName,
        memoType: current.memoType,
        memoBody: memoBody === undefined ? current.memoBody : memoBody,
        threadTitle: threadTitle === undefined ? current.threadTitle : threadTitle,
        storageKind: current.storageKind,
        attachments: current.attachments,
        pinned: current.pinned,
        deletable: current.deletable
      });
      const item = toPublicMemo(updated);
      return successResult(`Updated memo: ${id}`, { item });
    }
  );
}

export const memoMcpInternals = {
  defaultTitle,
  publicAttachments,
  summarizeMemo,
  toPublicMemo
};
