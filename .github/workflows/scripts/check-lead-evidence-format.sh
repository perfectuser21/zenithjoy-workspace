#!/usr/bin/env bash
# Format lint only: no device execution, platform readback, or authenticity claim.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DIR="${1:-$ROOT/.agent-knowledge/golden-path-1}"
shopt -s nullglob
FILES=("$DIR"/lead-acceptance-sprint-*.md)
VALIDATED=0
PLACEHOLDERS=0
for FILE in "${FILES[@]}"; do
  if grep -q '^> \*\*PLACEHOLDER\*\*' "$FILE"; then
    PLACEHOLDERS=$((PLACEHOLDERS + 1))
    continue
  fi
  bash "$ROOT/scripts/check-lead-acceptance.sh" "$FILE"
  VALIDATED=$((VALIDATED + 1))
done
if [ "$VALIDATED" -eq 0 ]; then
  echo "FAIL: no non-placeholder evidence files validated (files=${#FILES[@]} placeholders=$PLACEHOLDERS)" >&2
  exit 1
fi
echo "FORMAT_LINT_PASS: validated=$VALIDATED placeholders=$PLACEHOLDERS; DEVICE_NOT_RUN; PLATFORM_READBACK_NOT_VERIFIED"
