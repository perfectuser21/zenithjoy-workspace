#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
# The glob runner installs API/panel workspaces; GeoAI's Astro/devalue may be absent.
# Reuse the existing golden-path-f1 smoke's lock-based root dependency bootstrap.
if ! node -e "require.resolve('devalue')" >/dev/null 2>&1; then
  npm ci --no-audit --no-fund
fi
node --test .github/workflows/scripts/tests/devalue-security.test.mjs
