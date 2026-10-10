#!/usr/bin/env bash
# GP-Anchor: line02/keyword_acquisition#step2
# 真机骨架形状的隔离真实CLI回放；不操作手机/生产DB。
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node --test --test-name-pattern='results-only' services/phone-adb-controller/__tests__/current-video-link-leave-scratch.test.mjs
