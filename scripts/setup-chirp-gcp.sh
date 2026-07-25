#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${BRANCH_CONTINUE_GCP_PROJECT_ID:-${GCP_PROJECT_ID:-}}"
PROJECT_NAME="Branch Continue"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-}"
SERVICE_ACCOUNT_NAME="branch-continue-chirp"
ENV_FILE=".env"
LOCATION="${BRANCH_CONTINUE_GCP_LOCATION:-${GCP_LOCATION:-us}}"

usage() {
  cat <<'EOF'
Usage: scripts/setup-chirp-gcp.sh [options]

Creates a GCP project for Branch Continue Chirp transcription, links billing,
enables Speech-to-Text, creates a service account, generates a key, and writes
the ignored .env values used by pnpm app:package / pnpm app:deploy.

Options:
  --project-id ID          New or existing GCP project ID. Default: branch-continue-YYMMDDHHMM
  --project-name NAME      Display name. Default: Branch Continue
  --billing-account ID     Existing billing account ID. Auto-selected only if exactly one open account exists.
  --service-account NAME   Service account name. Default: branch-continue-chirp
  --location LOCATION      Speech-to-Text location. Default: us
  --env-file PATH          Env file to update. Default: .env
  -h, --help               Show this help.

Example:
  pnpm voice:gcp:setup -- --project-id branch-continue-voice-123 --billing-account 000000-000000-000000

After this succeeds, run:
  pnpm app:deploy
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --project-id)
      PROJECT_ID="${2:?Missing value for --project-id}"
      shift 2
      ;;
    --project-name)
      PROJECT_NAME="${2:?Missing value for --project-name}"
      shift 2
      ;;
    --billing-account)
      BILLING_ACCOUNT_ID="${2:?Missing value for --billing-account}"
      shift 2
      ;;
    --service-account)
      SERVICE_ACCOUNT_NAME="${2:?Missing value for --service-account}"
      shift 2
      ;;
    --location)
      LOCATION="${2:?Missing value for --location}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:?Missing value for --env-file}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="branch-continue-$(date +%y%m%d%H%M)"
fi

if [[ ! "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "Invalid project ID: $PROJECT_ID" >&2
  echo "Use 6-30 lowercase letters, digits, and hyphens; start with a letter and end with a letter/digit." >&2
  exit 1
fi

if [[ ! "$SERVICE_ACCOUNT_NAME" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "Invalid service account name: $SERVICE_ACCOUNT_NAME" >&2
  echo "Use 6-30 lowercase letters, digits, and hyphens; start with a letter and end with a letter/digit." >&2
  exit 1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command gcloud
require_command node

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

if [[ -z "$BILLING_ACCOUNT_ID" ]]; then
  OPEN_BILLING_ACCOUNT_COUNT=0
  OPEN_BILLING_ACCOUNT_ID=""
  while IFS= read -r account_id; do
    [[ -z "$account_id" ]] && continue
    OPEN_BILLING_ACCOUNT_COUNT=$((OPEN_BILLING_ACCOUNT_COUNT + 1))
    OPEN_BILLING_ACCOUNT_ID="$account_id"
  done < <(gcloud billing accounts list --filter='open=true' --format='value(ACCOUNT_ID)')

  if [[ "$OPEN_BILLING_ACCOUNT_COUNT" -eq 1 ]]; then
    BILLING_ACCOUNT_ID="$OPEN_BILLING_ACCOUNT_ID"
  else
    echo "Could not auto-select billing account." >&2
    echo "Open billing accounts:" >&2
    gcloud billing accounts list --filter='open=true' >&2
    echo "Re-run with --billing-account ACCOUNT_ID." >&2
    exit 1
  fi
fi

echo "Using project: $PROJECT_ID"
echo "Using billing account: $BILLING_ACCOUNT_ID"
echo "Using Speech-to-Text model: chirp_3"
echo "Using Speech-to-Text location: $LOCATION"

if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Project already exists: $PROJECT_ID"
else
  gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
fi

BILLING_INFO="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled,billingAccountName)' 2>/dev/null || true)"
if [[ "$BILLING_INFO" == *"billingAccounts/${BILLING_ACCOUNT_ID}"* && "$BILLING_INFO" == *"True"* ]]; then
  echo "Billing already enabled for $PROJECT_ID."
elif ! gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"; then
  cat >&2 <<EOF

Could not link billing for $PROJECT_ID.

Google returned a billing quota limit. Request an increase here:
  https://support.google.com/code/contact/billing_quota_increase

Use these values:
  Billing account: $BILLING_ACCOUNT_ID
  Project ID: $PROJECT_ID
  Project display name: $PROJECT_NAME
  Reason: Need one additional billing-linked Google Cloud project for Branch Continue desktop app Speech-to-Text V2 Chirp transcription.

After Google approves the quota increase, rerun:
  pnpm voice:gcp:setup -- --project-id $PROJECT_ID --billing-account $BILLING_ACCOUNT_ID
EOF
  exit 1
fi
gcloud services enable speech.googleapis.com --project="$PROJECT_ID"

SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Service account already exists: $SERVICE_ACCOUNT_EMAIL"
else
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --project="$PROJECT_ID" \
    --display-name="Branch Continue Chirp Transcriber"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/speech.client" \
  --quiet >/dev/null

KEY_FILE="$(mktemp)"
cleanup() {
  rm -f "$KEY_FILE"
}
trap cleanup EXIT

gcloud iam service-accounts keys create "$KEY_FILE" \
  --iam-account="$SERVICE_ACCOUNT_EMAIL" \
  --project="$PROJECT_ID" >/dev/null

SERVICE_ACCOUNT_KEY_JSON="$(node -e "const fs=require('node:fs'); process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1], 'utf8'))))" "$KEY_FILE")"

set_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"
  local tmp
  tmp="$(mktemp)"

  if [[ -f "$file" ]]; then
    node - "$file" "$key" "$value" > "$tmp" <<'NODE'
const fs = require('node:fs')
const [file, key, value] = process.argv.slice(2)
const input = fs.readFileSync(file, 'utf8')
const lines = input.split(/\r?\n/)
let replaced = false
const output = lines.map((line) => {
  if (line.startsWith(`${key}=`)) {
    replaced = true
    return `${key}=${value}`
  }
  return line
})
if (!replaced) {
  if (output.length > 0 && output[output.length - 1] !== '') output.push('')
  output.push(`${key}=${value}`)
}
process.stdout.write(output.join('\n').replace(/\n*$/, '\n'))
NODE
  else
    printf '%s=%s\n' "$key" "$value" > "$tmp"
  fi

  mv "$tmp" "$file"
}

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
fi

set_env_var "VITE_GCP_PROJECT_ID" "$PROJECT_ID" "$ENV_FILE"
set_env_var "VITE_GCP_LOCATION" "$LOCATION" "$ENV_FILE"
set_env_var "BRANCH_CONTINUE_GCP_PROJECT_ID" "$PROJECT_ID" "$ENV_FILE"
set_env_var "BRANCH_CONTINUE_GCP_LOCATION" "$LOCATION" "$ENV_FILE"
set_env_var "BRANCH_CONTINUE_GCP_SERVICE_ACCOUNT_KEY" "$SERVICE_ACCOUNT_KEY_JSON" "$ENV_FILE"

echo "Wrote Chirp build configuration to $ENV_FILE"
echo "Do not commit $ENV_FILE. It contains a service account key."
echo "Next: run pnpm app:deploy to build, install, and launch with the embedded key."
