---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Sprint: 安卓账号扫描前置条件修复（锁屏+后台启动拦截+错误码分层）

**范围**: `services/agent-android` 新增 `AccountScanFailureClassifier` 分类函数 + `DeviceAccountScanService.kt` 前置检查接线 + `AgentService.kt` body 拼装扩展 + `apps/api/src/routes/agent-burner.ts` detail 持久化扩展 + Agent 诊断页后台弹窗权限自检展示项 + bump versionCode
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] `AccountScanFailureClassifier` 分类函数文件存在
  Test: node -e "process.exit(require('fs').existsSync('services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/AccountScanFailureClassifier.kt') ? 0 : 1)"

- [x] [ARTIFACT] `SCREEN_LOCKED` / `LAUNCH_BLOCKED` 错误码字面量已接入 `DeviceAccountScanService.kt`
  Test: node -e "const c=require('fs').readFileSync('services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt','utf8'); if(!c.includes('SCREEN_LOCKED')||!c.includes('LAUNCH_BLOCKED'))process.exit(1)"

- [x] [ARTIFACT] versionCode 已 bump（本 sprint 前基线 23）
  Test: node -e "const c=require('fs').readFileSync('services/agent-android/app/build.gradle.kts','utf8'); const m=c.match(/versionCode\s*=\s*(\d+)/); if(!m||parseInt(m[1],10)<=23)process.exit(1)"

## Invariant 覆盖条目

N/A：本 line（客户智能获客路径）当前无与安卓账号扫描直接相关的 invariant 记录（已查 golden-path-decisions/invariants 三源——step 级/journey_feature 级/area 级，均为空或不相关，详见 sprint-prd.md Invariant 约束段）

## BEHAVIOR 条目

- [x] [BEHAVIOR] 07-31 真实锁屏 tree_dump 被分类器正确识别为锁屏
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AccountScanFailureClassifierTest*" 2>&1 | tee /tmp/t1.log; grep -q "BUILD SUCCESSFUL" /tmp/t1.log || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] 07-30 真实 launcher tree_dump 被分类器正确识别为桌面 launcher（同一测试类内）
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AccountScanFailureClassifierTest*" 2>&1 | tee /tmp/t2.log; grep -q "BUILD SUCCESSFUL" /tmp/t2.log || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] 正常态 tree_dump 不被误判为锁屏/launcher（假阳性防护）
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AccountScanFailureClassifierTest*" --tests "*normal*" 2>&1 | tee /tmp/t3.log; grep -q "BUILD SUCCESSFUL" /tmp/t3.log || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] `buildAccountScanResultBody()` 输出 JSON 含 version_name/stage/foreground_package 三新字段
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AgentServiceAccountScanTest*" 2>&1 | tee /tmp/t4.log; grep -q "BUILD SUCCESSFUL" /tmp/t4.log || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR_FAIL] 服务端 `agent_scan_failures.detail` 真实持久化三新字段（真 Postgres 集成测试，非 mock）——Generator 自验发现两个预存在、与本 sprint 无关的环境问题，详见 PR 描述 Known Limitation：①`tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts` 未被本仓库任何现有 vitest config（`vitest.config.ts`/`vitest.integration.config.ts`）的 include glob 收录，也未被任何 CI workflow 引用（已 grep 全仓确认），是孤儿测试文件，本条命令无论加不加 `--config` 都会报 "No test files found"；②即使临时用自定义 config 强制收录该文件，其 `beforeAll` 引用的 `agents.machine_id` 列在当前 schema 中不存在（已用干净迁移的 `zenithjoy_test` 库验证，123 个迁移全部应用后该列仍不存在），属该文件早于本 sprint 就存在的 schema drift，与本 sprint 改动无关。逻辑正确性已通过：TypeScript 类型检查全过 + 与现有 `screenshot_b64`/`tree_dump` 已验证生产字段完全同款的类型守卫模式（`typeof x === 'string' ? x : null`）+ CI 实际收录的 `src/routes/agent-burner.test.ts`（35 用例全绿，含既有 `screenshot_b64`/`tree_dump` 断言）无回归。
  Test: manual:bash -c 'cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts --reporter=verbose 2>&1 | tee /tmp/t5.log; grep -qE "passed|✓" /tmp/t5.log || exit 1; ! grep -qE "✗|failed \(" /tmp/t5.log || exit 1; echo OK'
  期望: OK（已知因孤儿文件+预存在 schema drift 无法达成，见上）

- [x] [BEHAVIOR] 既有回归测试不被破坏：`SCAN_TIMEOUT` 超时上报机制保持通过
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*DeviceAccountScanServiceCleanupTest*" 2>&1 | tee /tmp/t6.log; grep -q "BUILD SUCCESSFUL" /tmp/t6.log || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] 诊断页后台弹窗权限自检函数覆盖 true/false 两分支
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*BackgroundPermission*" 2>&1 | tee /tmp/t7.log; grep -q "BUILD SUCCESSFUL" /tmp/t7.log || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] `DeviceAccountScanService.kt` 在 SCREEN_LOCKED/LAUNCH_BLOCKED 调用点确实传入 versionName/foregroundPackage 参数（Risks 表问题2 mitigation，防调用点漏传静默失效）
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*DeviceAccountScanServiceDiagnosticFieldsCallSiteTest*" 2>&1 | tee /tmp/t8.log; grep -q "BUILD SUCCESSFUL" /tmp/t8.log || exit 1; echo OK'
  期望: OK

## 未覆盖真实链路清单（引用，同 contract-draft.md）

真机锁屏/后台拦截真实触发不在 JVM 单测覆盖范围，由已验证全绿的 nightly account-scan-realmachine-smoke.sh 车道在合并装机后自动回归（详见 contract-draft.md「未覆盖真实链路清单」段）。
