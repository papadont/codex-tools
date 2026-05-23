#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const require = createRequire(import.meta.url);

const admin = require("firebase-admin");
const { createAdapterRegistry } = require("./adapter_registry");
const { loadEnvFromCandidates } = require("./load_env");
const { createMemoService } = require("./memo_service");
const { normalizeAttachments } = require("./memo_sync_service");
const { normalizeStorageKind, resolveRuntimeConfig } = require("./runtime_config");

const COLLECTION = "codex-memo";
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SEARCH_SCAN_LIMIT = 200;
const MAX_SEARCH_SCAN_LIMIT = 500;

loadEnvFromCandidates();

function requireCredentials() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required.");
  }
}

function initFirestore() {
  requireCredentials();
  const storageBucket = process.env.CODEX_MEMO_FIREBASE_BUCKET || undefined;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      storageBucket
    });
  }
  return admin.firestore();
}

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

function summarizeMemo(memo) {
  const body = String(memo.memoBody || "").replace(/\s+/g, " ").trim();
  return {
    id: memo.id,
    projectName: memo.projectName,
    memoType: memo.memoType,
    threadTitle: memo.threadTitle,
    storageKind: memo.storageKind,
    pinned: Boolean(memo.pinned),
    deletable: Boolean(memo.deletable),
    createdAtISO: memo.createdAtISO,
    updatedAtISO: memo.updatedAtISO,
    datetimeISO: memo.datetimeISO,
    excerpt: body.slice(0, 240)
  };
}

function formatMemoList(memos) {
  if (!memos.length) return "No memos found.";
  return memos
    .map((memo, index) => {
      const title = memo.threadTitle || "(no title)";
      const time = memo.updatedAtISO || memo.datetimeISO || memo.createdAtISO || "-";
      return `${index + 1}. ${title}\n   id: ${memo.id}\n   project: ${memo.projectName || "-"} / type: ${memo.memoType || "-"} / time: ${time}`;
    })
    .join("\n");
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

function matchesMemo(memo, filters) {
  const projectName = String(filters.projectName || "").trim().toLowerCase();
  const memoType = String(filters.memoType || "").trim().toLowerCase();
  const query = String(filters.query || "").trim().toLowerCase();

  if (projectName && !String(memo.projectName || "").toLowerCase().includes(projectName)) {
    return false;
  }
  if (memoType && String(memo.memoType || "").toLowerCase() !== memoType) {
    return false;
  }
  if (!query) return true;

  return [
    memo.id,
    memo.projectName,
    memo.memoType,
    memo.threadTitle,
    memo.memoBody
  ].some((value) => String(value || "").toLowerCase().includes(query));
}

function createService() {
  const runtimeConfig = resolveRuntimeConfig(process.argv.slice(2), process.env);
  const db = initFirestore();
  const adapterRegistry = createAdapterRegistry({
    firebase: { bucket: admin.storage().bucket() }
  });

  return createMemoService({
    db,
    collection: COLLECTION,
    runtimeConfig,
    adapterRegistry,
    admin,
    toMemoDto
  });
}

const memoService = createService();

const server = new McpServer({
  name: "codex-memo",
  version: "0.1.0"
});

server.tool(
  "list_recent_memos",
  "List recent codex-memo records. Read-only.",
  {
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional().describe("Maximum items to return."),
    projectName: z.string().optional().describe("Optional projectName substring filter."),
    memoType: z.string().optional().describe("Optional exact memoType filter.")
  },
  async ({ limit, projectName, memoType }) => {
    const safeLimit = clampNumber(limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
    const scanLimit = Math.min(Math.max(safeLimit * 5, safeLimit), MAX_SEARCH_SCAN_LIMIT);
    const memos = sortRecent(await memoService.listMemos(scanLimit))
      .filter((memo) => matchesMemo(memo, { projectName, memoType }))
      .slice(0, safeLimit);
    const items = memos.map(summarizeMemo);
    return {
      content: [{ type: "text", text: formatMemoList(memos) }],
      structuredContent: { items }
    };
  }
);

server.tool(
  "search_memos",
  "Search codex-memo records by title, body, id, project, or type. Read-only.",
  {
    query: z.string().min(1).describe("Search text."),
    limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional().describe("Maximum items to return."),
    scanLimit: z.number().int().min(1).max(MAX_SEARCH_SCAN_LIMIT).optional().describe("How many recent records to scan."),
    projectName: z.string().optional().describe("Optional projectName substring filter."),
    memoType: z.string().optional().describe("Optional exact memoType filter.")
  },
  async ({ query, limit, scanLimit, projectName, memoType }) => {
    const safeLimit = clampNumber(limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
    const safeScanLimit = clampNumber(scanLimit, DEFAULT_SEARCH_SCAN_LIMIT, safeLimit, MAX_SEARCH_SCAN_LIMIT);
    const memos = sortRecent(await memoService.listMemos(safeScanLimit))
      .filter((memo) => matchesMemo(memo, { query, projectName, memoType }))
      .slice(0, safeLimit);
    const items = memos.map(summarizeMemo);
    return {
      content: [{ type: "text", text: formatMemoList(memos) }],
      structuredContent: { items }
    };
  }
);

server.tool(
  "get_memo",
  "Get one codex-memo record by id. Read-only.",
  {
    id: z.string().min(1).describe("Memo document id.")
  },
  async ({ id }) => {
    const memo = await memoService.getMemo(id);
    if (!memo) {
      return {
        content: [{ type: "text", text: `Memo not found: ${id}` }],
        structuredContent: { item: null },
        isError: true
      };
    }
    return {
      content: [{ type: "text", text: formatMemoDetail(memo) }],
      structuredContent: { item: memo }
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
