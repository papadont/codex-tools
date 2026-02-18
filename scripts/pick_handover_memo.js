#!/usr/bin/env node

const path = require("node:path");
const readline = require("node:readline");
const admin = require("firebase-admin");
const { parseArgs } = require("./codex_memo_core");

const COLLECTION = "codex-memo";
const MEMO_TYPE = "handover memo";

function usage() {
  console.log(`
Usage:
  npm run memo:pick-handover -- [--project "project-name"] [--limit "20"] [--index "1"]

Behavior:
  - 現在プロジェクト(または --project)の handover memo を降順表示
  - 番号選択で memoBody を出力
  - --index 指定時は非対話で選択して出力

Required env:
  GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
`);
}

function requireCredentials() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  }
}

function initFirestore() {
  requireCredentials();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
  }
  return admin.firestore();
}

function normalizeLimit(raw) {
  const n = Number(raw || 20);
  if (!Number.isInteger(n) || n < 1 || n > 200) {
    throw new Error("Invalid --limit. Use an integer between 1 and 200.");
  }
  return n;
}

function normalizeIndex(raw) {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("Invalid --index. Use an integer >= 1.");
  }
  return n;
}

function resolveDatetime(data) {
  if (data.datetime && typeof data.datetime.toDate === "function") {
    return data.datetime.toDate();
  }
  if (data.createdAtISO) {
    const date = new Date(data.createdAtISO);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date(0);
}

function formatItemLine(item, index) {
  const title = String(item.threadTitle || "(no title)").replace(/\s+/g, " ").trim();
  const date = item.createdAtISO || item.datetime.toISOString();
  return `[${index}] ${title} | ${date} | ${item.id}`;
}

async function askIndex(max) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await new Promise((resolve) => {
      rl.question(`Select number (1-${max}): `, resolve);
    });
    const n = Number(String(answer).trim());
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new Error(`Invalid selection. Use a number between 1 and ${max}.`);
    }
    return n;
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const projectName = String(args.project || path.basename(process.cwd())).trim();
  const limit = normalizeLimit(args.limit);
  const forcedIndex = normalizeIndex(args.index);
  const db = initFirestore();

  const snap = await db.collection(COLLECTION).where("projectName", "==", projectName).get();
  const items = snap.docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        threadTitle: data.threadTitle || "",
        memoBody: data.memoBody || "",
        memoType: data.memoType || "",
        createdAtISO: data.createdAtISO || "",
        datetime: resolveDatetime(data)
      };
    })
    .filter((item) => item.memoType === MEMO_TYPE)
    .sort((a, b) => b.datetime.getTime() - a.datetime.getTime())
    .slice(0, limit);

  if (!items.length) {
    throw new Error(`No handover memo found for project "${projectName}".`);
  }

  console.log(`# handover memo list for ${projectName} (newest first)`);
  items.forEach((item, i) => {
    console.log(formatItemLine(item, i + 1));
  });
  console.log("");

  const selectedIndex = forcedIndex || (await askIndex(items.length));
  if (selectedIndex > items.length) {
    throw new Error(`--index out of range. Max is ${items.length}.`);
  }

  const selected = items[selectedIndex - 1];
  console.log("----- selected memo body -----");
  console.log(selected.memoBody || "");
}

main().catch((err) => {
  console.error("Failed to pick handover memo:", err.message);
  process.exit(1);
});
