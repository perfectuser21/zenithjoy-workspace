#!/usr/bin/env bash
# 四新流程Activity/Step正式发布回归：保留完整测试集合，以文件级并发避免串行分组超过发布预算。
set -euo pipefail
cd "$(dirname "$0")/../.."
# 配套方法静态合同仍为独立前置关卡，不把测试调度当作实际Skill接手验收。
node scripts/product-map/leadgen-methods.mjs
# 完整文件只调度一次；并发仅限文件，保留每个文件的原断言、内部顺序与超时。
node --test --test-concurrency=4 \
 scripts/product-map/__tests__/leadgen-methods.test.js \
 scripts/product-map/__tests__/leadgen-split-contracts.test.js \
 scripts/product-map/__tests__/leadgen-workflow-skill.test.js \
 services/phone-adb-controller/__tests__/activity-skill-agent.test.mjs \
 services/phone-adb-controller/__tests__/activity-skill-broker.test.mjs \
 services/phone-adb-controller/__tests__/activity-skill-handoff.test.mjs \
 services/phone-adb-controller/__tests__/activity-skill-integration.test.mjs \
 services/phone-adb-controller/__tests__/activity-skill-qualification.test.mjs \
 services/phone-adb-controller/__tests__/activity-skill-source.test.mjs \
 services/phone-adb-controller/__tests__/async-outreach-bridge.test.mjs \
 services/phone-adb-controller/__tests__/card-bottom-reveal.test.mjs \
 services/phone-adb-controller/__tests__/clipboard-nonce.test.mjs \
 services/phone-adb-controller/__tests__/commander-workflow-progress.test.mjs \
 services/phone-adb-controller/__tests__/continuous-identity.test.mjs \
 services/phone-adb-controller/__tests__/copied-share-link.test.mjs \
 services/phone-adb-controller/__tests__/current-video-link-leave-scratch.test.mjs \
 services/phone-adb-controller/__tests__/deploy-runtime-files.test.mjs \
 services/phone-adb-controller/__tests__/deployment-preflight.test.mjs \
 services/phone-adb-controller/__tests__/deployment-prepare.test.mjs \
 services/phone-adb-controller/__tests__/deployment-release-evidence.test.mjs \
 services/phone-adb-controller/__tests__/deployment-unified.test.mjs \
 services/phone-adb-controller/__tests__/deregistered-comment.test.mjs \
 services/phone-adb-controller/__tests__/discovery-receipt-recovery.test.mjs \
 services/phone-adb-controller/__tests__/drift-check.test.mjs \
 services/phone-adb-controller/__tests__/empty-collection.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-client.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-discovery.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-queue.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-rpc.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-skill-source-contract.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-workflow.test.mjs \
 services/phone-adb-controller/__tests__/open-video-playing-page.test.mjs \
 services/phone-adb-controller/__tests__/outreach-queue-boundary.test.mjs \
 services/phone-adb-controller/__tests__/outreach-walking-skeleton.test.mjs \
 services/phone-adb-controller/__tests__/peer-share-link.test.mjs \
 services/phone-adb-controller/__tests__/private-message-delta.test.mjs \
 services/phone-adb-controller/__tests__/queued-video-budget-progress.test.mjs \
 services/phone-adb-controller/__tests__/queued-video.test.mjs \
 services/phone-adb-controller/__tests__/recipient-evidence.test.mjs \
 services/phone-adb-controller/__tests__/runtime-definition.test.mjs \
 services/phone-adb-controller/__tests__/runtime-host.test.mjs \
 services/phone-adb-controller/__tests__/runtime-receipts.test.mjs \
 services/phone-adb-controller/__tests__/split-smoke-budget-wiring.test.mjs \
 services/phone-adb-controller/__tests__/split-workflows.test.mjs \
 services/phone-adb-controller/__tests__/step-dod-judge.test.mjs \
 services/phone-adb-controller/__tests__/streaming-discovery.test.mjs \
 services/phone-adb-controller/__tests__/video-card-optional-fields.test.mjs \
 services/phone-adb-controller/__tests__/video-link-network.test.mjs \
 services/phone-adb-controller/__tests__/viewport-restore.test.mjs \
 services/phone-adb-controller/__tests__/wf-run-retired.test.mjs \
 services/phone-adb-controller/__tests__/workflow-result-span.test.mjs \
 services/phone-adb-controller/__tests__/workflow-result.test.mjs
# 正式Pilot不继承HOME；同两条用例仍在无HOME环境独立核验。
env -u HOME node --test --test-name-pattern='init: 额外导出|init\(preflight\) 就上报一条 span' \
 services/phone-adb-controller/__tests__/workflow-result.test.mjs \
 services/phone-adb-controller/__tests__/workflow-result-span.test.mjs
