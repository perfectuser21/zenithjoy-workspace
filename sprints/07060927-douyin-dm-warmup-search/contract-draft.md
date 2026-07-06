# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

本 sprint 不新增任何 HTTP 端点，全部产出是 Android agent 内部纯函数（Kotlin，无网络/DB 交互）。三块纯函数的输入/输出签名如下（相当于本 sprint 的"Schema"）：

### `matchProfileByDouyinId(searchResults: List<String>, targetDouyinId: String): ProfileMatchResult`
- 输入：搜索结果里读到的抖音号字符串列表 + 目标精确抖音号
- 输出：`ProfileMatchResult` 枚举 `{ UNIQUE, NO_MATCH, AMBIGUOUS }`
- 来源：PRD Golden Path Step 3 字面定义（"精确匹配抖音号完整字符串"/"0 个或多个同名结果无法唯一确定"）

### `needsFollowClick(buttonText: String?): Boolean` / `needsLikeClick(buttonText: String?): Boolean`
- 输入：无障碍树读到的按钮文本（可能为 null = 找不到按钮）
- 输出：是否需要点击（`"关注"`/`"点赞"` → true；`"已关注"`/`"已赞"`/null/其他 → false）
- 来源：PRD Golden Path Step 4/5 字面定义（按钮态判断 + 找不到按钮尽力而为跳过）

### `isLeadTimedOut(elapsedMs: Long, limitMs: Long = 90_000L): Boolean`
- 输入：从 Step 2 开始计的耗时（毫秒）+ 熔断阈值（默认 90 秒）
- 输出：是否超时（`elapsedMs > limitMs` → true）
- 来源：PRD"熔断规则"段字面定义（90 秒，区别于 failed）

### `isFollowRateLimited(followTimestampsMs: List<Long>, nowMs: Long, limit: Int = 10, windowMs: Long = 3_600_000L): Boolean` / `isLikeRateLimited(likeTimestampsMs: List<Long>, nowMs: Long, limit: Int = 15, windowMs: Long = 3_600_000L): Boolean`
- 输入：本机/本号历史关注（或点赞）动作的时间戳列表（毫秒）+ 当前时间 + 上限次数 + 窗口长度（默认 1 小时）
- 输出：统计 `(nowMs - windowMs, nowMs]` 滑动窗口内的历史时间戳数量，`count >= limit` → true（本次动作应跳过，尽力而为，不阻塞、不重试、不排队）；窗口外的历史时间戳不计入
- 来源：PRD NFR 段字面定义（"频控：关注 ≤10 次/小时，点赞 ≤15 次/小时"）——与 `已知约束` 段提到的 `classifyOutcome` 私信频控是**两套独立机制**（私信频控判定送达结果，本频控判定"是否执行关注/点赞热身动作"），互不覆盖、互不替代

**禁用命名**：不得把 `ProfileMatchResult` 枚举值改名为 `FOUND`/`MISS`/`DUPLICATE` 等同义词——PRD 用词是"唯一匹配/零匹配/多匹配"，枚举值固定 `UNIQUE`/`NO_MATCH`/`AMBIGUOUS`。

---

## 已知约束（来自回归测试）

- `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachServiceOutcomeTest.kt` → `classifyOutcome` 判定标准：频控优先于 UI 态；`dmEntryFound=false` 或 `sendConfirmed=false` 一律 FAILED，不允许"点了发送按钮就假 sent"；三态字符串必须小写 `sent`/`limited`/`failed`，与 Windows 路径 `services/agent/src/publishers/douyin-dm-outreach.cjs` 一致。本 sprint 新插入的搜索定位 + 热身互动两段动作，不得破坏这条既有真送达判定标准（`classifyOutcome` 不改签名不改行为）。
- `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/DouyinCollectServiceStateTest.kt` → 状态机纯函数（`isResultEventDebounced` / `shouldEnterSubmitting`）延续"点击后必须重新抓取快照，不能复用点击前旧引用"的写法惯例（`SnapshotDiscipline`），本 sprint 新插入的搜索/关注/点赞步骤同样要遵守该纪律（Generator 实现时复用，不在本合同的纯函数 DoD 范围内单独验，但不得破坏既有 `SnapshotDiscipline` 单测）。

---

## Golden Path

[中台派发 dm_assignments 任务] → [搜索定位主页] → [关注热身(受频控约束)] → [点赞热身(受频控约束)] → [私信发送(复用既有链路)] → [Dashboard 触达记录变为 sent]

### Step 1: 中台派 `dm_assignments` 任务，Android agent 收到任务
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 1（"中台派 dm_assignments 任务（payload 含 lead 的抖音号）→ Android agent 收到任务"）

**可观测行为**: 本 sprint 不改动派单/接收协议，沿用累积 FR 已验收的 `dm_assignments` 派发链路；本合同不重复验证此步（超出范围，见 PRD"不在范围内"）。

**验证命令**: N/A（复用既有已验收链路，本 sprint 不改动）

**硬阈值**: N/A

---

### Step 2: 精确搜索定位主页 — 唯一匹配
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 2/3（"输入 lead 的抖音号（精确字符串）→ 精确匹配→点击唯一匹配结果"）

**可观测行为**: 搜索结果列表里恰好一条文本与目标抖音号完全相等 → `matchProfileByDouyinId` 返回 `UNIQUE`

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml
```

**硬阈值**: 单测全绿（`failures="0" errors="0"`），对应 test case `matches exactly one profile by exact douyin id yields UNIQUE`

---

### Step 3: 精确搜索定位主页 — 零匹配/多匹配歧义（不重试，转人工核实）
**来源**: `[FROM_PRD]` — 边界情况段（"搜索 0 个或多个同名结果无法唯一确定 → failed，不重试"）

**可观测行为**: 搜索结果为空或不含目标抖音号 → `matchProfileByDouyinId` 返回 `NO_MATCH`；搜索结果里出现 ≥2 条文本与目标抖音号完全相等（同名歧义）→ 返回 `AMBIGUOUS`。两种情况都不重试（本函数是纯判定，不含重试逻辑，Generator 实现时也不得为这两个分支加重试）。

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `zero matches yields NO_MATCH`、`empty search results yields NO_MATCH` 和 `multiple identical matches yields AMBIGUOUS`

---

### Step 4: 关注热身 — 按钮态判断
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 4（"读取关注按钮当前文本状态→若为关注则点击；若已是已关注则跳过；找不到按钮/超时→尽力而为跳过"）

**可观测行为**: 按钮文本 `"关注"` → `needsFollowClick` 返回 `true`；按钮文本 `"已关注"` → 返回 `false`；按钮为 `null`（找不到）→ 返回 `false`（尽力而为跳过，不阻塞）

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `follow button text "关注" needs click` / `"已关注" does not need click` / `null button (not found) does not need click`

---

### Step 5: 点赞热身 — 按钮态判断
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 5（"读取第一个作品的点赞按钮状态→若未点赞则点击...；已点赞/无作品可点赞/仅关注可见→尽力而为跳过"）

**可观测行为**: 按钮文本 `"点赞"` → `needsLikeClick` 返回 `true`；按钮文本 `"已赞"` → 返回 `false`；按钮为 `null`（无作品/仅关注可见/找不到）→ 返回 `false`

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `like button text "点赞" needs click` / `"已赞" does not need click` / `null button (no artwork or follow-only profile) does not need click`

---

### Step 6: 关注/点赞每小时频控（独立于私信频控，独立于按钮态判断）
**来源**: `[FROM_PRD]` — NFR 段字面定义（"频控：关注 ≤10 次/小时，点赞 ≤15 次/小时"）

**可观测行为**: 关注动作前统计过去 1 小时内本号已执行的关注次数，`isFollowRateLimited` 达到 10 次（含）即返回 `true`（本次跳过关注，不阻塞、不重试、不排队等到下一小时）；点赞动作前统计过去 1 小时内已执行点赞次数，`isLikeRateLimited` 达到 15 次（含）即返回 `true`（本次跳过点赞）。窗口外（1 小时前）的历史时间戳不计入统计。**该频控与 Step 4/5 的按钮态判断（是否已关注/已点赞）相互独立、都要过**——按钮态判断"要不要点"，本步频控判断"能不能点"，两者都为 true 才实际执行点击。

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `follow count under hourly limit is not rate limited` / `follow count exactly at hourly limit is rate limited` / `follow count over hourly limit is rate limited` / `follow timestamps outside 1 hour window are not counted` / `like count under hourly limit is not rate limited` / `like count exactly at hourly limit is rate limited` / `like count over hourly limit is rate limited` / `like timestamps outside 1 hour window are not counted`

---

### Step 7: 90 秒超时熔断
**来源**: `[FROM_PRD]` — "熔断规则"段字面定义（"单个 lead 从 Step 2 到 Step 6 总耗时超过 90 秒 → 中止当前 lead，标记 timeout"）

**可观测行为**: `elapsedMs` 超过 `90_000L` → `isLeadTimedOut` 返回 `true`（标记 `timeout`）；未超过（含恰好 90000ms 边界，PRD 用词"超过"= 严格大于，边界值不算超时）→ 返回 `false`（正常继续）

**验证命令**:
```bash
cd services/agent-android
gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun
grep -q 'failures="0" errors="0"' app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml
```

**硬阈值**: 单测全绿，对应 test case `elapsed time over 90 seconds is timed out` / `elapsed time exactly at 90 second boundary is not timed out` / `elapsed time under 90 seconds is not timed out`

---

### Step 8（出口）: 私信发送 + Dashboard 触达记录变为 sent
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 6/7（"随机延时→返回主页→点私信→输入话术→发送→确认送达"→"Dashboard 触达记录页看到该条记录状态变成 sent"）

**可观测行为**: 复用累积 FR 已验收的私信发送 + `/dm-outreach-result` 回执链路（`classifyOutcome`/`finishWithOutcome`），本 sprint 不改动该判定标准。

**验证命令**: N/A（复用既有已验收链路，本 sprint 不改动；真机人工补验见下方"接缝清单"）

**硬阈值**: N/A

---

## 接缝清单（本 sprint 碰真实世界的点，未真验前标 `logic-done-pending`，不得标 done）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 |
|---|---|---|---|
| 1 | 抖音搜索结果页无障碍树读取完整抖音号字符串 | 依赖 `[ASSUMPTION]` 抖音真实 App 无障碍树结构（本合同的 `matchProfileByDouyinId` 只测输入已经是字符串列表之后的匹配逻辑，不测无障碍树抓取本身）| 人工在 Honor 真机（Tailscale IP 100.91.227.1）用真实测试账号手动搜索验证，adb 抓无障碍树确认能读到完整抖音号字符串 |
| 2 | "关注"/"已关注"、"点赞"/"已赞" 按钮文本在当前抖音版本下的稳定性 | 依赖 `[ASSUMPTION]` 当前抖音版本按钮文本固定 | 人工真机手动关注/点赞一次，确认按钮文本与假设一致；版本升级后需重新校准 |
| 3 | 搜索定位→关注→点赞→私信发送全链路真机跑通 | 无障碍服务真实点击 + 真送达确认 | 人工在 Honor 真机对一个真实测试账号跑通全链路，Dashboard 触达记录页确认状态变 `sent`（PRD E2E 验收段已声明"人工补验，不计入本次 Harness E2E"） |

**本 sprint `target_environment=local_api`，Harness 自动裁决只覆盖上述 3 个纯函数的单测级验收；接缝清单 3 条在人工真机补验之前，Sprint 整体只能标 `logic-done-pending`。**

---

## 产品风险登记（Risks）

| # | 风险 | 影响 | Mitigation | 状态 |
|---|---|---|---|---|
| 1 | 关注/点赞超出 PRD NFR 频控上限（关注 >10/h、点赞 >15/h）触发抖音风控判定小号为营销机器人 | 小号被限流/封禁，影响整条私信触达链路可用性 | 本轮已修复：新增 `isFollowRateLimited`/`isLikeRateLimited` 纯函数，Step 6 强制在关注/点赞动作执行前判定滑动窗口内次数，达到上限即跳过本次动作（不阻塞、不重试、不排队），随单测覆盖 under/exactly-at/over-limit/窗口外历史不计入四类场景 | 本 sprint 内已处理（见 Step 6 + Test Contract） |
| 2 | 误关注不可逆——PRD"关于关注的产品决策"段明确"关注是不可逆的社交动作（对方会收到通知），本次决策为不做取消关注机制"，即使后续判定该 lead 低价值也不回滚 | 用户/小号可能对不合适的 lead 产生不可撤销的关注动作，被关注方会收到系统通知 | **无 mitigation，仅存档说明**：这是 PRD 层面已拍板的产品决策（用户已确认接受），本 sprint 不实现取消关注机制、不做补偿性回滚逻辑。此处登记目的是让该风险在合同里显式可见，而非遗漏未提及；如未来该风险被验证为业务问题，需走新的 PRD 决策而非本 sprint 隐式处理 | 已知且用户已确认接受，不需要修复，仅记录存档 |

---

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: agent_remote
**target_environment**: local_api
**target_environment_reason**（PRD 显式声明）: Harness 只做纯函数/单元测试级验收（身份核对、按钮态判断、超时熔断三块抽函数写单测跑 CI），真机搜索定位+关注+点赞+私信全链路由人工在 Honor 真机（Tailscale IP 100.91.227.1）手动补验。

> 本 sprint 无 HTTP/DB 交互，不适用通用 `local_api`（curl+psql）模板；按 PRD 显式指定，采用 Android Gradle 单元测试模板（与既有 sprint 07052218-douyin-dm-outreach-android 的 smoke 脚本同款约定：CI ubuntu-latest runner 预装 Android SDK 自动设有 `ANDROID_HOME`，可直接跑；本地开发机缺 `ANDROID_HOME` 时降级为 `logic-done-pending`，不得直接判 done）。

```bash
#!/bin/bash
set -e

cd services/agent-android

if [ -z "${ANDROID_HOME:-}" ]; then
  echo "⚠️  ANDROID_HOME 未配置——本地降级为 logic-done-pending，CI ubuntu-latest runner 必须真跑本脚本"
  exit 0
fi

gradle :app:testDebugUnitTest --tests "*DouyinDmWarmupSearchLogicTest*" --rerun

RESULT_XML="app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DouyinDmWarmupSearchLogicTest.xml"
[ -f "$RESULT_XML" ] || { echo "FAIL: 测试结果文件不存在 $RESULT_XML"; exit 1; }
grep -q 'failures="0" errors="0"' "$RESULT_XML" || { echo "FAIL: Android 单测未全绿"; exit 1; }

# 断言测试数量 ≥ 覆盖五块纯函数所需的最小用例数（防止 Generator 删测试假绿）
TEST_COUNT=$(grep -o 'tests="[0-9]*"' "$RESULT_XML" | head -1 | grep -o '[0-9]*')
[ "$TEST_COUNT" -ge 22 ] || { echo "FAIL: 测试用例数 $TEST_COUNT < 22，疑似删测试"; exit 1; }

echo "✅ Golden Path 验证通过（抖音号精确匹配 + 按钮态判断 + 90秒超时熔断 + 关注/点赞每小时频控，共 $TEST_COUNT 条用例全绿）"
```

**PASS 标准**：脚本 exit 0 + `TEST-...DouyinDmWarmupSearchLogicTest.xml` 内 `failures="0" errors="0"` + 用例数 ≥ 22
**FAIL 标准**：任意 gradle 步骤非 0 exit / 结果文件缺失 / 有 failures 或 errors / 用例数被删减
**人工真机补验**（不计入本次 Harness E2E，见接缝清单）：Honor 真机（Tailscale 100.91.227.1）对一个真实测试账号跑通"搜索定位到主页→关注→点赞第一个作品→私信发送→确认送达"，Dashboard 触达记录页确认状态变 `sent`

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 抖音号精确匹配纯函数 | `tests/DouyinDmWarmupSearchLogicTest.kt` | `matches exactly one profile by exact douyin id yields UNIQUE`, `zero matches yields NO_MATCH`, `empty search results yields NO_MATCH`, `multiple identical matches yields AMBIGUOUS`, `partial substring match does not count as exact match` | → 编译失败（`matchProfileByDouyinId`/`ProfileMatchResult` 未定义）5 failures |
| 按钮态判断纯函数（关注/点赞）| `tests/DouyinDmWarmupSearchLogicTest.kt` | `follow button text 关注 needs click`, `follow button text 已关注 does not need click`, `null follow button (not found) does not need click`, `like button text 点赞 needs click`, `like button text 已赞 does not need click`, `null like button (no artwork or follow-only profile) does not need click` | → 编译失败（`needsFollowClick`/`needsLikeClick` 未定义）6 failures |
| 90 秒超时熔断纯函数 | `tests/DouyinDmWarmupSearchLogicTest.kt` | `elapsed time over 90 seconds is timed out`, `elapsed time exactly at 90 second boundary is not timed out`, `elapsed time under 90 seconds is not timed out` | → 编译失败（`isLeadTimedOut`未定义）3 failures |
| 关注/点赞每小时频控纯函数 | `tests/DouyinDmWarmupSearchLogicTest.kt` | `follow count under hourly limit is not rate limited`, `follow count exactly at hourly limit is rate limited`, `follow count over hourly limit is rate limited`, `follow timestamps outside 1 hour window are not counted`, `like count under hourly limit is not rate limited`, `like count exactly at hourly limit is rate limited`, `like count over hourly limit is rate limited`, `like timestamps outside 1 hour window are not counted` | → 编译失败（`isFollowRateLimited`/`isLikeRateLimited` 未定义）8 failures |
