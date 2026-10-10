#!/usr/bin/env bash
# 四新流程Activity/Step正式发布回归：真实运行node:test，不把该套件误当Vitest。
set -euo pipefail
cd "$(dirname "$0")/../.."
node --test scripts/product-map/__tests__/leadgen-split-contracts.test.js \
 services/phone-adb-controller/__tests__/split-workflows.test.mjs \
 services/phone-adb-controller/__tests__/wf-run-retired.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-workflow.test.mjs \
 services/phone-adb-controller/__tests__/open-video-playing-page.test.mjs \
 services/phone-adb-controller/__tests__/queued-video-budget-progress.test.mjs \
 services/phone-adb-controller/__tests__/commander-workflow-progress.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-client.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-discovery.test.mjs \
 services/phone-adb-controller/__tests__/streaming-discovery.test.mjs \
 services/phone-adb-controller/__tests__/queued-video.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-queue.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-rpc.test.mjs \
 services/phone-adb-controller/__tests__/runtime-definition.test.mjs \
 services/phone-adb-controller/__tests__/runtime-receipts.test.mjs \
 services/phone-adb-controller/__tests__/clipboard-nonce.test.mjs \
 services/phone-adb-controller/__tests__/copied-share-link.test.mjs \
 services/phone-adb-controller/__tests__/current-video-link-leave-scratch.test.mjs \
 services/phone-adb-controller/__tests__/video-link-network.test.mjs
