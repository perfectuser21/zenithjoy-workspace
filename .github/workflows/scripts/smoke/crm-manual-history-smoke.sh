#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
# Explicit opt-in only. The integration script creates and destroys its own localhost database.
node scripts/test/crm-manual-history-integration.mjs
