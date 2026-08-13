#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${BRANCH_CONTINUE_APP_NAME:-Branch Continue.app}"
BUNDLE_ID="${BRANCH_CONTINUE_BUNDLE_ID:-com.natnael.branchcontinue}"
SOURCE_APP="${BRANCH_CONTINUE_SOURCE_APP:-$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME}"
USER_APPS_DIR="${BRANCH_CONTINUE_USER_APPS_DIR:-$HOME/Applications}"
USER_APP="$USER_APPS_DIR/$APP_NAME"
SYSTEM_APP="${BRANCH_CONTINUE_SYSTEM_APP:-/Applications/$APP_NAME}"
OSASCRIPT_COMMAND="${BRANCH_CONTINUE_OSASCRIPT_COMMAND:-/usr/bin/osascript}"
OPEN_COMMAND="${BRANCH_CONTINUE_OPEN_COMMAND:-/usr/bin/open}"
APP_STATE_TIMEOUT_SECONDS="${BRANCH_CONTINUE_APP_STATE_TIMEOUT_SECONDS:-15}"

app_is_running() {
  [[ "$($OSASCRIPT_COMMAND -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null || true)" == "true" ]]
}

wait_for_app_state() {
  local expected="$1"
  local deadline=$((SECONDS + APP_STATE_TIMEOUT_SECONDS))
  while (( SECONDS <= deadline )); do
    if app_is_running; then
      [[ "$expected" == "running" ]] && return 0
    else
      [[ "$expected" == "stopped" ]] && return 0
    fi
    sleep 1
  done
  return 1
}

if [[ ! -d "$SOURCE_APP" ]]; then
  echo "Missing app bundle at:"
  echo "  $SOURCE_APP"
  echo "Run 'pnpm tauri:build' first."
  exit 1
fi

if app_is_running; then
  echo "Stopping the installed app before replacement:"
  echo "  $USER_APP"
  "$OSASCRIPT_COMMAND" -e "tell application id \"$BUNDLE_ID\" to quit"
  if ! wait_for_app_state stopped; then
    echo "The installed app did not quit within ${APP_STATE_TIMEOUT_SECONDS}s; refusing to replace a running bundle." >&2
    exit 1
  fi
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

"$OPEN_COMMAND" "$USER_APP"
if ! wait_for_app_state running; then
  echo "The installed app did not launch within ${APP_STATE_TIMEOUT_SECONDS}s." >&2
  exit 1
fi
echo "Launched app:"
echo "  $USER_APP"
