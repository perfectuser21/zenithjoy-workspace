#!/usr/bin/env bash
# GP-Anchor: line02/keyword_acquisition#step2
# 真机骨架形状的隔离真实CLI回放；不操作手机/生产DB。
set -euo pipefail
cd "$(dirname "$0")/../../../.."
test -s services/phone-adb-controller/__tests__/fixtures/real-keyword-return-skeleton-13.xml
zsh -n services/phone-adb-controller/douyin-phone-adb
node --test services/phone-adb-controller/__tests__/video-card-optional-fields.test.mjs
node --test --test-name-pattern='results-only' services/phone-adb-controller/__tests__/current-video-link-leave-scratch.test.mjs
