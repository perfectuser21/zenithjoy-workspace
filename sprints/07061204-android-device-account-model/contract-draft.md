# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

本 sprint 核心产出是 Android agent 内部纯函数（Kotlin，无网络/DB 交互）+ `agent_platform_sessions` schema 扩展（DB 层，无新增 HTTP 端点）。四块纯函数的输入/输出签名如下（相当于本 sprint 的"Schema"）：

### `dedupeSameDeviceAccounts(scannedDouyinIds: List<String>): List<String>`
- 输入：单次扫描读到的账号 id 列表（可能含重复）
- 输出：去重后列表，保持首次出现顺序
- 来源：PRD Golden Path Step 3（"打开抖音切换账号界面读取账号列表"隐含单次扫描内去重需求）

### `resolveDeviceConflict(existingDeviceId: String?, existingScanAtMs: Long?, newDeviceId: String, newScanAtMs: Long): ConflictResolution`
- 输入：该账号已有绑定的设备 id + 绑定时间戳（null=未绑定过）、新上报设备 id + 本次扫描时间戳
- 输出：`ConflictResolution` 枚举 `{ NO_CONFLICT, OVERWRITE_EXISTING, KEEP_EXISTING_STALE_REPORT }`
- 来源：PRD Golden Path Step 5（"若发现某账号新出现在这台设备但已绑定在另一台安卓设备上 → 以后上报者为准覆盖，旧设备记录标为失效并写日志告警"）+ NFR"双端登录冲突"拍板值

### `ScannedAccount(douyinId: String, deviceId: String, tenantId: String, scanAtMs: Long)` + `filterAccountsByTenant(all: List<ScannedAccount>, tenantId: String): List<ScannedAccount>`
- 输入：全部扫描到的账号记录（跨设备/跨租户）+ 目标 tenant_id
- 输出：仅属于该 tenant_id 的账号记录（Invariant"租户隔离"：碰租户数据的查询必须 scope 到当前租户）
- 来源：PRD Golden Path Step 4（"扫描结果...绑定当前 agent 的 tenant_id"）

### `resolveScanReadResult(readSucceeded: Boolean): ScanReadOutcome`
- 输入：本次扫描读取是否成功（无障碍服务读取失败/超时 → false）
- 输出：`ScanReadOutcome` 枚举 `{ UPDATE_ACTIVE_LIST, KEEP_PREVIOUS_MARK_STALE }`
- 来源：PRD 边界情况段（"无障碍服务读不到账号列表 → 保留上一次已知列表并标记 stale，不用空值覆盖"）

### `checkAccountOffline(recordedDouyinId: String, currentlyLoggedInIds: List<String>): AccountOfflineStatus`
- 输入：中台记录的账号 id + 本次扫描实际读到的当前登录账号列表
- 输出：`AccountOfflineStatus` 枚举 `{ ONLINE, WENT_OFFLINE }`
- 来源：PRD Golden Path Step 5（"若扫描发现某账号不再登录该设备 → 标记该记录离线"）

### `evaluateDispatchAccountStatus(recordedOnline: Boolean, actualLoggedInAtDispatch: Boolean): DispatchAccountDecision`
- 输入：中台记录的在线状态 + 派发采集/触达任务时实际探测到的登录状态
- 输出：`DispatchAccountDecision` 枚举 `{ PROCEED, TRIGGER_RESCAN_AND_FAIL }`
- 来源：PRD Golden Path Step 7（"派发采集/触达任务时，若执行中发现目标账号在手机上未登录（跟中台记录不一致）→ 立即触发一次实时重新扫描更新状态，不等下个周期，该次任务按未登录处理转失败/人工核实"）

### `shouldSkipScanDueToMutex(isCollectOrOutreachRunning: Boolean): Boolean`
- 输入：全局互斥锁当前是否被采集/触达任务持有
- 输出：本轮账号扫描是否应跳过
- 来源：PRD Golden Path Step 2（"扫描前检查全局互斥锁，若采集/触达任务正在跑则本轮跳过，等下一个周期"）+ NFR"并发控制"拍板值

**禁用命名**：不得把 `ConflictResolution` 枚举值改名为 `WIN`/`LOSE`/`CONFLICT` 等同义词——PRD 用词是"以后上报者为准覆盖/旧设备记录标为失效"，枚举值固定 `NO_CONFLICT`/`OVERWRITE_EXISTING`/`KEEP_EXISTING_STALE_REPORT`；`ScanReadOutcome`/`AccountOfflineStatus`/`DispatchAccountDecision` 同理固定用测试文件里的枚举名。

---

## 已知约束（来自回归测试）

<!-- 关键词匹配：微信/wechat → 无命中；视频/video → 无命中；发布/publisher → 无命中（本 sprint 是机器管理/账号扫描领域）；额外按"机器管理/agent_platform_sessions"检索 -->

- `sprints/07032332-line02-account-role-unify/tests/account-role-unify.test.ts` → `agent_platform_sessions` 现有列约定：`agent_id`/`platform`/`account_label`/`role`/`status`/`bound_at`/`created_at`；`role` 已有 CHECK `IN ('main','burner')`；`status` 已有 CHECK 含 `pending/active/connected/offline/expired/bound/needs_rebind`。本 sprint 新增 `device_type` 字段与已有列并存，不得破坏这些既有 CHECK 约束与唯一索引 `UNIQUE(agent_id, platform, account_label)`。
- `apps/api/db/migrations/20260524_110000_agent_platform_sessions_status_add_offline_connected.sql` → `status='offline'` 已是合法值，本 sprint Step 5"标记该记录离线"应复用现有 `offline` 状态值，不新造同义状态名。
- `apps/api/tests/regression/line04-cs-tenant-isolation.test.ts` → 本 line（Line02）历史上无该文件对应的直接回归约束，但 Invariant"租户隔离"铁律与该测试同源准则一致：多租户场景查询必须 scope 到 tenant_id，本 sprint `filterAccountsByTenant` 纯函数即落地此铁律的可测试单元。

---

## Golden Path

[Android agent 低频扫描] → [互斥锁判定] → [读取账号列表(成功/失败)] → [tenant_id 绑定+去重] → [双端冲突覆盖/下线判定] → [Dashboard 展示] → [派发时重扫触发]

### Step 1: 全局互斥锁判定 — 采集/触达任务运行中本轮跳过
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 2（"扫描前检查全局互斥锁，若采集/触达任务正在跑则本轮跳过，等下一个周期"）+ NFR"并发控制"拍板值

**可观测行为**: `isCollectOrOutreachRunning=true` → `shouldSkipScanDueToMutex` 返回 `true`（本轮跳过）；`false` → 返回 `false`（正常扫描）

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml
```

**硬阈值**: 单测全绿（`failures="0" errors="0"`），对应 test case `collect or outreach task running means scan should be skipped this cycle` / `no collect or outreach task running means scan should proceed`

---

### Step 2: 扫描读取失败时保留旧列表标记 stale（不用空值覆盖）
**来源**: `[FROM_PRD]` — 边界情况段（"无障碍服务读不到账号列表 → 保留上一次已知列表并标记 stale，不用空值覆盖"）

**可观测行为**: `readSucceeded=true` → `resolveScanReadResult` 返回 `UPDATE_ACTIVE_LIST`；`readSucceeded=false`（读取失败/超时/App崩溃）→ 返回 `KEEP_PREVIOUS_MARK_STALE`

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `successful scan read updates active list` / `failed scan read (accessibility timeout etc) keeps previous list and marks stale`

---

### Step 3: 单次扫描内账号去重
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 3（"打开抖音切换账号界面读取账号列表"隐含读到的原始列表需去重后再写库）

**可观测行为**: 扫描原始列表含重复 douyin id → `dedupeSameDeviceAccounts` 去重并保持首次出现顺序；无重复/空列表原样返回

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `duplicate douyin ids in single scan are deduped preserving order` / `scan with no duplicates is unaffected` / `empty scan list dedupes to empty list`

---

### Step 4: tenant_id 绑定隔离（多租户互不串）
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 4（"系统把扫描结果...绑定当前 agent 的 tenant_id"）+ Invariant"租户隔离"铁律 + Invariant"测试默认多租户"铁律

**可观测行为**: `filterAccountsByTenant` 只返回与目标 tenant_id 相同的账号记录，不同 tenant_id 的记录绝不出现在结果中（本合同用 ≥2 个租户断言互不串）

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `filters accounts to only the queried tenant, excluding other tenants` / `second tenant query returns only its own accounts, none leak from tenant-1` / `tenant with no matching accounts returns empty list` / `empty account list filters to empty regardless of tenant`

---

### Step 5: 双端登录冲突覆盖判定（以后上报者为准）
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 5（"若发现某账号新出现在这台设备但已绑定在另一台安卓设备上 → 以后上报者为准覆盖，旧设备记录标为失效并写日志告警"）+ NFR"双端登录冲突"拍板值

**可观测行为**: 无既有绑定 → `NO_CONFLICT`；同设备重复上报 → `NO_CONFLICT`；不同设备且新上报时间戳 ≥ 旧记录时间戳 → `OVERWRITE_EXISTING`（旧设备记录标失效+写日志告警，由 Generator 在调用方实现，纯函数只出判定）；不同设备且新上报时间戳 < 旧记录时间戳（网络延迟导致的过期上报）→ `KEEP_EXISTING_STALE_REPORT`（丢弃过期上报，不覆盖）

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `no existing binding (first scan) yields NO_CONFLICT` / `same device rescanning yields NO_CONFLICT` / `different device with later scan timestamp overwrites existing` / `different device with equal scan timestamp overwrites existing (later reporter wins ties)` / `different device with earlier (stale, out-of-order) scan timestamp keeps existing`

---

### Step 6: 下线判定
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 5（"若扫描发现某账号不再登录该设备 → 标记该记录离线"）

**可观测行为**: 中台记录的账号 id 仍存在于本次扫描到的当前登录列表 → `ONLINE`；不存在（或本次扫描登录列表为空）→ `WENT_OFFLINE`

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `account still present in currently logged-in list is ONLINE` / `account missing from currently logged-in list WENT_OFFLINE` / `empty currently logged-in list means account WENT_OFFLINE`

---

### Step 7: 派发时发现未登录 → 立即触发重扫，任务按未登录处理
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 7 字面定义（"派发采集/触达任务时，若执行中发现目标账号在手机上未登录（跟中台记录不一致）→ 立即触发一次实时重新扫描更新状态，不等下个周期，该次任务按未登录处理转失败/人工核实"）

**可观测行为**: 中台记录 `recordedOnline=true` 但派发时实际探测 `actualLoggedInAtDispatch=false`（不一致）→ `evaluateDispatchAccountStatus` 返回 `TRIGGER_RESCAN_AND_FAIL`（触发重扫+本次任务按未登录处理转失败）；记录与实际一致（都在线/都离线）或记录离线但实际在线（无失败性不一致，只是数据滞后）→ 返回 `PROCEED`

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `dispatch finds account recorded online but actually logged out triggers rescan and fails task` / `dispatch finds account recorded online and actually still logged in proceeds normally` / `dispatch finds account already recorded offline and still logged out proceeds (no new mismatch)` / `dispatch finds account recorded offline but actually logged in proceeds (no mismatch failure)`

---

### Step 8（出口）: `agent_platform_sessions` schema 扩展 `device_type` 字段
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 4（"系统把扫描结果...写回 `agent_platform_sessions`（新增 `device_type='android'` + 账号列表相关字段），标记本次扫描时间"）+ 预期受影响文件段

**可观测行为**: `zenithjoy.agent_platform_sessions` 表存在 `device_type` 列（`information_schema.columns` 可查到），且既有列（`agent_id`/`platform`/`account_label`/`role`/`status`/`bound_at`/`created_at`）与既有 CHECK/UNIQUE 约束不受破坏

**验证命令**:
```bash
psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='agent_platform_sessions' AND column_name='device_type'" | grep -q device_type
psql "$DB" -t -c "SELECT conname FROM pg_constraint WHERE conname='chk_aps_role' AND conrelid='zenithjoy.agent_platform_sessions'::regclass" | grep -q chk_aps_role
```

**硬阈值**: 两条查询均非空（`device_type` 列存在 + 既有 `role` CHECK 约束未被破坏）

---

## 接缝清单（本 sprint 碰真实世界的点，未真验前标 `logic-done-pending`，不得标 done）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 |
|---|---|---|---|
| 1 | 抖音"切换账号"界面无障碍服务能否真实读到当前登录账号列表 | 依赖 `[ASSUMPTION]` 无障碍服务读取技术可行性未最终确认（PRD 假设段） | 人工在 Honor 真机（Tailscale IP 100.91.227.1）验证；若读不到需降级为"主动打开切换账号弹窗扫描"方案（PRD 已声明降级不影响本次可测试范围的判定逻辑） |
| 2 | 扫描流程超时强制退出"切换账号"界面，不留半开状态 | 依赖真实 UI 弹窗生命周期与无障碍服务超时机制 | 人工真机手动触发 App 崩溃/锁屏场景，确认切换账号弹窗被强制退出，不污染后续采集/触达操作 |
| 3 | Dashboard 机器管理页 `device_type` 标签真实展示（Web 小号与 Android 设备同列表） | 依赖真实前端渲染 + 真实 DB 数据 | 人工在 Dashboard 手动核实一次，确认 `device_type='android'` 标签可见且不影响既有 Web 小号展示 |

**本 sprint `target_environment=local_api`，Harness 自动裁决只覆盖上述 Step 1-8 的纯函数单测级验收 + DB schema 查询验收；接缝清单 3 条在人工真机/人工前端补验之前，Sprint 整体只能标 `logic-done-pending`。**

---

## 产品风险登记（Risks）

| # | 风险 | 影响 | Mitigation | 状态 |
|---|---|---|---|---|
| 1 | 双端冲突覆盖判定用绝对时间戳比较，若两台设备系统时间不同步（clock skew），"以后上报者为准"可能误判 | 账号绑定被错误设备抢占，派单错发到实际未登录的设备 | 本轮已在纯函数层面明确输入是"扫描时间戳"（由中台接收请求时打时间戳，非设备本地时间），Generator 实现时必须用中台服务端时间而非 Android 设备本地时间作为 `scanAtMs`；本合同不含服务端时间戳注入点的验收（超出范围），登记为已知风险 | 已通过"服务端打时间戳"约定规避，未做自动化验收 |
| 2 | 无障碍服务读取技术可行性未最终确认（PRD `[ASSUMPTION]`），若真机验证读不到需要降级方案 | 若降级为"主动打开切换账号弹窗扫描"，扫描频率/UI 交互路径改变，可能需要新的超时兜底参数 | PRD 已声明"两种方案的判定/去重/冲突处理逻辑相同，不影响本次可测试范围"，本 sprint 纯函数与扫描技术实现方式解耦，无论哪种方案都复用同一套判定函数 | 已知且 PRD 已拍板降级路径不影响本次范围，接缝清单第 1 条待真机验证 |

---

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: autonomous
**target_environment**: local_api
**target_environment_reason**（PRD 显式声明）: 本 sprint 只做纯逻辑抽函数 + 单元测试级验收，无障碍服务真实读取的可行性由人工在 Honor 真机（Tailscale IP 100.91.227.1）补验，不进本次自动化 E2E。

> 本 sprint 无 HTTP 端点，混合 local_api 通用模板（psql 验 schema）+ Android Gradle 单元测试模板（与 07060927-douyin-dm-warmup-search 同款约定：CI ubuntu-latest runner 预装 Android SDK 自动设有 `ANDROID_HOME`，可直接跑；本地开发机缺 `ANDROID_HOME` 时降级为 `logic-done-pending`，不得直接判 done）。

```bash
#!/bin/bash
set -e

# ===== Part A：Android Gradle 单元测试（四块纯函数）=====
cd services/agent-android

if [ -z "${ANDROID_HOME:-}" ]; then
  echo "⚠️  ANDROID_HOME 未配置——本地降级为 logic-done-pending，CI ubuntu-latest runner 必须真跑本脚本"
else
  gradle :app:testDebugUnitTest --tests "*DeviceAccountModelLogicTest*" --rerun

  RESULT_XML="app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.account.DeviceAccountModelLogicTest.xml"
  [ -f "$RESULT_XML" ] || { echo "FAIL: 测试结果文件不存在 $RESULT_XML"; exit 1; }
  grep -q 'failures="0" errors="0"' "$RESULT_XML" || { echo "FAIL: Android 单测未全绿"; exit 1; }

  # 断言测试数量 ≥ 覆盖七块纯函数所需的最小用例数（防止 Generator 删测试假绿）
  TEST_COUNT=$(grep -o 'tests="[0-9]*"' "$RESULT_XML" | head -1 | grep -o '[0-9]*')
  [ "$TEST_COUNT" -ge 20 ] || { echo "FAIL: 测试用例数 $TEST_COUNT < 20，疑似删测试"; exit 1; }

  echo "✅ Part A 通过（去重/冲突覆盖/tenant绑定/数据保鲜/下线判定/重扫触发/互斥锁，共 $TEST_COUNT 条用例全绿）"
fi

cd - > /dev/null

# ===== Part B：agent_platform_sessions schema 扩展验收（psql，需 DB 环境变量 $DB）=====
if [ -z "${DB:-}" ]; then
  echo "⚠️  \$DB 未配置——跳过 schema 验收，CI 环境必须设置 DB 连接串真跑"
else
  psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='agent_platform_sessions' AND column_name='device_type'" | grep -q device_type || { echo "FAIL: device_type 列不存在"; exit 1; }
  psql "$DB" -t -c "SELECT conname FROM pg_constraint WHERE conname='chk_aps_role' AND conrelid='zenithjoy.agent_platform_sessions'::regclass" | grep -q chk_aps_role || { echo "FAIL: 既有 chk_aps_role 约束被破坏"; exit 1; }
  echo "✅ Part B 通过（device_type 列存在 + 既有约束未被破坏）"
fi

echo "✅ Golden Path 验证通过"
```

**PASS 标准**：脚本 exit 0 + Android 单测 XML `failures="0" errors="0"` + 用例数 ≥ 20 + `device_type` 列存在 + 既有 CHECK 约束未破坏
**FAIL 标准**：任意 gradle 步骤非 0 exit / 结果文件缺失 / 有 failures 或 errors / 用例数被删减 / `device_type` 列缺失 / 既有约束被破坏
**人工真机/前端补验**（不计入本次 Harness E2E，见接缝清单）：Honor 真机（Tailscale 100.91.227.1）验证无障碍服务读取账号列表可行性 + 超时强制退出弹窗；Dashboard 手动核实 `device_type` 标签展示

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 单次扫描账号去重纯函数 | `tests/DeviceAccountModelLogicTest.kt` | `duplicate douyin ids in single scan are deduped preserving order`, `scan with no duplicates is unaffected`, `empty scan list dedupes to empty list` | → 编译失败（`DeviceAccountModel`/`dedupeSameDeviceAccounts` 未定义）3 failures |
| 双端登录冲突覆盖判定纯函数 | `tests/DeviceAccountModelLogicTest.kt` | `no existing binding (first scan) yields NO_CONFLICT`, `same device rescanning yields NO_CONFLICT`, `different device with later scan timestamp overwrites existing`, `different device with equal scan timestamp overwrites existing (later reporter wins ties)`, `different device with earlier (stale, out-of-order) scan timestamp keeps existing` | → 编译失败（`resolveDeviceConflict`/`ConflictResolution` 未定义）5 failures |
| tenant_id 绑定隔离纯函数 | `tests/DeviceAccountModelLogicTest.kt` | `filters accounts to only the queried tenant, excluding other tenants`, `second tenant query returns only its own accounts, none leak from tenant-1`, `tenant with no matching accounts returns empty list`, `empty account list filters to empty regardless of tenant` | → 编译失败（`ScannedAccount`/`filterAccountsByTenant` 未定义）4 failures |
| 扫描数据保鲜（读取失败保留旧列表）纯函数 | `tests/DeviceAccountModelLogicTest.kt` | `successful scan read updates active list`, `failed scan read (accessibility timeout etc) keeps previous list and marks stale` | → 编译失败（`resolveScanReadResult`/`ScanReadOutcome` 未定义）2 failures |
| 下线判定纯函数 | `tests/DeviceAccountModelLogicTest.kt` | `account still present in currently logged-in list is ONLINE`, `account missing from currently logged-in list WENT_OFFLINE`, `empty currently logged-in list means account WENT_OFFLINE` | → 编译失败（`checkAccountOffline`/`AccountOfflineStatus` 未定义）3 failures |
| 派发时重扫触发判定纯函数 | `tests/DeviceAccountModelLogicTest.kt` | `dispatch finds account recorded online but actually logged out triggers rescan and fails task`, `dispatch finds account recorded online and actually still logged in proceeds normally`, `dispatch finds account already recorded offline and still logged out proceeds (no new mismatch)`, `dispatch finds account recorded offline but actually logged in proceeds (no mismatch failure)` | → 编译失败（`evaluateDispatchAccountStatus`/`DispatchAccountDecision` 未定义）4 failures |
| 全局互斥锁判定纯函数 | `tests/DeviceAccountModelLogicTest.kt` | `collect or outreach task running means scan should be skipped this cycle`, `no collect or outreach task running means scan should proceed` | → 编译失败（`shouldSkipScanDueToMutex` 未定义）2 failures |
