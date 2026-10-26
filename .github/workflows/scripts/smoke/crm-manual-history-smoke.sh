#!/usr/bin/env bash
set -euo pipefail
if [[ "${SMOKE_ALLOW_WRITE:-}" != "1" ]]; then
  echo 'SKIP: explicit SMOKE_ALLOW_WRITE=1 is required; no requests or writes performed.'
  exit 0
fi
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
# Explicit opt-in only. The integration script creates and destroys its own localhost database.
node scripts/test/crm-manual-history-integration.mjs
