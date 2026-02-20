#!/usr/bin/env node

const path = require("node:path");
const { parseArgs, saveMemoRecord } = require("./codex_memo_core");

const TYPE_MAP = {
  memo: "memo",
  handover: "handover memo",
  propomemo: "propomemo",
  keep: "keep"
};

function usage() {
  console.log(`
Usage:
  npm run memo:thread -- \\
    --kind "memo|handover|propomemo|keep" \\
    --body "メモ本文" \\
    [--title "スレッド概要"] \\
    [--project "プロジェクト名"] \\
    [--deletable "false"]

Defaults:
  --title: 本文から自動要約（未指定時）
  --project: 現在ディレクトリ名
`);
}

function normalizeTitleText(input) {
  return String(input || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimTitle(input) {
  const compact = normalizeTitleText(input);
  return compact.slice(0, 40);
}

function isBoilerplateLine(line) {
  if (!line) return true;
  const lowered = line.toLowerCase();
  return (
    lowered === "progress log" ||
    lowered === "the story so far…" ||
    lowered === "the story so far..." ||
    lowered === "done items" ||
    lowered === "next actions" ||
    lowered === "other agreed and handover items" ||
    lowered === "先輩へ"
  );
}

function pickAutoTitleFromBody(body) {
  const lines = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim());

  for (const raw of lines) {
    const cleaned = normalizeTitleText(raw);
    if (!cleaned || isBoilerplateLine(cleaned)) continue;
    return trimTitle(cleaned);
  }
  return trimTitle(body);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (!args.kind || !TYPE_MAP[args.kind]) {
    console.error('Invalid --kind. Use "memo", "handover", "propomemo", or "keep".');
    usage();
    process.exit(1);
  }

  if (!args.body || !String(args.body).trim()) {
    console.error("Missing required argument: --body");
    usage();
    process.exit(1);
  }

  const projectName = args.project || process.env.CODEX_PROJECT_NAME || path.basename(process.cwd());
  const threadTitle = args.title && String(args.title).trim() ? args.title.trim() : pickAutoTitleFromBody(args.body);
  const memoType = TYPE_MAP[args.kind];

  const result = await saveMemoRecord({
    projectName,
    memoType,
    memoBody: args.body.trim(),
    threadTitle,
    deletable: args.deletable,
    createdBy: "codex-thread-command"
  });
  console.log(`Saved to codex-memo with docId=${result.docId}`);
}

main().catch((err) => {
  console.error("Failed to save memo:", err.message);
  process.exit(1);
});
