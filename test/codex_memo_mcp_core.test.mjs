import test from "node:test";
import assert from "node:assert/strict";
import { registerMemoTools } from "../scripts/codex_memo_mcp_core.mjs";

function createToolHarness(initialMemos = []) {
  const tools = new Map();
  let clock = 0;
  const memos = new Map(initialMemos.map((memo) => [memo.id, structuredClone(memo)]));
  const memoService = {
    async listMemos(limit) {
      return [...memos.values()].slice(0, limit).map((memo) => structuredClone(memo));
    },
    async getMemo(id) {
      return memos.has(id) ? structuredClone(memos.get(id)) : null;
    },
    async createMemo(input) {
      const id = `memo_${memos.size + 1}`;
      const now = `2026-06-06T00:00:0${clock++}.000Z`;
      const memo = { id, createdAtISO: now, updatedAtISO: now, datetimeISO: now, ...input };
      memos.set(id, memo);
      return structuredClone(memo);
    },
    async updateMemo(id, input) {
      const current = memos.get(id);
      const updated = {
        ...current,
        ...input,
        updatedAtISO: `2026-06-06T00:00:0${clock++}.000Z`
      };
      memos.set(id, updated);
      return structuredClone(updated);
    }
  };
  const server = {
    tool(name, _description, _schema, handler) {
      tools.set(name, handler);
    }
  };
  registerMemoTools(server, memoService, { writeEnabled: true });
  return { tools, memos };
}

test("MCP public DTO redacts attachment storage details and list bodies", async () => {
  const body = "secret body ".repeat(30);
  const { tools } = createToolHarness([{
    id: "memo_a",
    projectName: "codex-tools",
    memoType: "memo",
    memoBody: body,
    threadTitle: "private",
    storageKind: "firebase",
    pinned: false,
    deletable: false,
    updatedAtISO: "2026-06-06T00:00:00.000Z",
    attachments: [{
      id: "att_a",
      fileName: "private.pdf",
      mimeType: "application/pdf",
      size: 42,
      storagePath: "memos/memo_a/attachments/att_a.pdf",
      signedUrl: "https://signed.example/private"
    }]
  }]);

  const list = await tools.get("list_recent_memos")({});
  assert.equal(list.structuredContent.items[0].memoBody, undefined);
  assert.equal(list.structuredContent.items[0].excerpt.length, 240);

  const detail = await tools.get("get_memo")({ id: "memo_a" });
  assert.equal(detail.structuredContent.item.memoBody, body);
  assert.equal(detail.structuredContent.item.attachments[0].storagePath, undefined);
  assert.equal(detail.structuredContent.item.attachments[0].signedUrl, undefined);
});

test("create_memo applies safe defaults and generated title", async () => {
  const { tools } = createToolHarness();
  const result = await tools.get("create_memo")({
    memoBody: " first\n\n  remote memo "
  });
  const item = result.structuredContent.item;
  assert.equal(item.threadTitle, "first remote memo");
  assert.equal(item.projectName, "perplexity");
  assert.equal(item.memoType, "memo");
  assert.equal(item.pinned, false);
  assert.equal(item.deletable, false);
});

test("update_memo rejects stale writes and preserves protected fields", async () => {
  const existing = {
    id: "memo_a",
    projectName: "keep-project",
    memoType: "keep",
    memoBody: "old",
    threadTitle: "old title",
    storageKind: "firebase",
    pinned: true,
    deletable: false,
    updatedAtISO: "2026-06-06T00:00:00.000Z",
    attachments: [{ id: "att_a", storagePath: "private/path" }]
  };
  const { tools, memos } = createToolHarness([existing]);

  const conflict = await tools.get("update_memo")({
    id: "memo_a",
    expectedUpdatedAtISO: "stale",
    memoBody: "new"
  });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent.conflict, true);
  assert.equal(memos.get("memo_a").memoBody, "old");

  const updated = await tools.get("update_memo")({
    id: "memo_a",
    expectedUpdatedAtISO: existing.updatedAtISO,
    memoBody: "new"
  });
  assert.equal(updated.structuredContent.item.memoBody, "new");
  assert.equal(memos.get("memo_a").projectName, "keep-project");
  assert.equal(memos.get("memo_a").memoType, "keep");
  assert.equal(memos.get("memo_a").pinned, true);
  assert.equal(memos.get("memo_a").attachments[0].storagePath, "private/path");
});

test("update_memo uses atomic Firebase update when available", async () => {
  let received;
  const atomicService = {
    async listMemos() { return []; },
    async getMemo() { throw new Error("non-atomic get should not run"); },
    async updateTextMemoIfUnchanged(id, expectedUpdatedAtISO, input) {
      received = { id, expectedUpdatedAtISO, input };
      return {
        status: "updated",
        updated: {
          id,
          memoBody: input.memoBody,
          threadTitle: "kept",
          storageKind: "firebase",
          updatedAtISO: "2026-06-06T00:00:01.000Z"
        }
      };
    }
  };
  const atomicTools = new Map();
  registerMemoTools({
    tool(name, _description, _schema, handler) {
      atomicTools.set(name, handler);
    }
  }, atomicService, { writeEnabled: true });

  const result = await atomicTools.get("update_memo")({
    id: "memo_atomic",
    expectedUpdatedAtISO: "2026-06-06T00:00:00.000Z",
    memoBody: "atomic"
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(received, {
    id: "memo_atomic",
    expectedUpdatedAtISO: "2026-06-06T00:00:00.000Z",
    input: { memoBody: "atomic", threadTitle: undefined }
  });
});
