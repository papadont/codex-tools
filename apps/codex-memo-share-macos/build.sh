#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_FILE="$SCRIPT_DIR/CodexMemoShareMacOS.xcodeproj"
SCHEME="CodexMemoShare"
OUT_DIR="${1:-/tmp/codex-memo-share-macos-build}"
APP_BUNDLE="codex-memo-share.app"
BUILD_APP_PATH="$OUT_DIR/DerivedData/Build/Products/Debug/$APP_BUNDLE"
INSTALL_DIR="$HOME/Applications"
INSTALL_APP_PATH="$INSTALL_DIR/$APP_BUNDLE"
SOURCE_ITEMS=(
  "$SCRIPT_DIR/HostApp"
  "$SCRIPT_DIR/QuickLookExtension"
  "$SCRIPT_DIR/ShareExtension"
  "$SCRIPT_DIR/Shared"
  "$SCRIPT_DIR/project.yml"
  "$SCRIPT_DIR/README.md"
  "$SCRIPT_DIR/build.sh"
)

cd "$SCRIPT_DIR"
xattr -cr "${SOURCE_ITEMS[@]}" 2>/dev/null || true
xcodegen generate > "$SCRIPT_DIR/xcodegen.log"
xattr -cr "$PROJECT_FILE" "$OUT_DIR" 2>/dev/null || true

xcodebuild \
  -project "$PROJECT_FILE" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -derivedDataPath "$OUT_DIR/DerivedData" \
  build

mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_APP_PATH"
ditto "$BUILD_APP_PATH" "$INSTALL_APP_PATH"
xattr -cr "$INSTALL_APP_PATH" 2>/dev/null || true

echo "Built app:"
echo "  $BUILD_APP_PATH"
echo "Installed app:"
echo "  $INSTALL_APP_PATH"
