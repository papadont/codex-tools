#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-$PWD/dist/macos-launchers}"
APP_NAME="codex-tools.app"
APP_PATH="$OUT_DIR/$APP_NAME"
CONTENTS="$APP_PATH/Contents"
MACOS_DIR="$CONTENTS/MacOS"
EXECUTABLE_NAME="codex-tools"

mkdir -p "$OUT_DIR"
rm -rf "$APP_PATH"
mkdir -p "$MACOS_DIR"

swiftc "$PWD/scripts/menubar_launcher/main.swift" -o "$MACOS_DIR/$EXECUTABLE_NAME"
chmod +x "$MACOS_DIR/$EXECUTABLE_NAME"

cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>codex-tools</string>
  <key>CFBundleIdentifier</key>
  <string>dev.hideki.codex-tools</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>codex-tools</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

echo "Created: $APP_PATH"
