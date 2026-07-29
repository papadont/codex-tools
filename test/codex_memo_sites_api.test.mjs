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
  const captures = new Map();
  const mutations = new Map();
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
    async createMemoForCapture({ captureID, fingerprint, input }) {
      const existing = captures.get(captureID);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return { status: "reused" };
        return { status: "replayed", memo: clone(items.get(existing.memoId)) };
      }
      const item = {
        id: `capture-${captures.size + 1}`,
        createdAtISO: now,
        updatedAtISO: now,
        ...clone(input)
      };
      items.set(item.id, item);
      captures.set(captureID, { fingerprint, memoId: item.id });
      return { status: "created", memo: clone(item) };
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
    async uploadAttachmentIfUnchanged(input) {
      const key = `${input.memoId}:${input.mutationID}`;
      const receipt = mutations.get(key);
      const current = items.get(input.memoId);
      if (receipt) {
        if (receipt.fingerprint !== input.fingerprint) return { status: "reused" };
        return { status: "replayed", current: clone(current) };
      }
      if (!current) return { status: "missing" };
      if (current.updatedAtISO !== input.expectedUpdatedAtISO) {
        return { status: "conflict", current: clone(current) };
      }
      if (current.attachments.length >= input.maxAttachmentCount) {
        return { status: "limit", current: clone(current) };
      }
      const attachment = {
        id: input.attachmentId,
        kind: "image",
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.bytes.byteLength,
        caption: input.caption,
        createdAtISO: nextTime()
      };
      const reference = `![${input.caption}](attachment://${input.attachmentId})`;
      const updated = {
        ...current,
        memoBody: `${current.memoBody}\n\n${reference}`,
        attachments: [...current.attachments, attachment],
        updatedAtISO: nextTime()
      };
      items.set(input.memoId, updated);
      mutations.set(key, { fingerprint: input.fingerprint });
      return { status: "updated", current: clone(updated) };
    },
    async deleteAttachmentIfUnchanged(input) {
      const key = `${input.memoId}:${input.mutationID}`;
      const receipt = mutations.get(key);
      const current = items.get(input.memoId);
      if (receipt) {
        if (receipt.fingerprint !== input.fingerprint) return { status: "reused" };
        return { status: "replayed", current: clone(current) };
      }
      if (!current) return { status: "missing" };
      if (current.updatedAtISO !== input.expectedUpdatedAtISO) {
        return { status: "conflict", current: clone(current) };
      }
      if (!current.attachments.some((item) => item.id === input.attachmentId)) {
        return { status: "attachment-missing", current: clone(current) };
      }
      const updated = {
        ...current,
        memoBody: current.memoBody.replace(
          new RegExp(`!?\\[[^\\]]*\\]\\(attachment://${input.attachmentId}\\)\\s*`),
          ""
        ).trim(),
        attachments: current.attachments.filter((item) => item.id !== input.attachmentId),
        updatedAtISO: nextTime()
      };
      items.set(input.memoId, updated);
      mutations.set(key, { fingerprint: input.fingerprint });
      return { status: "updated", current: clone(updated) };
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

function imageForm(caption = "sample", bytes = "fake png") {
  const form = new FormData();
  form.set("caption", caption);
  form.set("file", new Blob([Buffer.from(bytes)], { type: "image/png" }), "sample.png");
  return form;
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

test("Sites API advertises the authenticated Gate B capability contract", async () => {
  await withServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/capabilities`);
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).code, "UNAUTHORIZED");

    const response = await fetch(`${baseUrl}/capabilities`, { headers: authHeaders() });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.apiVersion, "1");
    assert.equal(payload.contractRevision, "2026-07-29");
    assert.equal(payload.features["memo.create.captureIdempotency"], true);
    assert.equal(payload.features["attachment.mutation.conflictSafe"], true);
    assert.equal(payload.features["attachment.mutation.idempotent"], true);
    assert.deepEqual(payload.limits, {
      listMax: 500,
      attachmentMaxCount: 5,
      attachmentMaxBytes: 8388608,
      attachmentFilesPerRequest: 1
    });
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

test("Sites API captureID creates once, replays, and rejects payload reuse", async () => {
  await withServer(async (baseUrl) => {
    const captureID = "22222222-2222-4222-8222-222222222222";
    const request = (memoBody = "captured") => fetch(`${baseUrl}/memos`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ captureID, memoBody, threadTitle: "Capture", memoType: "memo" })
    });
    const [first, second] = await Promise.all([request(), request()]);
    assert.deepEqual([first.status, second.status].sort(), [200, 201]);
    const [firstPayload, secondPayload] = await Promise.all([first.json(), second.json()]);
    assert.equal(firstPayload.item.id, secondPayload.item.id);
    assert.deepEqual([firstPayload.replayed, secondPayload.replayed].sort(), [false, true]);

    const responseLossRetry = await request();
    assert.equal(responseLossRetry.status, 200);
    const retryPayload = await responseLossRetry.json();
    assert.equal(retryPayload.item.id, firstPayload.item.id);
    assert.equal(retryPayload.replayed, true);

    const reused = await request("different body");
    assert.equal(reused.status, 409);
    const reusedPayload = await reused.json();
    assert.equal(reusedPayload.code, "IDEMPOTENCY_KEY_REUSED");
    assert.doesNotMatch(JSON.stringify(reusedPayload), /fingerprint|stack|storagePath/);
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

test("Sites API safe attachment mutations are conflict-safe and idempotent", async () => {
  await withServer(async (baseUrl) => {
    const initial = (await (await fetch(`${baseUrl}/memos/memo-1`, {
      headers: authHeaders()
    })).json()).item;
    const uploadHeaders = authHeaders({
      "x-codex-mutation-id": "upload-queue-item-1",
      "x-codex-expected-updated-at": initial.updatedAtISO
    });
    const upload = () => fetch(`${baseUrl}/memos/memo-1/attachments`, {
      method: "POST",
      headers: uploadHeaders,
      body: imageForm()
    });

    const [first, second] = await Promise.all([upload(), upload()]);
    assert.deepEqual([first.status, second.status].sort(), [200, 201]);
    const [firstPayload, secondPayload] = await Promise.all([first.json(), second.json()]);
    assert.equal(firstPayload.attachmentId, secondPayload.attachmentId);
    assert.deepEqual([firstPayload.replayed, secondPayload.replayed].sort(), [false, true]);
    assert.equal(firstPayload.item.attachments.length, 1);
    assert.doesNotMatch(JSON.stringify(firstPayload), /storagePath|dataBase64|fingerprint/);

    const replayWithStalePrecondition = await fetch(`${baseUrl}/memos/memo-1/attachments`, {
      method: "POST",
      headers: authHeaders({
        "x-codex-mutation-id": "upload-queue-item-1",
        "x-codex-expected-updated-at": "stale"
      }),
      body: imageForm()
    });
    assert.equal(replayWithStalePrecondition.status, 200);
    assert.equal((await replayWithStalePrecondition.json()).replayed, true);

    const reusedMutation = await fetch(`${baseUrl}/memos/memo-1/attachments`, {
      method: "POST",
      headers: uploadHeaders,
      body: imageForm("different caption")
    });
    assert.equal(reusedMutation.status, 409);
    assert.equal((await reusedMutation.json()).code, "IDEMPOTENCY_KEY_REUSED");

    const staleUpload = await fetch(`${baseUrl}/memos/memo-1/attachments`, {
      method: "POST",
      headers: authHeaders({
        "x-codex-mutation-id": "upload-queue-item-2",
        "x-codex-expected-updated-at": "stale"
      }),
      body: imageForm()
    });
    assert.equal(staleUpload.status, 409);
    assert.equal((await staleUpload.json()).code, "UPDATE_CONFLICT");

    const current = (await (await fetch(`${baseUrl}/memos/memo-1`, {
      headers: authHeaders()
    })).json()).item;
    const attachmentId = firstPayload.attachmentId;
    const deleteHeaders = authHeaders({
      "x-codex-mutation-id": "delete-queue-item-1",
      "x-codex-expected-updated-at": current.updatedAtISO
    });
    const deleted = await fetch(`${baseUrl}/memos/memo-1/attachments/${attachmentId}`, {
      method: "DELETE",
      headers: deleteHeaders
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).replayed, false);

    const replayedDelete = await fetch(`${baseUrl}/memos/memo-1/attachments/${attachmentId}`, {
      method: "DELETE",
      headers: authHeaders({
        "x-codex-mutation-id": "delete-queue-item-1",
        "x-codex-expected-updated-at": "stale"
      })
    });
    assert.equal(replayedDelete.status, 200);
    assert.equal((await replayedDelete.json()).replayed, true);

    const afterDelete = (await (await fetch(`${baseUrl}/memos/memo-1`, {
      headers: authHeaders()
    })).json()).item;
    const missingDelete = await fetch(`${baseUrl}/memos/memo-1/attachments/${attachmentId}`, {
      method: "DELETE",
      headers: authHeaders({
        "x-codex-mutation-id": "delete-queue-item-2",
        "x-codex-expected-updated-at": afterDelete.updatedAtISO
      })
    });
    assert.equal(missingDelete.status, 404);
    assert.equal((await missingDelete.json()).code, "ATTACHMENT_NOT_FOUND");
  });
});

test("Sites API returns machine codes for Gate B validation and attachment limits", async () => {
  await withServer(async (baseUrl) => {
    const invalidCapture = await fetch(`${baseUrl}/memos`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        captureID: "AAAAAAAA-2222-4222-8222-222222222222",
        memoBody: "invalid"
      })
    });
    assert.equal(invalidCapture.status, 400);
    assert.equal((await invalidCapture.json()).code, "VALIDATION_FAILED");

    const partialHeaders = await fetch(`${baseUrl}/memos/memo-1/attachments`, {
      method: "POST",
      headers: authHeaders({ "x-codex-mutation-id": "partial" }),
      body: imageForm()
    });
    assert.equal(partialHeaders.status, 400);
    assert.equal((await partialHeaders.json()).code, "VALIDATION_FAILED");

    const oversized = await fetch(`${baseUrl}/memos/memo-1/attachments`, {
      method: "POST",
      headers: authHeaders(),
      body: imageForm("large", Buffer.alloc(8 * 1024 * 1024 + 1))
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, "PAYLOAD_TOO_LARGE");

    for (let index = 0; index < 5; index += 1) {
      const uploaded = await fetch(`${baseUrl}/memos/memo-1/attachments`, {
        method: "POST",
        headers: authHeaders(),
        body: imageForm(`item ${index}`)
      });
      assert.equal(uploaded.status, 201);
    }
    const current = (await (await fetch(`${baseUrl}/memos/memo-1`, {
      headers: authHeaders()
    })).json()).item;
    const overLimit = await fetch(`${baseUrl}/memos/memo-1/attachments`, {
      method: "POST",
      headers: authHeaders({
        "x-codex-mutation-id": "upload-over-limit",
        "x-codex-expected-updated-at": current.updatedAtISO
      }),
      body: imageForm("sixth")
    });
    assert.equal(overLimit.status, 409);
    const overLimitPayload = await overLimit.json();
    assert.equal(overLimitPayload.code, "ATTACHMENT_LIMIT_EXCEEDED");
    assert.doesNotMatch(JSON.stringify(overLimitPayload), /stack|storagePath|dataBase64|sites-key/);
  });
});
