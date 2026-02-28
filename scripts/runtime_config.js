"use strict";

const STORAGE_KINDS = ["icloud", "firebase"];
const STORAGE_MODES = ["mixed", "fixed"];

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

function normalizeStorageKind(raw, fallback = "firebase") {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (!STORAGE_KINDS.includes(value)) {
    throw new Error(`Invalid adapter. Use one of: ${STORAGE_KINDS.join(", ")}`);
  }
  return value;
}

function normalizeStorageMode(raw, fallback = "mixed") {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (!STORAGE_MODES.includes(value)) {
    throw new Error(`Invalid storage mode. Use one of: ${STORAGE_MODES.join(", ")}`);
  }
  return value;
}

function resolveRuntimeConfig(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const modeFromCli = args["storage-mode"];
  const adapterFromCli = args.adapter;
  const modeFromEnv = env.CODEX_MEMO_STORAGE_MODE;
  const adapterFromEnv = env.CODEX_MEMO_ADAPTER;

  const hasAdapter = adapterFromCli !== undefined || adapterFromEnv !== undefined;
  const adapter = hasAdapter
    ? normalizeStorageKind(adapterFromCli !== undefined ? adapterFromCli : adapterFromEnv, "firebase")
    : null;
  let storageMode = normalizeStorageMode(
    modeFromCli !== undefined ? modeFromCli : modeFromEnv,
    adapter ? "fixed" : "mixed"
  );

  if (storageMode === "fixed" && !adapter) {
    throw new Error("Fixed storage mode requires --adapter <icloud|firebase>.");
  }
  if (storageMode === "mixed" && adapter) {
    throw new Error("Mixed storage mode cannot be combined with --adapter.");
  }

  const fixedAdapter = storageMode === "fixed" ? adapter : null;
  const allowedAdapters = fixedAdapter ? [fixedAdapter] : [...STORAGE_KINDS];
  const defaultStorageKind = fixedAdapter || normalizeStorageKind(env.CODEX_MEMO_DEFAULT_STORAGE, "firebase");

  return {
    storageMode,
    fixedAdapter,
    defaultStorageKind,
    availableAdapters: [...STORAGE_KINDS],
    allowedAdapters
  };
}

module.exports = {
  STORAGE_KINDS,
  STORAGE_MODES,
  normalizeStorageKind,
  normalizeStorageMode,
  parseArgs,
  resolveRuntimeConfig
};
