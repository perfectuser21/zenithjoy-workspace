#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
runner="$root/.github/workflows/scripts/smoke/helpers/business-contracts.mjs"
test -s "$runner"
node "$runner" "$@"
node --test "$root/scripts/sessions/check-health.test.mjs" "$root/services/wechat-moments-controller/__tests__/safety.test.mjs"
