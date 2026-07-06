---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 机器管理：安卓设备账号模型

**范围**: Android agent 账号扫描判定抽成纯函数（无 Android 框架依赖）：单次扫描内账号去重、双端登录冲突覆盖判定（以后上报者为准）+ 冲突覆盖后"标失效/写日志告警"判定（Round 2 新增）、tenant_id 绑定隔离、扫描数据保鲜（读取失败保留旧列表标 stale）、下线判定、派发时发现未登录立即触发重扫、全局互斥锁判定，共 9 个函数写 JUnit 单测；同时 `agent_platform_sessions` schema 扩展 `device_type` 列。Dashboard `device_type` 标签展示 + 无障碍服务真实读取可行性仅人工补验，不计入本次 Harness 自动裁决（PRD `target_environment_reason` 显式声明）。
**大小**: M

> 所有 Android [BEHAVIOR] 在 `services/agent-android` 目录跑 `gradle :app:testDebugUnitTest`。CI（`.github/workflows/android-agent-ci.yml`，`runs-on: ubuntu-latest`）runner 预装 Android SDK 自动设有 `ANDROID_HOME`，必须真跑；本地开发机缺 `ANDROID_HOME` 时该条命令降级输出 `SKIP(no ANDROID_HOME) — logic-done-pending`，不得据此直接判 done。Schema [BEHAVIOR] 用 `psql $DB` 真查，缺 `$DB` 时同样降级为 `SKIP — logic-done-pending`。

## ARTIFACT 条目

- [ ] [ARTIFACT] `DeviceAccountModel` object + 九个纯函数在 `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountModel.kt` 中定义
  Test: manual:bash -c 'f=services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountModel.kt; [ -f "$f" ] || { echo FAIL; exit 1; }; for fn in dedupeSameDeviceAccounts resolveDeviceConflict shouldInvalidateOldDeviceRecord shouldLogConflictAlert filterAccountsByTenant resolveScanReadResult checkAccountOffline evaluateDispatchAccountStatus shouldSkipScanDueToMutex; do grep -q "fun $fn" "$f" || { echo "FAIL: missing $fn"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [ARTIFACT] 合同测试文件已原样复制进真实 Android 单测源码树（TDD red → green 承接）
  Test: manual:bash -c 'diff sprints/07061204-android-device-account-model/tests/android/DeviceAccountModelLogicTest.kt services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountModelLogicTest.kt >/dev/null || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] `agent_platform_sessions` schema 扩展迁移文件存在（新增 `device_type` 字段）
  Test: manual:bash -c 'grep -l "device_type" apps/api/db/migrations/*.sql | xargs grep -lq "agent_platform_sessions" && echo OK || { echo FAIL; exit 1; }'
  期望: OK

## BEHAVIOR 条目（manual:bash，Android gradle 单测 + psql schema 真跑，非 mock）

- [ ] [BEHAVIOR] 全局互斥锁判定——采集/触达任务运行中本轮跳过，未运行则正常扫描（Golden Path Step 1）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "collect or outreach task running means scan should be skipped this cycle" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "no collect or outreach task running means scan should proceed" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 扫描数据保鲜——读取成功更新活跃列表，读取失败保留旧列表标 stale 不用空值覆盖（Golden Path 边界情况段）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "successful scan read updates active list" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "failed scan read (accessibility timeout etc) keeps previous list and marks stale" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 单次扫描内账号去重——保持首次出现顺序，无重复/空列表原样返回（Golden Path Step 3）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "duplicate douyin ids in single scan are deduped preserving order" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "empty scan list dedupes to empty list" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] tenant_id 绑定隔离——只返回目标租户账号，多租户互不串（Golden Path Step 4，Invariant 租户隔离铁律）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "filters accounts to only the queried tenant, excluding other tenants" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "second tenant query returns only its own accounts, none leak from tenant-1" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 双端登录冲突覆盖判定——同设备/无绑定不算冲突，不同设备以后上报者为准覆盖，过期上报不覆盖（Golden Path Step 5）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "no existing binding (first scan) yields NO_CONFLICT" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "different device with later scan timestamp overwrites existing" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "different device with earlier (stale, out-of-order) scan timestamp keeps existing" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 冲突覆盖后"标失效+写日志告警"判定（Round 2 新增，补齐 Step 5 后半句）——仅 OVERWRITE_EXISTING 触发标失效与写告警，NO_CONFLICT/KEEP_EXISTING_STALE_REPORT 均不触发（Golden Path Step 5 后半句）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "OVERWRITE_EXISTING resolution should invalidate old device record" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "NO_CONFLICT resolution should not invalidate old device record" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "OVERWRITE_EXISTING resolution should log conflict alert" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "KEEP_EXISTING_STALE_REPORT resolution should not log conflict alert" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 下线判定——记录账号仍在当前登录列表则在线，不在（或列表为空）则离线（Golden Path Step 5）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "account still present in currently logged-in list is ONLINE" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "account missing from currently logged-in list WENT_OFFLINE" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 派发时发现未登录立即触发重扫——记录在线但实际未登录判定 TRIGGER_RESCAN_AND_FAIL，其余情况 PROCEED（Golden Path Step 7）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "dispatch finds account recorded online but actually logged out triggers rescan and fails task" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; grep -qF "dispatch finds account recorded online and actually still logged in proceeds normally" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 冲突覆盖判定对时间戳相等的边界场景（tie-break）明确判 OVERWRITE_EXISTING，防止 Generator 用 `>` 而非 `>=` 导致边界漂移
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; grep -qF "different device with equal scan timestamp overwrites existing (later reporter wins ties)" "$XML" || { echo "FAIL: testcase missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `agent_platform_sessions` schema 已扩展 `device_type` 字段，可用 psql 查到（Golden Path Step 8/出口，PRD E2E 验收点 5）
  Test: manual:bash -c 'set -e; if [ -z "${DB:-}" ]; then echo "SKIP(no \$DB) — logic-done-pending"; exit 0; fi; C=$(psql "$DB" -t -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='"'"'zenithjoy'"'"' AND table_name='"'"'agent_platform_sessions'"'"' AND column_name='"'"'device_type'"'"'" | tr -d " "); [ "$C" = "1" ] || { echo "FAIL: device_type 列不存在"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `agent_platform_sessions` 既有 `role` CHECK 约束未被本次 schema 变更破坏（回归防护，对应"已知约束"段）
  Test: manual:bash -c 'set -e; if [ -z "${DB:-}" ]; then echo "SKIP(no \$DB) — logic-done-pending"; exit 0; fi; C=$(psql "$DB" -t -c "SELECT count(*) FROM pg_constraint WHERE conname='"'"'chk_aps_role'"'"' AND conrelid='"'"'zenithjoy.agent_platform_sessions'"'"'::regclass" | tr -d " "); [ "$C" = "1" ] || { echo "FAIL: chk_aps_role 约束缺失，疑似被破坏"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 单测用例总数 ≥ 26，防止 Generator 删测试假绿通过（覆盖九块纯函数全部场景，Round 2 新增 6 条后总数应为 29）
  Test: manual:bash -c 'set -e; cd services/agent-android; [ -n "${ANDROID_HOME:-}" ] || { echo "SKIP(no ANDROID_HOME) — logic-done-pending"; exit 0; }; gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun; XML=app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml; grep -q "failures=\"0\" errors=\"0\"" "$XML" || { echo FAIL; exit 1; }; COUNT=$(grep -o "tests=\"[0-9]*\"" "$XML" | head -1 | grep -o "[0-9]*"); [ "$COUNT" -ge 26 ] || { echo "FAIL: only $COUNT tests"; exit 1; }; echo OK'
  期望: OK

## 接缝清单（人工真机/前端补验，未验前不得标 done——详见 contract-draft.md）

1. 抖音"切换账号"界面无障碍服务能否真实读到当前登录账号列表 — 人工在 Honor 真机（Tailscale IP 100.91.227.1）确认可行性，读不到需降级为主动打开弹窗扫描
2. 扫描流程超时强制退出"切换账号"界面，不留半开状态 — 人工真机手动触发崩溃/锁屏场景核实
3. Dashboard 机器管理页 `device_type` 标签真实展示（跟 Web 小号同列表） — 人工在 Dashboard 手动核实一次
4.（Round 2 新增）tenant_id 来源约束：`tenantId` 参数必须由服务端按 agent_id 反查得到（对齐"同机双租户 deny"修复严格程度），不得信任 Android 设备上报值——Generator 阶段实现约束，纯函数层面无法验证调用方传参来源，需 code review 人工核实

## 产品风险登记（Risks，详见 contract-draft.md "产品风险登记" 段）

1. 双端冲突覆盖判定依赖服务端时间戳而非设备本地时间，若 Generator 误用设备本地时间会导致 clock skew 误判 — 本轮已通过纯函数签名约定（`scanAtMs` 语义明确为"中台接收扫描请求时打的时间戳"）+ Step 5 五条 [BEHAVIOR]/测试覆盖降低风险，服务端时间戳注入点本身超出本次纯函数验收范围
2. 无障碍服务读取技术可行性未最终确认（PRD `[ASSUMPTION]`）— PRD 已拍板"两种方案判定逻辑相同，不影响本次可测试范围"，接缝清单第 1 条待真机验证
3.（Round 2 新增）"标失效+写日志告警"落地动作（调用方是否真执行副作用代码）未被自动化验收覆盖 — Mitigation：本轮已新增 `shouldInvalidateOldDeviceRecord`/`shouldLogConflictAlert` 两个纯函数把"该不该做"判定显式覆盖，"真的做了"这层调用方副作用验证超出本 sprint 纯函数验收范围，需 code review + 未来 sprint 补充调用方集成测试
4.（Round 2 新增）`shouldSkipScanDueToMutex` 只测布尔透传，三个无障碍服务共享同一把全局互斥锁的真实竞态（TOCTOU）未被本 sprint 覆盖 — Mitigation：标注为超出本 sprint 范围，属于 Generator 集成代码的职责，列入接缝清单供未来 sprint 或人工真机验证跟进
