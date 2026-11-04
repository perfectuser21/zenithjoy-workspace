#!/usr/bin/env bash
# Compatibility operator entry; no implicit production URL or missing-cookie PASS.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec bash "$ROOT/.github/workflows/scripts/operator-probes/clips-ocr.sh" "$@"
