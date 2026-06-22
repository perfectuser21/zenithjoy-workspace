# Sprint Contract Draft (Round 3) — 微信客服 无审批自动回复闭环（Line 04）

**journey_type**: agent_remote
**target_environment**: windows_wechat（xian-rog self-hosted runner，真实微信 4.1.8 已登录）

> 两层验证：**逻辑断言**（环境无关：路由真值表 / 营业时间含跨午夜 / 1~5s 延迟 / 去重 / 超时 / daily_limit / 播报·告警决策 / 配置键 / DB CHECK）走 CI（pytest+vitest+psql+smoke），CI 绿 = 真 done。**接缝断言**（真机微信真送达 / 不抢焦点 / 名单外 pending_human 真可见 / 失败告警真送达）必须在 xian-rog 真机验，CI 绿 ≠ done，未真验标 `logic-done-pending`（见文末「接缝清单」）。

---

## 已知约束（来自回归测试）

- [services/agent/wechat-rpa/tests/test_reply_routing_isolation.py] → 回复路由按发送者隔离，绝不回错联系人/回自己
- [services/agent/wechat-rpa/tests/test_focus_no_steal.py] → 纯 UIA 发送不抢前台焦点（B 方案铁律）
- [services/agent/wechat-rpa/tests/test_delivery_verification.py] → 发送后读回验证真送达
- [services/agent/wechat-rpa/tests/test_rate_limiter.py] → 频控分钟/24h/操作间隔；CHAT_PER_MINUTE_LIMIT=0 不限
- [services/agent/wechat-rpa/tests/test_msg_direction.py] → 消息方向识别（防回自己）
- [apps/api/tests/regression/line04-cs-tenant-isolation.test.ts] → 读写一律按 tenant 过滤，绝不跨租户
- [apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts] → mode:'auto' 返回 reply，mode:'review' 不带 reply，名单外 not_in_whitelist

---

## Response Schema（推导来源: api_registry 为空 → 基于现有 `wechat-draft.ts` 类型 + `NEW_PATTERN`）

本 sprint 核心新增「路由决策」。HTTP 端点层无新增响应（draft-generate 复用现有），可验证契约定在三处纯/半纯接口：

### ① 路由决策（核心新增，纯函数，`NEW_PATTERN`）
`decide_reply_route(in_whitelist, business_hours_ok, auto_agent_on, daily_count, daily_limit) -> str`

返回值为下列**字面量字符串之一**（禁用同义替换词，见禁用列表）：
```
"auto"          # 名单内 ✅ + 营业时间内 ✅ + 自动代理 ON ✅ + 未超 daily_limit → 拟人延迟自动回
"review"        # 自动代理 OFF（监控态）→ 出草稿写飞书 pending_review，不自动发
"pending_human" # 名单外 OR daily_limit 超额 → 不生成不发，记 pending_human 待人工
"skip_offhours" # 营业时间外 → 不回（记 pending 待上班）
```
真值表（contract-dod 逐行 codify 成断言）：

| auto_agent_on | in_whitelist | business_hours_ok | daily 未超 | → route |
|---|---|---|---|---|
| false | * | * | * | `review` |
| true | false | * | * | `pending_human` |
| true | true | false | * | `skip_offhours` |
| true | true | true | false（超额） | `pending_human` |
| true | true | true | true | `auto` |

**禁用字段名/值**（语义直观但与契约不符，严禁出现）：`auto_reply`/`autosend`/`whitelist_miss`/`off_hours`/`limited`/`blocked`/`skip`（裸 skip）/`pending`（裸 pending）。route 取值 ⊆ 上面 4 个字面量。

### ② generateChatDraft mode:'auto' 扩展结果（复用现有 `GenerateChatDraftResult` 类型，字面字段名不可改）
```json
{"ok": true, "status": "pending_review", "task_id": "<uuid>", "reply": "<文案>"}   // route=auto 且 AI 成功
{"ok": true, "status": "pending_review", "task_id": "<uuid>"}                       // route=review（无 reply）
{"ok": false, "reason": "not_in_whitelist"}                                         // 名单外 → 上层记 pending_human
```
- `ok` (boolean, 必填)：来源——现有类型 `GenerateChatDraftSuccess.ok`
- `status` (string 字面量 `"pending_review"`, 必填)：来源——现有 `GenerateChatDraftSuccess.status`
- `reply` (string, 可选)：仅 route=auto 且 AI 成功；AI 失败/超时 → 字段缺省（listener 跳过不发占位）。来源——现有 `GenerateChatDraftSuccess.reply`
- `reason` (string 字面量 `"not_in_whitelist"`, rejected 时必填)：来源——现有 `GenerateChatDraftRejected.reason`
**禁用字段名**：`text`/`message`/`content`/`answer`（回复文本字段一律叫 `reply`）；`error`（rejected 用 `reason` 不用 `error`）。

### ③ listen_chat.py --dryrun receipt（复用现有，字面字段名不可改）
```json
{"ok": true, "dryRun": true, "draft_generated": true}
```
路由取值由 ① `decide_reply_route` 纯函数 oracle 全覆盖验证（route ⊆ 4 字面量 + 禁用同义词反向断言，见 contract-dod BEHAVIOR）；receipt 不再单独声明无独立 CI oracle 的 `route` 字段（listen_chat 依赖 Windows-only UIA，linux CI 无法 codify；接缝层真送达由 e2e-verify.ps1 验证）。

---

## Golden Path

[管理员配置+开关 ON → 关键人收上线播报] → [名单内来消息 → 三重校验 → 组装上下文 → DeepSeek → 1~5s 拟人延迟 → 不抢焦点真送达 → 读回验证 → 回执] / [名单外 → pending_human] → [开关 OFF → 关键人收下线播报 → 监控态]

---

### Step 1: 管理员配置关键人/营业时间，打开「开启自动代理」→ 系统主动给关键人发上线播报
**来源**: `[FROM_PRD]` — Golden Path 步骤 1（PRD「Golden Path（核心场景）」第 1 条）

**可观测行为**: 配置页保存 5 个新键（`auto_agent_enabled`/`business_hours_start`/`business_hours_end`/`key_contact_wechat`/`daily_limit`）→ 自动代理由 OFF 跳变 ON → 系统调 send_chat 主动给 `key_contact_wechat` 发上线播报文案（如「🟢 智能客服已上线」）→ 关键人真收到。

**验证命令**:
```bash
# 逻辑层（CI）：配置键 upsert 可读回 + 跳变播报决策
npx vitest run sprints/06220821-line04-cs-no-approval-auto-reply/tests/cs-auto-agent-config.test.ts --reporter=verbose
python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q -k "broadcast_online"
```
**硬阈值**: 配置 upsert 后 `getAutoAgentConfig()` 读回 5 键一致；`broadcast_action(prev=False, next=True, key_contact="ks_wx")` 返回 `{"action":"online","target":"ks_wx"}`。
**接缝**（xian-rog 真机）：打开开关 → 关键人微信**真收到**上线播报（屏幕全程不闪）。`logic-done-pending` 直至真机验过。

---

### Step 2: 名单内客户私聊 → 三重校验 → 组装上下文 → DeepSeek → 随机 1~5s → 不抢焦点发出 → 读回验证 → 客户真收到
**来源**: `[FROM_PRD]` — Golden Path 步骤 2

**可观测行为**: `decide_reply_route` 对（名单内+营业时间内+ON+未超额）返回 `auto`；generateChatDraft(mode:auto) 返回 `reply`；回复前等随机 1~5s；纯 UIA 发出不抢前台焦点；读回验证真送达。

**验证命令**:
```bash
# 逻辑层（CI）：路由真值表 auto 行 + 1~5s 延迟范围 + auto 模式 reply 集成
python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q -k "route_auto or reply_delay"
( cd apps/api && npx vitest run src/services/__tests__/wechat-draft-auto-reply.test.ts )
```
**硬阈值**: `decide_reply_route(True,True,True,0,0)=="auto"`；`pick_reply_delay()` 返回值 `1.0 ≤ d ≤ 5.0`（多次采样均落区间）；mode:auto 成功时结果含 `reply` 字段。
**接缝**（xian-rog 真机）：名单内号发消息 → AI **1~5s 内自动回、该号真收到、窗口不抢焦点**（复用 test_focus_no_steal + test_delivery_verification 真机跑）。`logic-done-pending`。

---

### Step 3: 名单外的人私聊 → 不生成不发 → 写 pending_human 到 DB + 飞书 → 管理员可见
**来源**: `[FROM_PRD]` — Golden Path 步骤 3

**可观测行为**: `decide_reply_route` 对（名单外）返回 `pending_human`；不调 LLM、不发送；写一条 `wechat_publish_task`（`approval_status/status=pending_human`，`approval_source=system`）+ 飞书「互动记录」。

**验证命令**:
```bash
python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q -k "route_pending_human and not_in_whitelist"
# DB 状态可写（见 Step 7 migration BEHAVIOR）
```
**硬阈值**: `decide_reply_route(in_whitelist=False, ...)=="pending_human"`；名单外路径**不调用** LLM/send_chat（mock 断言 call_count==0）。
**接缝**（xian-rog 真机）：名单外号发消息 → **不被自动回**，且飞书/DB 真出现一条 pending_human。`logic-done-pending`。

---

### Step 4: 发送完成 → 回执（成功/失败+原因）回写飞书「互动记录」/DB → 管理员可见
**来源**: `[FROM_PRD]` — Golden Path 步骤 4

**可观测行为**: 自动发成功 → DB 回执 `status=auto_sent`（`approval_source=system`）+ 飞书；失败（读回失败/掉线）→ `status=send_failed`、记原因、**不重发**。

**验证命令**:
```bash
python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q -k "receipt"
```
**硬阈值**: 成功回执 route→`auto_sent`；失败回执 `send_failed` 且 `retry==False`（不重发，防刷屏）。
**接缝**（xian-rog 真机）：自动发后 DB/飞书出现 `auto_sent` 回执；读回失败时出现 `send_failed` 回执。`logic-done-pending`。

---

### Step 5: 管理员关闭「开启自动代理」→ 系统主动给关键人发下线播报 → 回退监控态
**来源**: `[FROM_PRD]` — Golden Path 步骤 5

**可观测行为**: 开关 ON→OFF 跳变 → 调 send_chat 给 `key_contact_wechat` 发下线播报（如「🔴 智能客服已下线，转人工」）→ 后续名单内消息走 `review`（监控态出草稿不发）。

**验证命令**:
```bash
python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q -k "broadcast_offline or route_review_when_off"
```
**硬阈值**: `broadcast_action(prev=True,next=False,key_contact="ks_wx")=={"action":"offline","target":"ks_wx"}`；OFF 时 `decide_reply_route(in_whitelist=True, auto_agent_on=False, ...)=="review"`。
**接缝**（xian-rog 真机）：关闭开关 → 关键人微信**真收到**下线播报。`logic-done-pending`。

---

### Step 6: 边界与可靠性（监控态默认/营业时间外/关键人未配/去重/LLM超时/daily_limit/失败掉线告警）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD「边界情况」+「NFR 约束」是 thin ability 的可靠性铁律，必须 codify 成可机检断言，防止 generator 只做 happy path 假绿。

**可观测行为 + 验证命令**:
```bash
python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q \
  -k "business_hours or dedup or llm_timeout or daily_limit or alert or key_contact_unconfigured"
```
**硬阈值**（逐条）:
- **营业时间含跨午夜**：`within_business_hours("06:00","24:00", t)` 全天为真；`within_business_hours("22:00","02:00", t=23:30)` 真、`t=03:00` 假（跨午夜 OR 逻辑）。
- **监控态默认**：`auto_agent_enabled` 缺省读为 `False`（默认关）。
- **去重幂等**：同 `(contact, text, time_window)` 第二次 `is_duplicate(...)` 为真 → 只回一次。
- **LLM 超时**：generate >20s（`WECHAT_CS_TIMEOUT_MS≈20000`）→ 跳过、reply 缺省、不发占位（复用 FAIL_PLACEHOLDER 不外发）。
- **daily_limit**：`daily_limit=0` 不限；`daily_limit=2` 且 `daily_count>=2` → route `pending_human`。
- **关键人未配**：`broadcast_action(prev,next,key_contact="")=={"action":"skip","target":""}` 记日志不阻塞开关。
- **失败/掉线告警**：`alert_on_failure(reason, key_contact)` 返回给关键人的告警 payload（同时要求写飞书）。

---

### Step 7: DB migration — approval_source CHECK 放开容 `system` + status 容 `auto_sent`/`pending_human`，非法值仍拒
**来源**: `[AI_ADDED]` — Proposer 加入，理由：防造假——若 generator 不真改 CHECK 约束，名单外/自动发回执根本写不进库（23514），happy-path 测试会用 mock pool 假绿绕过；必须用真 psql 验 CHECK 真放开且仍拒非法值。

> **DB SSOT 锚定**：迁移 `20260513_221814_create_wechat_publish_task.sql` 定义 `status CHECK IN (draft,approved,rejected,sent,failed)` + `approval_source CHECK IN (feishu_user,feishu_api)`。本 sprint 新迁移须 `DROP/ADD` 这两个 CHECK：status 增 `auto_sent`/`pending_human`/`send_failed`；approval_source 增 `system`。

**可观测行为**: 迁移后真 INSERT `approval_source='system'` + `status IN ('auto_sent','pending_human','send_failed')` 成功；INSERT 非法 `status='garbage'` 仍报 23514。

**验证命令**:
```bash
DB="${DB:-${DATABASE_URL:-postgresql://localhost/zenithjoy}}"
# 应用本 sprint 新迁移（runner 幂等：已应用则 no-op exit 0；tsx 不可用回退 node；两者皆失败=环境问题，须 FAIL 不吞）
npx tsx apps/api/db/migrations/run-migration.ts 2>/dev/null || node apps/api/db/migrations/run-migration.js 2>/dev/null
# system + auto_sent 可写
psql "$DB" -c "INSERT INTO zenithjoy.wechat_publish_task (agent_id, task_type, content, status, approval_source) VALUES (gen_random_uuid(),'private_chat','c1','auto_sent','system')" >/dev/null
# pending_human 可写
psql "$DB" -c "INSERT INTO zenithjoy.wechat_publish_task (agent_id, task_type, content, status, approval_source) VALUES (gen_random_uuid(),'private_chat','c2','pending_human','system')" >/dev/null
# send_failed 可写（读回失败/掉线回执依赖此状态，漏写则运行时每次失败触发 23514）
psql "$DB" -c "INSERT INTO zenithjoy.wechat_publish_task (agent_id, task_type, content, status, approval_source) VALUES (gen_random_uuid(),'private_chat','c3','send_failed','system')" >/dev/null
# 非法 status 仍被拒（期望非 0 exit）
psql "$DB" -c "INSERT INTO zenithjoy.wechat_publish_task (agent_id, task_type, content, status, approval_source) VALUES (gen_random_uuid(),'private_chat','c4','garbage_status','system')" 2>&1 | grep -q "violates check constraint" && echo "REJECT-OK"
```
**硬阈值**: 前三条 INSERT exit 0；第四条命中 `violates check constraint`（23514）打印 `REJECT-OK`。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=windows_wechat，由 evaluator 派发 xian-rog 执行）

> GAN 阶段只产出脚本模板；模式 B final-e2e 由 evaluator 作为独立 task 在 xian-rog self-hosted runner（`wechat-capable`，真实微信 4.1.8 已登录）执行。
> 触发：`gh workflow run e2e-wechat-rpa.yml --repo perfectuser21/zenithjoy-workspace`。

脚本见同目录 `e2e-verify.ps1`（接缝层，真机真送达）。核心断言：
- 真实微信进程在跑（非 mock，禁 `MOCK_WECHAT_VERSION`）；读真实 listen_chat 版本。
- 打开/关闭自动代理 → 关键人微信真收到上线/下线播报。
- 名单内号发消息 → AI 1~5s 内自动回、该号真收到、窗口不抢焦点。
- 名单外号发消息 → 不被自动回，飞书/DB 出现 pending_human。
- 发送失败/掉线 → 告警真送达关键人微信。
- 防造假：本轮 DB 记录/产物 LastWriteTime/created_at 必须晚于脚本启动（时间窗）。

**PASS 标准**: 脚本 exit 0 + 真实微信版本读取成功 + 四类接缝真送达断言通过。
**FAIL 标准**: exit 1 OR 微信未运行 OR 检测到 `MOCK_*` 注入。

---

## 接缝清单（v9.3 — 碰真实世界的点，未真验只能标 logic-done-pending）

| # | 接缝点（碰真实世界在哪） | 真目标验证方式（xian-rog 真机） |
|---|---|---|
| 1 | 上/下线播报真送达关键人微信 | 真机切开关 → 关键人号屏幕真收到🟢/🔴文案，窗口不闪 |
| 2 | 名单内自动回真送达 + 不抢焦点 | 真机名单内号发消息 → 1~5s 内真收 AI 回复，前台焦点不被抢（focus_no_steal 真机） |
| 3 | 名单外 pending_human 真可见 | 真机名单外号发消息 → 不被回，飞书/DB 真出现一条 pending_human（created_at 在脚本启动后时间窗内） |
| 4 | 失败/掉线告警真送达 | 真机制造读回失败/掉线 → 关键人号真收到告警 + 飞书真写一条 |

> 上述 4 条**未在 xian-rog 真机验证前一律标 `logic-done-pending`，不得标 done**。逻辑层（路由真值表/营业时间/延迟/去重/超时/daily_limit/播报·告警决策/配置键/DB CHECK）CI 绿即逻辑 done。
> **禁止写死环境假设值**：营业时间边界、1~5s 延迟、daily_limit、UIA/焦点几何阈值一律从配置/环境推导或真机校准，禁止硬编码兜过接缝。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 路由真值表 + 营业时间 + 延迟 + 去重 + 超时 + daily_limit + 播报/告警 | `services/agent/wechat-rpa/tests/test_auto_reply_route.py`（proposer oracle，generator 实现 `auto_reply.py` 使其转绿）| route/within_business_hours/pick_reply_delay/is_duplicate/llm_timeout/daily_limit/broadcast_action/alert_on_failure | import auto_reply 失败 → N failures |
| 5 个新配置键读写 | `sprints/.../tests/cs-auto-agent-config.test.ts`（vitest oracle）| getAutoAgentConfig/saveAutoAgentConfig | 函数不存在 → fail |
| DB CHECK 放开 | `psql`（contract-dod [BEHAVIOR]）| approval_source 容 system / status 容 auto_sent,pending_human | 旧 CHECK → 23514 |
