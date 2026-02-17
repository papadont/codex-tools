#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SRC_DIR}/.." && pwd)"
TARGET_BASE="${HOME}/.codex/tools/codex-memo"
BIN_DIR="${HOME}/.codex/bin"

mkdir -p "${TARGET_BASE}" "${BIN_DIR}"

cp "${ROOT_DIR}/package.json" "${TARGET_BASE}/package.json"
cp "${ROOT_DIR}/scripts/codex_memo_core.js" "${TARGET_BASE}/codex_memo_core.js"
cp "${ROOT_DIR}/scripts/save_firestore_memo.js" "${TARGET_BASE}/save_firestore_memo.js"
cp "${ROOT_DIR}/scripts/save_thread_memo.js" "${TARGET_BASE}/save_thread_memo.js"

(cd "${TARGET_BASE}" && npm install --omit=dev)

cat > "${BIN_DIR}/codex-memo-save" <<EOF
#!/usr/bin/env bash
set -euo pipefail
node "${TARGET_BASE}/save_firestore_memo.js" "\$@"
EOF

cat > "${BIN_DIR}/codex-memo-thread" <<EOF
#!/usr/bin/env bash
set -euo pipefail
node "${TARGET_BASE}/save_thread_memo.js" "\$@"
EOF

chmod +x "${BIN_DIR}/codex-memo-save" "${BIN_DIR}/codex-memo-thread"

echo "Installed:"
echo "  ${BIN_DIR}/codex-memo-save"
echo "  ${BIN_DIR}/codex-memo-thread"
echo ""
echo "If needed, add to PATH:"
echo "  export PATH=\"${BIN_DIR}:\$PATH\""
