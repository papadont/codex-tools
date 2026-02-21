#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-$PWD/dist/macos-launchers}"
APP_NAME="HushPointer+CodexMemo.app"
APP_PATH="$OUT_DIR/$APP_NAME"

mkdir -p "$OUT_DIR"
rm -rf "$APP_PATH"

TMP_SCRIPT="$(mktemp)"
cat > "$TMP_SCRIPT" <<'APPLESCRIPT'
on run
  set hushCmd to "pkill -f '$HOME/Documents/develop/hush-pointer.*npm run dev' || true; pkill -f '$HOME/Documents/develop/hush-pointer.*vite' || true; cd \"$HOME/Documents/develop/hush-pointer\" && npm run dev"
  set memoCmd to "pkill -f 'node .*scripts/codex_memo_web_server\\.js' || true; pkill -f '$HOME/Documents/develop/codex-tools.*npm run memo:web' || true; export GOOGLE_APPLICATION_CREDENTIALS=\"${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/gcp/codex-tools-firestore-sa.json}\" && cd \"$HOME/Documents/develop/codex-tools\" && npm run memo:web"

  tell application "Terminal"
    activate
    do script hushCmd
    delay 0.3
    do script memoCmd
  end tell
end run
APPLESCRIPT

osacompile -o "$APP_PATH" "$TMP_SCRIPT"
rm -f "$TMP_SCRIPT"

xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

echo "Created: $APP_PATH"
