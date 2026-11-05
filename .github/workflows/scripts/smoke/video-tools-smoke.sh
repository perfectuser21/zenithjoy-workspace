#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$repo_root"
# All API/provider and Dashboard suites run once in media-contracts-smoke.sh.
# This retained caller owns only the additional distributed canvas graph/node contracts.
node .github/workflows/scripts/smoke/helpers/executed-node-contracts.mjs --vm-modules \
  infrastructure/comfyui/tests/starter-workflows.test.mjs \
  infrastructure/comfyui/tests/remake-extension.test.mjs
exec python3 .github/workflows/scripts/smoke/helpers/executed-python-contracts.py \
  infrastructure/comfyui/tests test_wan_remake.py
