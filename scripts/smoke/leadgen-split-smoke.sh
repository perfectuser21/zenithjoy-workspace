#!/usr/bin/env bash
# 四新流程Activity/Step正式发布回归：真实运行node:test，不把该套件误当Vitest。
set -euo pipefail
cd "$(dirname "$0")/../.."
# 正式Pilot不继承HOME；测试须自建隔离目录，不能依赖开发机个人配置。
env -u HOME node --test --test-name-pattern='init: 额外导出|init\(preflight\) 就上报一条 span' \
 services/phone-adb-controller/__tests__/workflow-result.test.mjs \
 services/phone-adb-controller/__tests__/workflow-result-span.test.mjs
# 真机已出现的卡片消失/大证据超时先快速阻断，再跑完整合同回归。
node --test --test-name-pattern='原候选|出现消失候选|真实workflow包装器|大证据可使用60秒|keyword取链先退出暂存路线' \
 services/phone-adb-controller/__tests__/streaming-discovery.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-workflow.test.mjs \
 services/phone-adb-controller/__tests__/runtime-receipts.test.mjs \
 services/phone-adb-controller/__tests__/current-video-link-leave-scratch.test.mjs
node --test scripts/product-map/__tests__/leadgen-split-contracts.test.js \
 services/phone-adb-controller/__tests__/video-card-optional-fields.test.mjs \
 services/phone-adb-controller/__tests__/split-workflows.test.mjs \
 services/phone-adb-controller/__tests__/wf-run-retired.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-workflow.test.mjs \
 services/phone-adb-controller/__tests__/open-video-playing-page.test.mjs \
 services/phone-adb-controller/__tests__/continuous-identity.test.mjs \
 services/phone-adb-controller/__tests__/queued-video-budget-progress.test.mjs \
 services/phone-adb-controller/__tests__/commander-workflow-progress.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-client.test.mjs \
 services/phone-adb-controller/__tests__/discovery-receipt-recovery.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-discovery.test.mjs \
 services/phone-adb-controller/__tests__/streaming-discovery.test.mjs \
 services/phone-adb-controller/__tests__/queued-video.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-queue.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-rpc.test.mjs \
 services/phone-adb-controller/__tests__/runtime-definition.test.mjs \
 services/phone-adb-controller/__tests__/runtime-receipts.test.mjs \
 services/phone-adb-controller/__tests__/workflow-result.test.mjs \
 services/phone-adb-controller/__tests__/workflow-result-span.test.mjs \
 services/phone-adb-controller/__tests__/clipboard-nonce.test.mjs \
 services/phone-adb-controller/__tests__/copied-share-link.test.mjs \
 services/phone-adb-controller/__tests__/peer-share-link.test.mjs \
 services/phone-adb-controller/__tests__/current-video-link-leave-scratch.test.mjs \
 services/phone-adb-controller/__tests__/video-link-network.test.mjs
