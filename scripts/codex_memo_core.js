#!/usr/bin/env node

const admin = require("firebase-admin");

const ALLOWED_MEMO_TYPES = new Set(["handover memo", "memo", "propomemo", "keep"]);
const DEFAULT_SAVE_TIMEOUT_MS = Number(process.env.CODEX_MEMO_SAVE_TIMEOUT_MS || 15000);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function boolFromInput(raw, defaultValue = false) {
  if (raw === undefined) return defaultValue;
  const value = String(raw).toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error('Invalid boolean. Use "true" or "false".');
}

function validateRecord(input) {
  const required = ["projectName", "memoType", "memoBody", "threadTitle"];
  for (const key of required) {
    if (!input[key] || typeof input[key] !== "string" || !input[key].trim()) {
      throw new Error(`Missing required argument: --${key}`);
    }
  }
  if (!ALLOWED_MEMO_TYPES.has(input.memoType)) {
    throw new Error(
      `Invalid --memoType. Use one of: ${Array.from(ALLOWED_MEMO_TYPES).join(", ")}`
    );
  }
}

async function saveMemoRecord(input) {
  validateRecord(input);

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
  }

  const now = new Date();
  const payload = {
    projectName: input.projectName.trim(),
    datetime: admin.firestore.Timestamp.fromDate(now),
    memoType: input.memoType.trim(),
    memoBody: input.memoBody.trim(),
    threadTitle: input.threadTitle.trim(),
    deletable: boolFromInput(input.deletable, false),
    createdAtISO: now.toISOString(),
    createdBy: input.createdBy || "codex-cli",
    sourceThread: input.sourceThread || `${process.cwd()}`
  };

  const db = admin.firestore();
  const savePromise = db.collection("codex-memo").add(payload);
  const timeoutMs = Number.isFinite(DEFAULT_SAVE_TIMEOUT_MS) && DEFAULT_SAVE_TIMEOUT_MS > 0
    ? DEFAULT_SAVE_TIMEOUT_MS
    : 15000;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Save timed out after ${timeoutMs}ms. Check network/IAM and retry.`));
    }, timeoutMs);
  });
  const ref = await Promise.race([savePromise, timeoutPromise]);
  return { docId: ref.id, payload };
}

module.exports = {
  ALLOWED_MEMO_TYPES,
  boolFromInput,
  parseArgs,
  saveMemoRecord
};
