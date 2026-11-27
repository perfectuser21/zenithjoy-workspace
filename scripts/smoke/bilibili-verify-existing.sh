#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

node --test \
  services/phone-adb-controller/__tests__/bilibili-verify-release.test.mjs \
  services/phone-adb-controller/__tests__/bilibili-verify-native.test.mjs \
  services/phone-adb-controller/__tests__/bilibili-verify-worker.test.mjs \
  services/phone-adb-controller/__tests__/standalone-bilibili-verify.test.mjs
