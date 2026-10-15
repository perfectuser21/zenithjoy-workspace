#!/usr/bin/env bash
# 四新流程Activity/Step正式发布回归：真实运行node:test，不把该套件误当Vitest。
set -euo pipefail
cd "$(dirname "$0")/../.."
# 单Activity Code→Skill真实工具闭环与未知发送防重发；Gateway/设备均隔离夹具。
node --test services/phone-adb-controller/__tests__/activity-skill-*.test.mjs
# MMV实际主机名变更时仍核精确身份与真实collector；相似机器不得通过。
node --test services/phone-adb-controller/__tests__/runtime-host.test.mjs services/phone-adb-controller/__tests__/deployment-unified.test.mjs services/phone-adb-controller/__tests__/deployment-preflight.test.mjs services/phone-adb-controller/__tests__/deployment-prepare.test.mjs
# 正式入口用例参数化覆盖aad17-2/r10-7和拒绝相似主机、手机身份、非103流程。
# 取链预算与正式路由先快速阻断：传输夹具不冒真实业务成功，正式入口仍核凭据/冻结。
node --test --test-name-pattern='真实26.511秒|正式MMV路由|MMV路由非法|真实prepare CLI消费路由env|正式入口加载凭据后保留' \
 services/phone-adb-controller/__tests__/leadgen-client.test.mjs \
 services/phone-adb-controller/__tests__/runtime-receipts.test.mjs \
 services/phone-adb-controller/__tests__/split-workflows.test.mjs
# 先运行实际部署语法命令，防止混合列表中的Python锁文件被Node校验到正式部署才失败。
node --test services/phone-adb-controller/__tests__/deploy-runtime-files.test.mjs services/phone-adb-controller/__tests__/deployment-release-evidence.test.mjs
# 配套Skill的源绑定、完整分发与漂移覆盖必须先通过；不冒作实际接手验收。
node scripts/product-map/leadgen-methods.mjs
node --test scripts/product-map/__tests__/leadgen-methods.test.js
node --test scripts/product-map/__tests__/leadgen-workflow-skill.test.js services/phone-adb-controller/__tests__/leadgen-skill-source-contract.test.mjs services/phone-adb-controller/__tests__/drift-check.test.mjs
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
node --test services/phone-adb-controller/__tests__/async-outreach-bridge.test.mjs \
 services/phone-adb-controller/__tests__/recipient-evidence.test.mjs \
 services/phone-adb-controller/__tests__/outreach-walking-skeleton.test.mjs \
 services/phone-adb-controller/__tests__/outreach-queue-boundary.test.mjs \
 services/phone-adb-controller/__tests__/private-message-delta.test.mjs \
 scripts/product-map/__tests__/leadgen-split-contracts.test.js \
 services/phone-adb-controller/__tests__/video-card-optional-fields.test.mjs \
 services/phone-adb-controller/__tests__/card-bottom-reveal.test.mjs \
 services/phone-adb-controller/__tests__/viewport-restore.test.mjs \
 services/phone-adb-controller/__tests__/split-workflows.test.mjs \
 services/phone-adb-controller/__tests__/wf-run-retired.test.mjs \
 services/phone-adb-controller/__tests__/empty-collection.test.mjs \
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
 services/phone-adb-controller/__tests__/deregistered-comment.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-queue.test.mjs \
 services/phone-adb-controller/__tests__/leadgen-rpc.test.mjs \
 services/phone-adb-controller/__tests__/runtime-definition.test.mjs \
 services/phone-adb-controller/__tests__/step-dod-judge.test.mjs \
 services/phone-adb-controller/__tests__/runtime-receipts.test.mjs \
 services/phone-adb-controller/__tests__/workflow-result.test.mjs \
 services/phone-adb-controller/__tests__/workflow-result-span.test.mjs \
 services/phone-adb-controller/__tests__/clipboard-nonce.test.mjs \
 services/phone-adb-controller/__tests__/copied-share-link.test.mjs \
 services/phone-adb-controller/__tests__/peer-share-link.test.mjs \
 services/phone-adb-controller/__tests__/current-video-link-leave-scratch.test.mjs \
 services/phone-adb-controller/__tests__/video-link-network.test.mjs
