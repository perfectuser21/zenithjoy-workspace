#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node --test .github/workflows/scripts/tests/devalue-security.test.mjs
