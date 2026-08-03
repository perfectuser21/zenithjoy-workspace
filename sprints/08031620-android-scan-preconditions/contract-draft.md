# Sprint Contract Draft (Round 1)

## 技术上下文核查（Step 1.1，代码实读，非 registry 推导）

`api_registry`/`db_schema_registry` 在 Brain 未收录本仓库 REST 端点；本合同的 Response Schema 改为**直读现有源码**推导（比 registry 更准确）：
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt`（当前唯一 `errorCode="OPEN_PANEL_FAILED"` 出口在 152/153 行；`SCAN_TIMEOUT` 出口在 945 行 `onAbnormalExit`）
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`（`buildAccountScanResultBody()` 纯字符串拼装函数，1118-1140 行；`account-scan-result` POST 客户端，782 行）
- `apps/api/src/routes/agent-burner.ts`（`POST /account-scan-result` 路由，816-949 行；`agent_scan_failures.detail` 持久化在 915-926 行）

**范围修正（相对 sprint-prd.md 的 [AI_ADDED] 补充，理由见下）**：PRD「预期受影响文件」只列了 Android 端文件。本合同新增 `AgentService.kt` + `apps/api/src/routes/agent-burner.ts` 两个文件入范围——因为服务端 `account-scan-result` 路由目前只解构 `agent_id/request_id/ok/account_ids/error_code/screenshot_b64/tree_dump`（agent-burner.ts:817），PRD 要求的 versionName/stage/前台包名若不跟着这条链路走到服务端持久化，会在 `AgentService.kt` 广播转发这一步就被丢弃——起不到 PRD 说的"运维不用重新登真机复现即可判断根因方向"的效果。

## Response Schema（来源: 现有源码推导，非新增端点）

### Endpoint: POST /api/agent/burner/account-scan-result（现有端点扩展，非新增路由）

**请求体新增字段**（与既有 `screenshot_b64`/`tree_dump` 同层级、同可选性约定，均可为 `null`）：
```json
{
  "version_name": "<string|null>",
  "stage": "<string|null>",
  "foreground_package": "<string|null>"
}
```
- `version_name`：来源 — PRD 明确要求；命名对齐既有 `screenshot_b64`/`tree_dump` 的 snake_case 约定
- `stage`：失败发生的阶段标识（如 `"lock_check"` / `"launch_wait"`），来源 — PRD 明确要求
- `foreground_package`：失败瞬间的前台包名，来源 — PRD 明确要求

**Success (HTTP 200)**：不变，仍为 `{"success":true,"data":{"written":<number>}}`（既有 `OK()` 包装器，agent-burner.ts:948），本 sprint 不修改响应 schema。
**禁用字段名**：无新增禁用（未新增响应字段）。

若无 HTTP 响应变化的部分（诊断页展示项）：N/A — 纯本地 UI 展示，无 HTTP 响应。

## 函数契约（无 HTTP 的核心判定逻辑，JVM 单测直接验证，无需 Android 运行时/Robolectric）

比照现有测试风格（`DeviceAccountScanServiceTreeDumpTest.kt` 等已用真实 tree_dump 字符串做纯函数断言的既有模式）：

```kotlin
// 新增：services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/AccountScanFailureClassifier.kt（文件名/包名 Generator 可按现有代码组织微调，函数签名与行为不可变）
object AccountScanFailureClassifier {
    // true = tree_dump 文本判定为锁屏界面（如含"上滑解锁"等系统锁屏特征文案）
    fun isLockScreenTreeDump(treeDumpText: String?): Boolean

    // true = tree_dump 文本判定为手机桌面 launcher（抖音未进入前台，仍停留桌面图标列表）
    fun isHomeLauncherTreeDump(treeDumpText: String?): Boolean
}
```

`buildAccountScanResultBody()`（`AgentService.kt:1118`）签名扩展：新增 3 个可选具名参数 `versionName: String? = null, stage: String? = null, foregroundPackage: String? = null`，JSON body 追加对应 snake_case 字段（`null` 时输出 JSON `null`，与既有 `screenshotField`/`treeDumpField` 处理方式一致）。

## Golden Path

入口：系统触发账号扫描任务 → 步骤1（锁屏前置检查）→ 步骤2（前台确认）→ 步骤3（detail 全链路透传）→ 出口（诊断页自检展示）

### Step 1: 锁屏检测与唤醒
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 1

**可观测行为**：设备处于锁屏且可编程解锁时，扫描继续正常执行；不可编程解锁时，`agent_scan_failures.error_code = 'SCREEN_LOCKED'`（而非泛化 `OPEN_PANEL_FAILED`）

**验证命令**（JVM 单测，用真实历史失败记录 07-31 tree_dump 做 fixture，见下方 fixture 附录）：
```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AccountScanFailureClassifierTest*" 2>&1 | tail -30
grep -q "BUILD SUCCESSFUL" <(cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AccountScanFailureClassifierTest*" 2>&1)
```

**硬阈值**：`AccountScanFailureClassifier.isLockScreenTreeDump(<07-31真实fixture>) == true`；Gradle test 任务 exit 0

---

### Step 2: 后台启动拦截检测
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 2

**可观测行为**：拉起抖音后在既有等待窗口内未进入前台时，`agent_scan_failures.error_code = 'LAUNCH_BLOCKED'`

**验证命令**：
```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AccountScanFailureClassifierTest*" 2>&1 | tail -30
```

**硬阈值**：`AccountScanFailureClassifier.isHomeLauncherTreeDump(<07-30真实fixture>) == true`；同一测试类里"正常抖音树"结构性反例（含"切换账号"/"我，按钮"等既有代码已用过的正常态标记文本）两个函数都必须返回 `false`（假阳性防护）

---

### Step 3: failure detail 全链路透传（versionName + stage + 前台包名）
**来源**: `[AI_ADDED]` — 见文首「范围修正」，理由：不透传到服务端持久化则 PRD 目标（运维免登真机排障）不成立

**可观测行为**：
1. `AgentService.buildAccountScanResultBody()` 输出的 JSON body 含 `version_name`/`stage`/`foreground_package` 三字段
2. `apps/api` 的 `agent_scan_failures.detail` jsonb 列真实持久化这三个字段（真 Postgres，非 mock）

**验证命令**（两层：客户端 JVM 单测 + 服务端 supertest+真 PG 集成测试）：
```bash
# 客户端：body 拼装函数
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*AgentServiceAccountScanTest*" 2>&1 | tail -30

# 服务端：真实 INSERT 落库校验——必须用 tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts
# （真 Pool + supertest，beforeAll/afterAll 建真 tenant/agent），禁止用 src/routes/agent-burner.test.ts
# （该文件 vi.mock('../db/connection') 整个 mock 掉了 pool.query，命中「禁 mock 边清单」违规）
cd apps/api && npx vitest run tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts --reporter=verbose 2>&1 | tail -40
```

**硬阈值**：
- `buildAccountScanResultBody(..., versionName="2.1.20", stage="lock_check", foregroundPackage="com.launcher")` 返回的 JSON 字符串 `contains("\"version_name\":\"2.1.20\"")` 等三字段全部命中
- 服务端测试：`POST /account-scan-result` 带上述三字段后，`SELECT detail FROM zenithjoy.agent_scan_failures WHERE request_id=$1` 查出的 `detail->>'version_name'` 等于请求体传入值，`created_at > NOW() - interval '5 minutes'`

---

### Step 4: 诊断页后台弹窗权限自检展示项
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 4

**可观测行为**：Agent 诊断页展示"后台弹窗权限"自检项，读取 `Settings.canDrawOverlays()` 近似信号

**验证命令**（此项为 UI 展示，JVM 侧只验证读取函数本身，UI 渲染验证不在 local_api 范围内，随 nightly 真机车道自然可见）：
```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "*DiagnosticsPage*BackgroundPermission*" 2>&1 | tail -20
```

**硬阈值**：新增的权限读取函数（如 `canDrawOverlays(context): Boolean`）单测覆盖 true/false 两条分支，Gradle test exit 0

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: agent_remote
**target_environment**: local_api

> 本 sprint 无 Brain API/DB 触发入口（纯 Android Kotlin + Node.js API 路由代码），`local_api` 模板的 curl+psql 全程链路不适用于触发端，但适用于服务端集成测试段（真 Postgres）。E2E 脚本改为「Gradle 全量测试 + API 集成测试」组合，仍是 `local_api` 环境执行（本地/CI 容器直接跑，无需浏览器/远端真机）。

```bash
#!/bin/bash
set -e

echo "═══ 客户端 JVM 单测（含新分类器 + body 拼装扩展）═══"
cd services/agent-android
./gradlew :app:testDebugUnitTest 2>&1 | tail -60
GRADLE_EXIT=$?
[ "$GRADLE_EXIT" -eq 0 ] || { echo "FAIL: Gradle 单测非 0 退出"; exit 1; }
grep -q "BUILD SUCCESSFUL" <(./gradlew :app:testDebugUnitTest 2>&1) || { echo "FAIL: 未见 BUILD SUCCESSFUL"; exit 1; }
cd -

echo "═══ 服务端 account-scan-result 集成测试（真 Postgres，非 mock 文件）═══"
cd apps/api
npx vitest run tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts --reporter=verbose 2>&1 | tee /tmp/api-test.log
grep -qE "✓|passed" /tmp/api-test.log || { echo "FAIL: 服务端测试未见通过标记"; exit 1; }
! grep -qE "✗|failed \(" /tmp/api-test.log || { echo "FAIL: 服务端测试存在失败用例"; exit 1; }
cd -

echo "═══ versionCode 已 bump 校验 ═══"
CURRENT_VC=$(grep -m1 'versionCode = ' services/agent-android/app/build.gradle.kts | grep -oE '[0-9]+')
[ "$CURRENT_VC" -gt 23 ] || { echo "FAIL: versionCode 未 bump（当前=$CURRENT_VC，本 sprint 前基线=23）"; exit 1; }

echo "✅ Golden Path 验证通过（JVM 单测 + 服务端集成测试 + versionCode bump 全过）"
```

## 未覆盖真实链路清单（规则 C）

- **真机锁屏/后台拦截的实际触发依赖设备真实系统状态**（`PowerManager.isInteractive()`/ColorOS 后台启动限制），JVM 单测环境（CI 容器）无法真实制造锁屏或厂商拦截。本合同用两条真实历史失败记录（`agent_scan_failures` id `da659ea0`/`236f43b1`）的原始 `tree_dump` 文本做 fixture，验证的是「分类函数对已知真实信号的判定正确性」，不是「真机复现锁屏/拦截场景本身」。
  真验证补位计划：合并装机后，已于 2026-08-03 验证全绿的 `account-scan-realmachine-smoke.sh` nightly 车道自动回归（下一次 nightly run，无需人工介入）。

## 禁 mock 边清单

- `DeviceAccountScanService`/`AgentService`(客户端内部 relay) ↔ `apps/api agent-burner.ts`(服务端持久化 `agent_scan_failures` 表)：本单新增 `version_name`/`stage`/`foreground_package` 字段的端到端透传，属跨模块数据传递 + DB 写路径双重命中，禁止 mock。`AgentService.buildAccountScanResultBody()` 的 JVM 单测直接调用真实字符串拼装函数（不 mock）；服务端测试**必须**用 `apps/api/tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts`（真 `Pool` + `supertest`，`beforeAll` 建真 tenant/agent，真实 `INSERT`/`SELECT`）——**禁止**用 `apps/api/src/routes/agent-burner.test.ts`，该文件 `vi.mock('../db/connection', ...)` 把 `pool.query` 整个 mock 成 `vi.fn()`，命中本节要禁止的边。
- `AccountScanFailureClassifier` 是纯函数无外部依赖，不构成"边"，无需 mock 讨论。

## 判定点登记表（规则 e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 设备是否处于"不可编程解锁"的锁屏状态 | A. `PowerManager.isInteractive()`==false 直接判定锁屏；B. 结合 tree_dump 出现锁屏特征文案（如"上滑解锁"）辅助判断 | A（运行时信号）为主，B（tree_dump fixture）用于本 sprint 的 JVM 单测验证 | A 是系统提供的直接信号，B 是 07-31 真机记录的可复现验证素材 | 误判为"可解锁"但实际是密码锁 → 反复重试浪费扫描窗口，仍以泛化 `OPEN_PANEL_FAILED` 收场，运维方向不明 |
| ⚠️ 后台启动拦截 vs 深层子页卡住如何区分（LAUNCH_BLOCKED vs 既有 OPEN_PANEL_FAILED） | A. 仅按"等待窗口超时未见前台包名==抖音"一刀切判定 LAUNCH_BLOCKED；B. 结合 tree_dump 是否呈现桌面 launcher 特征（本 sprint 用 07-30 真实记录验证）区分"压根没拉起"vs"拉起了但卡在深层子页"两种情况 | A（前台确认超时）为主要运行时判据，B（tree_dump 分类）仅用于 JVM 单测 fixture 验证分类器本身正确性，不改变现有深层子页恢复逻辑（既有 `NAV_STUCK_SUBPAGE` 概念场景不受影响，`openSwitchAccountPanel()` 内既有的返回主页 feed 重试逻辑不做任何修改） | PRD 明确"realme/ColorOS 后台拦截"根因是"从未真正进入抖音进程"，与"已进入抖音但卡子页"是两个不同阶段的失败 | 误判后果：若不区分，`LAUNCH_BLOCKED` 会误吞真实的深层子页场景，运维会往错误方向（权限设置）排查，浪费时间；已在 PRD 中标记为 ⚠️ 但对话历史中未见用户就此点单独拍板，此判定点按 PRD 字面给定方案执行，无需二次确认 |

## 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 设备锁屏且不可编程解锁 | 本轮扫描终止，上报 `SCREEN_LOCKED`，不做无限重试 | 是（下一次心跳周期由既有机制自然触发下一轮扫描，本 sprint 不新增重试逻辑） | 无自动降级，等待下轮自然扫描或人工介入 |
| 后台启动被拦截 | 本轮扫描终止，上报 `LAUNCH_BLOCKED` | 同上 | 诊断页展示后台弹窗权限自检项，供人工排查引导 |
| detail 透传服务端持久化失败（如 DB 写入异常） | 沿用既有 `agent_scan_failures` INSERT 的既有错误处理行为（本 sprint 不新增额外容错分支，不在范围内） | 不适用 | 不适用 |

## 效果确认

本 sprint 无新增对外动作（不发消息、不调用第三方 API），N/A。

## 输入对抗面

本 sprint 不涉及对外暴露 agent（非用户可写入内容的接口），N/A。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 锁屏检测/唤醒、后台拦截检测、错误码分层、detail 透传、诊断页自检 | 见 Golden Path Step 1-4 |
| **NFR（做得多好）** | 沿用既有等待窗口约定，不新增性能指标 | 见 sprint-prd.md NFR 约束段 |
| **Invariant（永不违反）** | 不破坏既有 `NAV_STUCK_SUBPAGE`/`PANEL_TIMEOUT` 概念场景的既有行为（虽无独立错误码，但既有深层子页恢复/面板等待重试逻辑代码路径不可回归） | 本合同 Step 1-3 均不改动 `openSwitchAccountPanel()` 内既有的 3 重重试/返回主页 feed 逻辑，只在其前置（锁屏检查）与其内（前台确认超时分支）新增判定 |
| **判定点（怎么知道）** | 见判定点登记表 | 见上 |
| **保质期（何时过期）** | 不适用（错误码/分类函数无时效性） | N/A |
| **死亡告警（停了谁知道）** | 若 detail 透传链路某环节失效（如服务端字段丢失），运维只是"看不到更详细的排障信息"，不影响扫描本身成功/失败判定，无需独立告警机制 | N/A（非关键路径失效） |
| **失败语义（挂了怎么办）** | 见失败语义声明表 | 见上 |
| **效果确认（已发≠已生效）** | 本 sprint 无对外动作 | N/A |

## Invariant 约束（铁律，继承自 sprint-prd.md）

（本 line 暂无与安卓账号扫描直接相关的 invariant 记录，同 sprint-prd.md）

## 累积 FR（本 line 已验收行为，继承自 sprint-prd.md）

- 视频/图文内容判定门槛+留言触达门槛化: 客户在 Dashboard 填「目标画像描述」→ 存 `acquisition_config.target_profile_desc` → 安卓 Agent 点开视频卡片 → 中台判定 API 调 Gemini 多模态模型做 OCR/转写+语义判定

## 已知约束（来自回归测试，Step 1.2/1.3）

- [累积FR] `context-manifest` 端点未在本次会话调用（本地手动 GAN 流程，非 Brain tick 自动派发），沿用 sprint-prd.md 已加载的累积 FR 摘要，不重复调用
- `DeviceAccountScanServiceCleanupTest.kt` → `setIdle runs and SCAN_TIMEOUT is reported when block times out`（既有 `onAbnormalExit` 超时上报机制，本 sprint 不得破坏）
- `DeviceAccountScanServiceStaleNodeAfterOverlayTest.kt` → 描述"3次重试跑不完被整体超时打断报 SCAN_TIMEOUT"的既有行为，本 sprint 新增的锁屏/前台检查逻辑必须放在这层超时预算之内，不能额外抢占导致该既有测试假设的时间窗被打破
- `agent-burner.test.ts:453` → `POST /account-scan-result — 账号扫描结果写回` describe 块含 `ok=false → 不写 agent_platform_sessions，200 返回 written=0，但落库 agent_scan_failures（issue 2026-07-28）` 既有用例，本 sprint 新增字段不得破坏此既有断言

## Fixture 附录（两条真实失败记录原文，供 tests/ 目录测试文件直接引用）

### Fixture A：07-31 锁屏（`agent_scan_failures.id = da659ea0-b0f8-40f1-9126-1af4351330f1`，agent `e017953c`）

关键片段（完整 59 节点 tree_dump 摘录锁屏特征部分）：
```
#0 cls=android.widget.TextView click=false b=168x57 desc=null txt=中国电信
#1 cls=android.widget.ImageView click=false b=63x72 desc=振铃器振动。 txt=null
#5 cls=android.widget.ImageView click=true b=151x0 desc=录音机 txt=null
#10 cls=android.widget.TextView click=false b=184x62 desc=null txt=上滑解锁
#11 cls=android.widget.TextView click=false b=370x70 desc=null txt=7月31日星期五
#13 cls=android.widget.TextView click=false b=1042x308 desc=null txt=15:26
end printed=59
```
判定依据：`txt=上滑解锁` 是系统锁屏界面的唯一特征文案，正常抖音界面不会出现。

### Fixture B：07-30 launcher（`agent_scan_failures.id = 236f43b1-d073-41c9-81c7-6bd9433accea`，agent `2abec9ab`，realme RMX3478）

关键片段（完整 18 节点 tree_dump）：
```
#0 cls=android.widget.TextView click=true b=246x252 desc=拨号 txt=null
#2 cls=android.widget.TextView click=true b=246x252 desc="微信"有 61 条通知 txt=null
#12 cls=android.widget.TextView click=true b=246x306 desc="抖音"有 1 条通知 txt=抖音
#17 cls=android.widget.TextView click=true b=213x306 desc=ZenithJoy Agent txt=ZenithJoy Agent
end printed=18
```
判定依据：桌面 launcher 图标列表（拨号/微信/抖音/ZenithJoy Agent 等应用图标并列），抖音 App 本身进程未启动/未进入前台，与"已进入抖音但停留在某个界面"的树结构完全不同。

### 正常态反例（结构性反例，非真机记录，用于假阳性防护——引用既有代码注释里提到的正常态标记文本）

按 `DeviceAccountScanService.kt` 现有代码（`findNodeByContentDescContains(it, "我，按钮")` / `findNodeByContentDescContains(it, "切换账号")`），正常态 tree_dump 含 `desc=我，按钮` 或 `txt=切换账号` 等既有代码已依赖的标记文本，构造一个不含"上滑解锁"、不含桌面图标列表模式、含"我，按钮"的最小合成文本作为负例。
