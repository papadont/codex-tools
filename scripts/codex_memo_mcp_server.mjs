#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { registerMemoTools } from "./codex_memo_mcp_core.mjs";
import { createFirebaseMemoService } from "./codex_memo_mcp_runtime.mjs";

const require = createRequire(import.meta.url);
const { loadEnvFromCandidates } = require("./load_env");

loadEnvFromCandidates();

const memoService = createFirebaseMemoService({ requireCredentials: true });
const server = new McpServer({ name: "codex-memo", version: "0.2.0" });
registerMemoTools(server, memoService, { writeEnabled: false });

const transport = new StdioServerTransport();
await server.connect(transport);
