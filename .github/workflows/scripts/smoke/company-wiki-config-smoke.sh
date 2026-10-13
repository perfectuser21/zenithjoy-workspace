#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
node --test "$ROOT/services/phone-adb-controller/__tests__/company-config.test.mjs"
