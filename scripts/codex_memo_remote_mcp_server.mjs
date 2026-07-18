#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRequire } from "node:module";
import { registerMemoTools } from "./codex_memo_mcp_core.mjs";
import { createFirebaseMemoService } from "./codex_memo_mcp_runtime.mjs";
import { createSitesApiRouter } from "./codex_memo_sites_api.mjs";

const require = createRequire(import.meta.url);
const { loadEnvFromCandidates } = require("./load_env");

function parseAllowedOrigins(raw) {
  return new Set(String(raw || "").split(",").map((value) => value.trim()).filter(Boolean));
}

function parseScopes(raw) {
  return String(raw || "").split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
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

function safeToolName(req) {
  if (req.body?.method !== "tools/call") return String(req.body?.method || "unknown");
  return String(req.body?.params?.name || "tools/call");
}

function normalizeBaseUrl(raw) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

function hasRequiredScopes(payload, requiredScopes) {
  if (!requiredScopes.length) return true;
  const scopes = new Set(
    Array.isArray(payload?.scope)
      ? payload.scope
      : String(payload?.scope || "").split(/\s+/).filter(Boolean)
  );
  return requiredScopes.every((scope) => scopes.has(scope));
}

function matchesAudience(payload, audience) {
  if (!audience) return true;
  const values = [
    ...(Array.isArray(payload?.aud) ? payload.aud : [payload?.aud]),
    ...(Array.isArray(payload?.resource) ? payload.resource : [payload?.resource])
  ].filter(Boolean).map(String);
  return values.includes(audience);
}

async function validateOAuthToken(token, oauth, fetchFn) {
  if (oauth.jwksUrl) {
    const { payload } = await jwtVerify(token, oauth.jwks, {
      issuer: oauth.issuer,
      audience: oauth.audience || oauth.resourceUrl
    });
    return hasRequiredScopes(payload, oauth.requiredScopes);
  }

  const body = new URLSearchParams({ token, token_type_hint: "access_token" });
  const response = await fetchFn(oauth.introspectionUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body
  });
  if (!response.ok) return false;
  const payload = await response.json();
  return Boolean(payload?.active)
    && hasRequiredScopes(payload, oauth.requiredScopes)
    && matchesAudience(payload, oauth.audience);
}

function oauthMetadata(oauth) {
  return {
    resource: oauth.resourceUrl,
    authorization_servers: [oauth.issuer],
    scopes_supported: oauth.requiredScopes,
    bearer_methods_supported: ["header"],
    resource_name: "codex-memo Remote MCP"
  };
}

function unauthorized(res, oauth) {
  if (oauth) {
    const scope = oauth.requiredScopes.length
      ? `, scope="${oauth.requiredScopes.join(" ")}"`
      : "";
    res.set(
      "WWW-Authenticate",
      `Bearer realm="codex-memo", resource_metadata="${oauth.resourceMetadataUrl}"${scope}`
    );
  }
  res.status(401).json({ error: "Unauthorized." });
}

export function createRemoteMcpApp(options) {
  const {
    memoService,
    apiKey,
    sitesApiKey = "",
    allowedOrigins = new Set(),
    oauth = null,
    fetchFn = fetch,
    logger = console
  } = options;
  if (!apiKey && !oauth) {
    throw new Error("CODEX_MEMO_REMOTE_API_KEY or OAuth configuration is required.");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get(["/health", "/healthz"], (_req, res) => res.json({ ok: true }));
  if (sitesApiKey) {
    app.use("/sites-api", createSitesApiRouter({ memoService, apiKey: sitesApiKey, logger }));
  }
  if (oauth) {
    app.get([
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp"
    ], (_req, res) => res.json(oauthMetadata(oauth)));
  }

  app.use("/mcp", async (req, res, next) => {
    const startedAt = Date.now();
    const origin = String(req.get("origin") || "");
    res.on("finish", () => {
      logger.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        tool: safeToolName(req),
        outcome: res.statusCode < 400 ? "success" : "error"
      }));
    });

    if (origin && !allowedOrigins.has(origin)) {
      res.status(403).json({ error: "Origin is not allowed." });
      return;
    }

    const token = bearerToken(req);
    if (apiKey && sameSecret(token, apiKey)) {
      res.locals.remoteMcpActor = "perplexity-remote-mcp";
      next();
      return;
    }
    if (oauth && token) {
      try {
        if (await validateOAuthToken(token, oauth, fetchFn)) {
          res.locals.remoteMcpActor = "oauth-remote-mcp";
          next();
          return;
        }
      } catch (_error) {
        unauthorized(res, oauth);
        return;
      }
    }
    if (!res.headersSent) {
      unauthorized(res, oauth);
    }
  });

  app.post("/mcp", async (req, res) => {
    const actor = String(res.locals.remoteMcpActor || "remote-mcp");
    const server = new McpServer({ name: "codex-memo-remote", version: "0.3.0" });
    registerMemoTools(server, memoService, {
      writeEnabled: true,
      createDefaults: {
        projectName: actor === "perplexity-remote-mcp" ? "perplexity" : "chatgpt",
        createdBy: actor,
        sourceThread: actor
      }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (_error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Standalone SSE is not supported in stateless mode." },
      id: null
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null
    });
  });

  return app;
}

function oauthConfigFromEnv(env) {
  const issuer = String(env.CODEX_MEMO_OAUTH_ISSUER || "").trim();
  const introspectionUrl = String(env.CODEX_MEMO_OAUTH_INTROSPECTION_URL || "").trim();
  const jwksUrl = String(env.CODEX_MEMO_OAUTH_JWKS_URL || "").trim();
  const clientId = String(env.CODEX_MEMO_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(env.CODEX_MEMO_OAUTH_CLIENT_SECRET || "").trim();
  const publicBaseUrl = normalizeBaseUrl(env.CODEX_MEMO_PUBLIC_BASE_URL);
  const configured = [issuer, introspectionUrl, jwksUrl, clientId, clientSecret, publicBaseUrl].some(Boolean);
  if (!configured) return null;
  const hasIntrospection = Boolean(introspectionUrl && clientId && clientSecret);
  if (!issuer || !publicBaseUrl || (!jwksUrl && !hasIntrospection)) {
    throw new Error(
      "OAuth requires CODEX_MEMO_OAUTH_ISSUER, CODEX_MEMO_PUBLIC_BASE_URL, and either "
      + "CODEX_MEMO_OAUTH_JWKS_URL or the introspection URL/client credentials."
    );
  }
  const resourceUrl = `${publicBaseUrl}/mcp`;
  return {
    issuer,
    introspectionUrl,
    jwksUrl,
    jwks: jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null,
    clientId,
    clientSecret,
    resourceUrl,
    resourceMetadataUrl: `${publicBaseUrl}/.well-known/oauth-protected-resource/mcp`,
    requiredScopes: parseScopes(env.CODEX_MEMO_OAUTH_REQUIRED_SCOPES || "codex-memo"),
    audience: String(env.CODEX_MEMO_OAUTH_AUDIENCE || resourceUrl).trim()
  };
}

export async function startRemoteMcpServer() {
  loadEnvFromCandidates();
  const app = createRemoteMcpApp({
    memoService: createFirebaseMemoService({ requireBucket: true }),
    apiKey: process.env.CODEX_MEMO_REMOTE_API_KEY,
    sitesApiKey: process.env.CODEX_MEMO_SITES_API_KEY,
    allowedOrigins: parseAllowedOrigins(process.env.CODEX_MEMO_ALLOWED_ORIGINS),
    oauth: oauthConfigFromEnv(process.env)
  });
  const port = Number(process.env.PORT || 8080);
  return app.listen(port, () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "server_started",
      port
    }));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  startRemoteMcpServer().catch((error) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "startup_failed",
      error: error.message
    }));
    process.exit(1);
  });
}

export const remoteMcpInternals = {
  bearerToken,
  hasRequiredScopes,
  matchesAudience,
  oauthConfigFromEnv,
  parseAllowedOrigins,
  parseScopes,
  sameSecret,
  validateOAuthToken
};
