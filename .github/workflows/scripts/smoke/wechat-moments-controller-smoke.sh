#!/usr/bin/env bash
# Local adapter safety contract only; never physical device/business delivery proof.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
exec node --test "$ROOT/services/wechat-moments-controller/__tests__/safety.test.mjs"
