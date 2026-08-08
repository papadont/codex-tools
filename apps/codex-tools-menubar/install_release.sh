#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="codex-tools.app"
INSTALL_DIR="${CODEX_TOOLS_INSTALL_DIR:-$HOME/Applications}"
INSTALL_APP_PATH="$INSTALL_DIR/$APP_NAME"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-tools-release.XXXXXX")"
STAGING_APP_PATH="$STAGING_DIR/$APP_NAME"
CONTENTS="$STAGING_APP_PATH/Contents"
MACOS_DIR="$CONTENTS/MacOS"
EXECUTABLE_NAME="codex-tools"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

if [[ -n "${CODE_SIGN_IDENTITY:-}" ]]; then
  SIGNING_IDENTITY="$CODE_SIGN_IDENTITY"
else
  SIGNING_IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development:.*\)"/\1/p' | head -n 1)"
fi

if [[ -z "$SIGNING_IDENTITY" ]]; then
  echo "Apple Development signing identity was not found. Set CODE_SIGN_IDENTITY explicitly." >&2
  exit 1
fi

mkdir -p "$MACOS_DIR" "$INSTALL_DIR"

swiftc -O -whole-module-optimization "$SCRIPT_DIR/main.swift" -o "$MACOS_DIR/$EXECUTABLE_NAME"
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

xattr -cr "$STAGING_APP_PATH" 2>/dev/null || true
codesign --force --options runtime --sign "$SIGNING_IDENTITY" "$STAGING_APP_PATH"
codesign --verify --deep --strict --verbose=2 "$STAGING_APP_PATH"

rm -rf "$INSTALL_APP_PATH"
ditto "$STAGING_APP_PATH" "$INSTALL_APP_PATH"
codesign --verify --deep --strict --verbose=2 "$INSTALL_APP_PATH"

echo "Installed signed release app: $INSTALL_APP_PATH"
echo "Signing identity: $SIGNING_IDENTITY"
