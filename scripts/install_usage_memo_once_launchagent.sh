#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: scripts/install_usage_memo_once_launchagent.sh <trigger-at-iso>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"
DEFAULT_CREDENTIALS="$HOME/.config/gcp/codex-tools-firestore-sa.json"
CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-$DEFAULT_CREDENTIALS}"

TRIGGER_ISO="$1"
LABEL="dev.hideki.codextools.usage-memo-trigger-once"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_OUT="/tmp/codex-tools-usage-memo-once.out.log"
LOG_ERR="/tmp/codex-tools-usage-memo-once.err.log"

if [ -z "$NPM_BIN" ]; then
  echo "npm command not found. Set NPM_BIN."
  exit 1
fi

LAUNCH_CMD="cd \"$ROOT_DIR\" && export GOOGLE_APPLICATION_CREDENTIALS=\"$CREDENTIALS\" && \"$NPM_BIN\" run usage:memo-trigger:fire"
LAUNCH_CMD_XML="$(printf '%s' "$LAUNCH_CMD" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"

python3 - "$TRIGGER_ISO" > /tmp/codex-tools-usage-memo-once.time <<'PY'
import sys
from datetime import datetime, timezone
iso = sys.argv[1]
dt = datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone()
print(dt.month)
print(dt.day)
print(dt.hour)
print(dt.minute)
print(dt.isoformat())
PY

MONTH=$(sed -n '1p' /tmp/codex-tools-usage-memo-once.time)
DAY=$(sed -n '2p' /tmp/codex-tools-usage-memo-once.time)
HOUR=$(sed -n '3p' /tmp/codex-tools-usage-memo-once.time)
MINUTE=$(sed -n '4p' /tmp/codex-tools-usage-memo-once.time)
LOCAL_ISO=$(sed -n '5p' /tmp/codex-tools-usage-memo-once.time)
rm -f /tmp/codex-tools-usage-memo-once.time

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>$LAUNCH_CMD_XML</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>$HOME</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Month</key><integer>$MONTH</integer>
    <key>Day</key><integer>$DAY</integer>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MINUTE</integer>
  </dict>
  <key>StandardOutPath</key><string>$LOG_OUT</string>
  <key>StandardErrorPath</key><string>$LOG_ERR</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/$LABEL"

echo "Installed once-trigger at local=$LOCAL_ISO"
