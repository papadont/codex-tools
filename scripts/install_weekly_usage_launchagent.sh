#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"
DEFAULT_CREDENTIALS="$HOME/.config/gcp/codex-tools-firestore-sa.json"
CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-$DEFAULT_CREDENTIALS}"
PLIST_PATH="$HOME/Library/LaunchAgents/dev.hideki.codextools.weekly-usage.plist"
LOG_OUT="/tmp/codex-tools-weekly-usage.out.log"
LOG_ERR="/tmp/codex-tools-weekly-usage.err.log"

if [ -z "$NPM_BIN" ]; then
  echo "npm command not found. Set NPM_BIN."
  exit 1
fi

LAUNCH_CMD="cd \"$ROOT_DIR\" && export GOOGLE_APPLICATION_CREDENTIALS=\"$CREDENTIALS\" && \"$NPM_BIN\" run usage:weekly"
LAUNCH_CMD_XML="$(printf '%s' "$LAUNCH_CMD" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.hideki.codextools.weekly-usage</string>

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
    <key>Weekday</key>
    <integer>7</integer>
    <key>Hour</key>
    <integer>0</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>$LOG_OUT</string>
  <key>StandardErrorPath</key>
  <string>$LOG_ERR</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/dev.hideki.codextools.weekly-usage" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/dev.hideki.codextools.weekly-usage"

echo "Installed: $PLIST_PATH"
launchctl print "gui/$(id -u)/dev.hideki.codextools.weekly-usage" | rg "next scheduled|state =|path =" -n || true
