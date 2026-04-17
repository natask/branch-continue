#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Branch Continue.app"
SOURCE_APP="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
USER_APPS_DIR="$HOME/Applications"
USER_APP="$USER_APPS_DIR/$APP_NAME"
SYSTEM_APP="/Applications/$APP_NAME"

if [[ ! -d "$SOURCE_APP" ]]; then
  echo "Missing app bundle at:"
  echo "  $SOURCE_APP"
  echo "Run 'pnpm tauri:build' first."
  exit 1
fi

mkdir -p "$USER_APPS_DIR"
rm -rf "$USER_APP"
cp -R "$SOURCE_APP" "$USER_APP"

echo "Installed app to:"
echo "  $USER_APP"

if [[ -d "$SYSTEM_APP" ]]; then
  if rm -rf "$SYSTEM_APP" 2>/dev/null; then
    echo "Removed duplicate app from:"
    echo "  $SYSTEM_APP"
  else
    echo "Duplicate app still exists at:"
    echo "  $SYSTEM_APP"
    echo "Remove it manually if you want a single app icon:"
    echo "  sudo rm -rf \"$SYSTEM_APP\""
  fi
fi

open "$USER_APP"
echo "Launched app:"
echo "  $USER_APP"
