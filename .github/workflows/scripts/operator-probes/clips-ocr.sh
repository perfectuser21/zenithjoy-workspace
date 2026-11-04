#!/usr/bin/env bash
# Explicit external-account OCR probe. Not a CI/code-regression check.
# Clips has no deletion endpoint: the created clip remains in the supplied operator account.
set -euo pipefail
[[ "${SMOKE_ALLOW_EXTERNAL_OCR:-}" == 1 ]] || { echo 'NOT RUN: SMOKE_ALLOW_EXTERNAL_OCR=1 is required'; exit 78; }
: "${API_URL:?an explicit API_URL is required}"
: "${SMOKE_SESSION_COOKIE:?an explicit logged-in operator cookie is required}"
: "${SMOKE_CLIP_SOURCE_URL:?an explicit authorized source URL is required}"
PROBE_DIR="$(mktemp -d)"
trap 'rm -rf "$PROBE_DIR"' EXIT
PAYLOAD="$(node -e 'process.stdout.write(JSON.stringify({url:process.argv[1]}))' "$SMOKE_CLIP_SOURCE_URL")"
curl --fail --silent --show-error --max-time 15 -X POST "$API_URL/api/clips" -H 'Content-Type: application/json' -H "Cookie: $SMOKE_SESSION_COOKIE" -d "$PAYLOAD" > "$PROBE_DIR/created.json"
CLIP_ID="$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));if(typeof d.id!=="string"||!d.id)process.exit(1);process.stdout.write(d.id)' "$PROBE_DIR/created.json")"
echo "Operator clip created: $CLIP_ID"
for _ in $(seq 1 30); do
  curl --fail --silent --show-error --max-time 10 "$API_URL/api/clips/$CLIP_ID" -H "Cookie: $SMOKE_SESSION_COOKIE" > "$PROBE_DIR/result.json"
  STATUS="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1])).status))' "$PROBE_DIR/result.json")"
  if [[ "$STATUS" == done ]]; then
    node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));if(typeof d.ocr_text!=="string"||!d.ocr_text.trim())process.exit(1)' "$PROBE_DIR/result.json"
    echo "PASS: operator OCR completed for clip $CLIP_ID"; exit 0
  fi
  [[ "$STATUS" != failed ]] || { echo "FAIL: OCR failed for clip $CLIP_ID"; exit 1; }
  sleep 2
done
echo "FAIL: bounded OCR wait expired for clip $CLIP_ID"; exit 1
