contract_branch: cp-08031845-harness-propose-r1-9488436
sprint_dir: sprints/08031620-android-scan-preconditions

---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Sprint: 安卓账号扫描前置条件修复（锁屏+后台启动拦截+错误码分层）

**范围**: `services/agent-android` 新增 `AccountScanFailureClassifier` 分类函数 + `DeviceAccountScanService.kt` 前置检查接线 + `AgentService.kt` body 拼装扩展 + `apps/api/src/routes/agent-burner.ts` detail 持久化扩展 + Agent 诊断页后台弹窗权限自检展示项 + bump versionCode
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `AccountScanFailureClassifier` 分类函数文件存在
  Test: node -e "process.exit(require('fs').existsSync('services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/AccountScanFailureClassifier.kt') ? 0 : 1)"

- [ ] [ARTIFACT] `SCREEN_LOCKED` / `LAUNCH_BLOCKED` 错误码字面量已接入 `DeviceAccountScanService.kt`
  Test: node -e "const c=require('fs').readFileSync('services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt','utf8'); if(!c.includes('SCREEN_LOCKED')||!c.includes('LAUNCH_BLOCKED'))process.exit(1)"

- [ ] [ARTIFACT] versionCode 已 bump（本 sprint 前基线 23）
  Test: node -e "const c=require('fs').readFileSync('services/agent-android/app/build.gradle.kts','utf8'); const m=c.match(/versionCode\s*=\s*(\d+)/); if(!m||parseInt(m[1],10)<=23)process.exit(1)"

## Invariant 覆盖条目

N/A：本 line（客户智能获客路径）当前无与安卓账号扫描直接相关的 invariant 记录（已查 golden-path-decisions/invariants 三源——step 级/journey_feature 级/area 级，均为空或不相关，详见 sprint-prd.md Invariant 约束段）

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 07-31 真实锁屏 tree_dump 被分类器正确识别为锁屏
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AccountScanFailureClassifierTest*" 2>&1 | tee /tmp/t1.log; grep -q "BUILD SUCCESSFUL" /tmp/t1.log || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 07-30 真实 launcher tree_dump 被分类器正确识别为桌面 launcher（同一测试类内）
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AccountScanFailureClassifierTest*" 2>&1 | tee /tmp/t2.log; grep -q "BUILD SUCCESSFUL" /tmp/t2.log || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 正常态 tree_dump 不被误判为锁屏/launcher（假阳性防护）
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AccountScanFailureClassifierTest*" --tests "*normal*" 2>&1 | tee /tmp/t3.log; grep -q "BUILD SUCCESSFUL" /tmp/t3.log || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `buildAccountScanResultBody()` 输出 JSON 含 version_name/stage/foreground_package 三新字段
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AgentServiceAccountScanTest*" 2>&1 | tee /tmp/t4.log; grep -q "BUILD SUCCESSFUL" /tmp/t4.log || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 服务端 `agent_scan_failures.detail` 真实持久化三新字段（真 Postgres 集成测试，非 mock——注意不是 src/routes/agent-burner.test.ts，那个文件 mock 了 pool.query，此项必须用真 PG 集成测试文件）
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts --reporter=verbose 2>&1 | tee /tmp/t5.log; grep -qE "passed|✓" /tmp/t5.log || exit 1; ! grep -qE "✗|failed \(" /tmp/t5.log || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 既有回归测试不被破坏：`SCAN_TIMEOUT` 超时上报机制保持通过
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*DeviceAccountScanServiceCleanupTest*" 2>&1 | tee /tmp/t6.log; grep -q "BUILD SUCCESSFUL" /tmp/t6.log || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 诊断页后台弹窗权限自检函数覆盖 true/false 两分支
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*BackgroundPermission*" 2>&1 | tee /tmp/t7.log; grep -q "BUILD SUCCESSFUL" /tmp/t7.log || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `DeviceAccountScanService.kt` 在 SCREEN_LOCKED/LAUNCH_BLOCKED 调用点确实传入 versionName/foregroundPackage 参数（Risks 表问题2 mitigation，防调用点漏传静默失效）
  Test: manual:bash -c 'cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*DeviceAccountScanServiceDiagnosticFieldsCallSiteTest*" 2>&1 | tee /tmp/t8.log; grep -q "BUILD SUCCESSFUL" /tmp/t8.log || exit 1; echo OK'
  期望: OK

## 未覆盖真实链路清单（引用，同 contract-draft.md）

真机锁屏/后台拦截真实触发不在 JVM 单测覆盖范围，由已验证全绿的 nightly account-scan-realmachine-smoke.sh 车道在合并装机后自动回归（详见 contract-draft.md「未覆盖真实链路清单」段）。
