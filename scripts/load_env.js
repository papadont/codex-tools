"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function stripMatchingQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function loadEnvFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return false;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = normalized.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = normalized.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = normalized.slice(eqIndex + 1).trim();
    const hashIndex = value.indexOf(" #");
    if (hashIndex >= 0) value = value.slice(0, hashIndex).trim();
    process.env[key] = stripMatchingQuotes(value);
  }

  return true;
}

function loadEnvFromCandidates(options = {}) {
  const cwd = options.cwd || process.cwd();
  const envCandidates = [
    path.join(cwd, ".env"),
    path.join(os.homedir(), ".config", "codex-tools", ".env"),
    path.join(os.homedir(), ".codex-tools.env")
  ];

  for (const filePath of envCandidates) {
    if (fs.existsSync(filePath) && loadEnvFile(filePath)) {
      return filePath;
    }
  }
  return "";
}

module.exports = {
  loadEnvFile,
  loadEnvFromCandidates,
  stripMatchingQuotes
};
