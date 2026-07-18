import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRemoteMcpApp } from "../scripts/codex_memo_remote_mcp_server.mjs";

function createMemoService() {
  const now = "2026-07-18T00:00:00.000Z";
  const items = new Map([["memo-1", {
    id: "memo-1",
    projectName: "codex-tools",
    memoType: "memo",
    memoBody: "hello",
    threadTitle: "First memo",
    storageKind: "firebase",
    attachments: [],
    deletable: false,
    pinned: false,
    createdAtISO: now,
    updatedAtISO: now
  }]]);
  let tick = 0;
  const clone = (value) => structuredClone(value);
  const nextTime = () => `2026-07-18T00:00:${String(++tick).padStart(2, "0")}.000Z`;

  return {
    async listMemos() { return [...items.values()].map(clone); },
    async getMemo(id) { return items.has(id) ? clone(items.get(id)) : null; },
    async createMemo(input) {
      const item = { id: `memo-${items.size + 1}`, createdAtISO: now, updatedAtISO: now, ...clone(input) };
      items.set(item.id, item);
      return clone(item);
    },
    async updateTextMemoIfUnchanged(id, expectedUpdatedAtISO, input) {
      const current = items.get(id);
      if (!current) return { status: "missing" };
      if (current.updatedAtISO !== expectedUpdatedAtISO) return { status: "conflict", current: clone(current) };
      const updated = { ...current, ...input, updatedAtISO: nextTime() };
      items.set(id, updated);
      return { status: "updated", updated: clone(updated) };
    },
    async updateMemo(id, input) {
      const current = items.get(id);
      const attachments = (input.attachments || []).map((attachment) => ({
        ...attachment,
        dataBase64: undefined,
        storagePath: attachment.storagePath || `memos/${id}/attachments/${attachment.id}.png`
      }));
      const updated = { ...current, ...clone(input), attachments, updatedAtISO: nextTime() };
      items.set(id, updated);
      return clone(updated);
    },
    async deleteMemo(id) { return items.delete(id); },
    async resolveAttachmentUrl() { return "https://storage.example/signed"; }
  };
}

async function withServer(fn) {
  const app = createRemoteMcpApp({
    memoService: createMemoService(),
    apiKey: "mcp-key",
    sitesApiKey: "sites-key",
    logger: { info() {}, warn() {} }
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await fn(`http://127.0.0.1:${address.port}/sites-api`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function authHeaders(extra = {}) {
  return { authorization: "Bearer sites-key", ...extra };
}

test("Sites API requires its dedicated bearer key and hides storage paths", async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/memos`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/memos`, { headers: { authorization: "Bearer mcp-key" } })).status, 401);

    const response = await fetch(`${baseUrl}/memos`, { headers: authHeaders() });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.items[0].id, "memo-1");
    assert.doesNotMatch(JSON.stringify(payload), /storagePath|sites-key|mcp-key/);
  });
});

test("Sites API creates memos and detects update conflicts", async () => {
  await withServer(async (baseUrl) => {
    const createdResponse = await fetch(`${baseUrl}/memos`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ memoBody: "new body", threadTitle: "New memo", memoType: "memo" })
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).item;
    assert.equal(created.storageKind, "firebase");

    const conflict = await fetch(`${baseUrl}/memos/${created.id}`, {
      method: "PUT",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ memoBody: "changed", expectedUpdatedAtISO: "stale" })
    });
    assert.equal(conflict.status, 409);

    const updated = await fetch(`${baseUrl}/memos/${created.id}`, {
      method: "PUT",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ memoBody: "changed", expectedUpdatedAtISO: created.updatedAtISO })
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).item.memoBody, "changed");
  });
});

test("Sites API enforces deletion confirmation and deletable state", async () => {
  await withServer(async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/memos/memo-1`, { method: "DELETE", headers: authHeaders() });
    assert.equal(denied.status, 409);

    const marked = await fetch(`${baseUrl}/memos/memo-1/deletable`, {
      method: "PATCH",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ value: true })
    });
    assert.equal(marked.status, 200);
    assert.equal((await marked.json()).item.deletable, true);

    const deleted = await fetch(`${baseUrl}/memos/memo-1`, {
      method: "DELETE",
      headers: authHeaders({ "x-codex-delete-confirm": "DELETE:memo-1" })
    });
    assert.equal(deleted.status, 200);
    assert.equal((await fetch(`${baseUrl}/memos/memo-1`, { headers: authHeaders() })).status, 404);
  });
});

test("Sites API uploads, resolves, and deletes image attachments", async () => {
  await withServer(async (baseUrl) => {
    const form = new FormData();
    form.set("caption", "sample");
    form.set("file", new Blob([Buffer.from("fake png")], { type: "image/png" }), "sample.png");
    const uploaded = await fetch(`${baseUrl}/memos/memo-1/attachments`, {
      method: "POST",
      headers: authHeaders(),
      body: form
    });
    assert.equal(uploaded.status, 201);
    const uploadPayload = await uploaded.json();
    const attachmentId = uploadPayload.attachmentId;
    assert.match(uploadPayload.item.memoBody, new RegExp(`attachment://${attachmentId}`));
    assert.doesNotMatch(JSON.stringify(uploadPayload), /storagePath|dataBase64/);

    const resolved = await fetch(`${baseUrl}/memos/memo-1/attachments/${attachmentId}`, {
      headers: authHeaders(),
      redirect: "manual"
    });
    assert.equal(resolved.status, 302);
    assert.equal(resolved.headers.get("location"), "https://storage.example/signed");

    const removed = await fetch(`${baseUrl}/memos/memo-1/attachments/${attachmentId}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    assert.equal(removed.status, 200);
    const removedPayload = await removed.json();
    assert.equal(removedPayload.item.attachments.length, 0);
    assert.doesNotMatch(removedPayload.item.memoBody, /attachment:\/\//);
  });
});
