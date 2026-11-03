#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root"
node scripts/common-runner/sync.mjs --check
node --test scripts/common-runner/sync.test.mjs
