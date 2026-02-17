#!/usr/bin/env node

const { parseArgs, saveMemoRecord } = require("./codex_memo_core");

function usage() {
  console.log(`
Usage:
  npm run memo:save -- \\
    --projectName "your-project" \\
    --memoType "memo" \\
    --memoBody "text" \\
    --threadTitle "summary title" \\
    [--deletable "false"]

Required env:
  GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const result = await saveMemoRecord({
    projectName: args.projectName,
    memoType: args.memoType,
    memoBody: args.memoBody,
    threadTitle: args.threadTitle,
    deletable: args.deletable,
    createdBy: "codex-cli"
  });
  console.log(`Saved to codex-memo with docId=${result.docId}`);
}

main().catch((err) => {
  console.error("Failed to save memo:", err.message);
  process.exit(1);
});
