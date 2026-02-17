#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 /absolute/path/to/project"
  exit 1
fi

PROJECT_DIR="$1"
AGENTS_FILE="${PROJECT_DIR}/AGENTS.md"

if [ ! -d "${PROJECT_DIR}" ]; then
  echo "Project directory not found: ${PROJECT_DIR}"
  exit 1
fi

if [ ! -f "${AGENTS_FILE}" ]; then
  cat > "${AGENTS_FILE}" <<'EOF'
# AGENTS
EOF
fi

if rg -n "Global Firestore Memo Rule" "${AGENTS_FILE}" >/dev/null 2>&1; then
  echo "Rule already exists in ${AGENTS_FILE}"
  exit 0
fi

cat >> "${AGENTS_FILE}" <<'EOF'

## Global Firestore Memo Rule
- Trigger words in this project thread:
  - `メモ保存` -> `memo`
  - `引継ぎメモ保存` -> `handover`
  - `提案メモ保存` -> `propomemo`
- Execute:
  - `codex-memo-thread --kind "<memo|handover|propomemo>" --body "<本文>" [--title "<概要>"] [--project "<プロジェクト名>"] [--deletable "true|false"]`
- Defaults:
  - `projectName`: current workspace directory name
  - `threadTitle`: first 40 chars of memo body
  - `deletable`: `false`
- After save, always report returned `docId`.
EOF

echo "Appended memo rule to ${AGENTS_FILE}"
