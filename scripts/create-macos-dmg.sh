#!/bin/bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: create-macos-dmg.sh <app_path> <dmg_path> [volume_name] [background_image]

Creates a Finder-friendly macOS DMG with:
- Nova.app
- Applications symlink
- Install Nova.txt instructions
- Optional Finder layout/background customization
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

APP_PATH="${1:-}"
DMG_PATH="${2:-}"
VOLUME_NAME="${3:-Nova}"
BACKGROUND_IMAGE="${4:-}"

if [ -z "$APP_PATH" ] || [ -z "$DMG_PATH" ]; then
  usage
  exit 1
fi

if [ ! -d "$APP_PATH" ]; then
  echo "App bundle not found: $APP_PATH"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -z "$BACKGROUND_IMAGE" ]; then
  DEFAULT_BG="$PROJECT_ROOT/src-tauri/icons/dmg-background.png"
  if [ -f "$DEFAULT_BG" ]; then
    BACKGROUND_IMAGE="$DEFAULT_BG"
  fi
fi

if [ -n "$BACKGROUND_IMAGE" ] && [ ! -f "$BACKGROUND_IMAGE" ]; then
  echo "Background image not found, continuing without one: $BACKGROUND_IMAGE"
  BACKGROUND_IMAGE=""
fi

APP_NAME="$(basename "$APP_PATH")"
STAGING_DIR="$(mktemp -d)"
RW_DMG="$(mktemp /tmp/nova-dmg-rw.XXXXXX.dmg)"
ATTACH_DEV=""
ATTACH_MOUNT=""

cleanup() {
  if [ -n "$ATTACH_DEV" ]; then
    hdiutil detach "$ATTACH_DEV" -quiet >/dev/null 2>&1 || hdiutil detach "$ATTACH_DEV" -force -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$STAGING_DIR" "$RW_DMG"
}
trap cleanup EXIT

ditto "$APP_PATH" "$STAGING_DIR/$APP_NAME"
ln -s /Applications "$STAGING_DIR/Applications"
cat > "$STAGING_DIR/Install Nova.txt" <<'EOF'
1. Drag Nova.app onto Applications.
2. Open Nova from Applications.

Note: Run Nova from Applications (not from the mounted DMG) so auto-updates work correctly.
EOF

apply_layout=false
if command -v osascript >/dev/null 2>&1; then
  apply_layout=true
fi

if $apply_layout; then
  layout_ok=true
  hdiutil create -quiet -volname "$VOLUME_NAME" -srcfolder "$STAGING_DIR" -ov -format UDRW "$RW_DMG"
  ATTACH_OUTPUT="$(hdiutil attach -readwrite -noverify -noautoopen "$RW_DMG")"
  ATTACH_DEV="$(printf '%s\n' "$ATTACH_OUTPUT" | awk '/\/dev\// {print $1; exit}')"
  ATTACH_MOUNT="$(printf '%s\n' "$ATTACH_OUTPUT" | awk -F'\t' '/\/Volumes\// {print $NF; exit}')"

  if [ -z "$ATTACH_DEV" ] || [ -z "$ATTACH_MOUNT" ]; then
    layout_ok=false
  else
    if [ -n "$BACKGROUND_IMAGE" ]; then
      mkdir -p "$ATTACH_MOUNT/.background"
      ditto "$BACKGROUND_IMAGE" "$ATTACH_MOUNT/.background/background.png"
    fi

    BG_APPLESCRIPT=""
    if [ -n "$BACKGROUND_IMAGE" ]; then
      BG_APPLESCRIPT='set background picture of viewOptions to file ".background:background.png"'
    fi

    osascript <<EOF || layout_ok=false
tell application "Finder"
  tell disk "$VOLUME_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {120, 120, 820, 560}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set text size of viewOptions to 14
    $BG_APPLESCRIPT
    set position of item "$APP_NAME" of container window to {180, 245}
    set position of item "Applications" of container window to {520, 245}
    try
      set position of item "Install Nova.txt" of container window to {350, 390}
    end try
    close
    open
    update without registering applications
    delay 1
  end tell
end tell
EOF
  fi

  sync
  if [ -n "$ATTACH_DEV" ]; then
    hdiutil detach "$ATTACH_DEV" -quiet || hdiutil detach "$ATTACH_DEV" -force -quiet || true
  fi
  ATTACH_DEV=""
  ATTACH_MOUNT=""

  if $layout_ok; then
    hdiutil convert "$RW_DMG" -quiet -format UDZO -imagekey zlib-level=9 -ov -o "$DMG_PATH"
    echo "Created DMG with custom Finder layout: $DMG_PATH"
    exit 0
  fi

  echo "Warning: Finder layout pass failed. Falling back to standard DMG creation."
fi

hdiutil create -volname "$VOLUME_NAME" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_PATH"
echo "Created DMG (fallback mode): $DMG_PATH"
