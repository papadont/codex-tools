#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRequire } from "node:module";
import { registerMemoTools } from "./codex_memo_mcp_core.mjs";
import { createFirebaseMemoService } from "./codex_memo_mcp_runtime.mjs";

const require = createRequire(import.meta.url);
const { loadEnvFromCandidates } = require("./load_env");

function parseAllowedOrigins(raw) {
  return new Set(String(raw || "").split(",").map((value) => value.trim()).filter(Boolean));
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

export function createRemoteMcpApp(options) {
  const {
    memoService,
    apiKey,
    allowedOrigins = new Set(),
    logger = console
  } = options;
  if (!apiKey) throw new Error("CODEX_MEMO_REMOTE_API_KEY is required.");

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get(["/health", "/healthz"], (_req, res) => res.json({ ok: true }));

  app.use("/mcp", (req, res, next) => {
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
    if (!sameSecret(bearerToken(req), apiKey)) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    next();
  });

  app.post("/mcp", async (req, res) => {
    const server = new McpServer({ name: "codex-memo-remote", version: "0.2.0" });
    registerMemoTools(server, memoService, { writeEnabled: true });
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

export async function startRemoteMcpServer() {
  loadEnvFromCandidates();
  const app = createRemoteMcpApp({
    memoService: createFirebaseMemoService({ requireBucket: true }),
    apiKey: process.env.CODEX_MEMO_REMOTE_API_KEY,
    allowedOrigins: parseAllowedOrigins(process.env.CODEX_MEMO_ALLOWED_ORIGINS)
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

export const remoteMcpInternals = { bearerToken, parseAllowedOrigins, sameSecret };
