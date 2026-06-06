import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createRemoteMcpApp,
  remoteMcpInternals
} from "../scripts/codex_memo_remote_mcp_server.mjs";

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

test("Remote MCP accepts OAuth tokens, publishes metadata, and attributes ChatGPT writes", async () => {
  const oauth = {
    issuer: "https://auth.example",
    introspectionUrl: "https://auth.example/introspect",
    clientId: "resource-server",
    clientSecret: "resource-secret",
    resourceUrl: "https://memo.example/mcp",
    resourceMetadataUrl: "https://memo.example/.well-known/oauth-protected-resource/mcp",
    requiredScopes: ["codex-memo"],
    audience: "https://memo.example/mcp"
  };
  const introspectionRequests = [];
  const fetchFn = async (url, options) => {
    introspectionRequests.push({ url, options });
    const token = new URLSearchParams(String(options.body)).get("token");
    return new Response(JSON.stringify({
      active: token === "oauth-token",
      scope: "openid codex-memo",
      aud: "https://memo.example/mcp"
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  await withServer({
    memoService: createMemoService(),
    apiKey: "perplexity-key",
    oauth,
    fetchFn,
    logger: { info() {} }
  }, async (baseUrl) => {
    const metadata = await (await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(metadata.resource, "https://memo.example/mcp");
    assert.deepEqual(metadata.authorization_servers, ["https://auth.example"]);

    const unauthorized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate"), /oauth-protected-resource\/mcp/);
    assert.match(unauthorized.headers.get("www-authenticate"), /scope="codex-memo"/);

    const invalidToken = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer invalid", "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(invalidToken.status, 401);

    const client = new Client({ name: "chatgpt-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer oauth-token" } }
    });
    await client.connect(transport);
    const created = await client.callTool({ name: "create_memo", arguments: { memoBody: "from ChatGPT" } });
    assert.equal(created.structuredContent.item.projectName, "chatgpt");
    await client.close();
  });

  assert.ok(introspectionRequests.length >= 1);
  assert.equal(introspectionRequests[0].url, "https://auth.example/introspect");
  assert.match(String(introspectionRequests[0].options.headers.authorization), /^Basic /);
  assert.ok(introspectionRequests.some(({ options }) => String(options.body).includes("token=oauth-token")));
});

test("Remote MCP validates JWT access tokens with issuer, audience, and scope", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  const oauth = {
    issuer: "https://tenant.example/",
    audience: "https://memo.example/mcp",
    requiredScopes: ["codex-memo"],
    jwksUrl: "https://tenant.example/.well-known/jwks.json",
    jwks: createLocalJWKSet({ keys: [publicJwk] })
  };
  const valid = await new SignJWT({ scope: "openid codex-memo" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(oauth.issuer)
    .setAudience(oauth.audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const wrongAudience = await new SignJWT({ scope: "codex-memo" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(oauth.issuer)
    .setAudience("https://wrong.example/mcp")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  assert.equal(await remoteMcpInternals.validateOAuthToken(valid, oauth), true);
  await assert.rejects(
    remoteMcpInternals.validateOAuthToken(wrongAudience, oauth),
    /unexpected "aud" claim value/
  );
});
