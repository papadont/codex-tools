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
  --title: bodyの先頭40文字
  --project: 現在ディレクトリ名
`);
}

function trimTitle(input) {
  const compact = input.replace(/\s+/g, " ").trim();
  return compact.slice(0, 40);
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
  const threadTitle = args.title && String(args.title).trim() ? args.title.trim() : trimTitle(args.body);
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
