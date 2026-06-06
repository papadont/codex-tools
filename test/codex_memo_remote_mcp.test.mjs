import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRemoteMcpApp } from "../scripts/codex_memo_remote_mcp_server.mjs";

function createMemoService() {
  return {
    async listMemos() { return []; },
    async getMemo() { return null; },
    async createMemo(input) {
      return {
        id: "created",
        createdAtISO: "2026-06-06T00:00:00.000Z",
        updatedAtISO: "2026-06-06T00:00:00.000Z",
        datetimeISO: "2026-06-06T00:00:00.000Z",
        ...input
      };
    },
    async updateMemo() { throw new Error("not used"); }
  };
}

async function withServer(options, fn) {
  const app = createRemoteMcpApp(options);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("Remote MCP enforces API key and Origin policy", async () => {
  const logs = [];
  await withServer({
    memoService: createMemoService(),
    apiKey: "test-key",
    allowedOrigins: new Set(["https://www.perplexity.ai"]),
    logger: { info(line) { logs.push(line); } }
  }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
    assert.equal((await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
        origin: "https://evil.example",
        "content-type": "application/json"
      },
      body: JSON.stringify({ method: "tools/call", params: { name: "secret-tool", arguments: { memoBody: "do-not-log" } } })
    })).status, 403);
  });
  const serializedLogs = logs.join("\n");
  assert.doesNotMatch(serializedLogs, /test-key|do-not-log|memoBody|authorization/i);
});

test("Remote MCP exposes read and write tools over Streamable HTTP without Origin", async () => {
  await withServer({
    memoService: createMemoService(),
    apiKey: "test-key",
    allowedOrigins: new Set(),
    logger: { info() {} }
  }, async (baseUrl) => {
    const client = new Client({ name: "remote-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer test-key" } }
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["create_memo", "get_memo", "list_recent_memos", "search_memos", "update_memo"]
    );
    const created = await client.callTool({ name: "create_memo", arguments: { memoBody: "remote body" } });
    assert.equal(created.structuredContent.item.id, "created");
    await client.close();
  });
});
