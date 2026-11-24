#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

node --test \
  services/phone-adb-controller/__tests__/leadgen-foundation-build.test.mjs \
  services/phone-adb-controller/__tests__/lightweight-101-discovery.test.mjs
