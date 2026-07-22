# Sprint PRD — Android Agent 信号上报能力（Path 2 信号层加厚）

**Task**: f08ab898-2090-4ffb-9aaa-a48c320d42d2
**Sprint**: 07212317-android-signal-reporting
**Date**: 2026-07-22
**Path**: Path 2 客户智能获客 — https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf

---

## Invariant 约束

1. **`agent_platform_sessions` 唯一键 `(agent_id, platform, account_label)` 不可破坏**；新增 UIA 信号字段须用 `ADD COLUMN IF NOT EXISTS`，不得改变既有约束
2. **`last_heartbeat_at` 仍是"机器是否在线"的粗筛基准**（2 分钟窗口），UIA 精确信号只能收窄判定，不得放宽心跳门槛
3. **`acquisition_leads.latest_reply / latest_reply_at` 已存在（migration 20260703）**；本 sprint 只补写入路径，不改列定义
4. **`acquisition_collect_tasks.error_code` 已存在**；错误分类枚举值必须向后兼容现有 `STAGE2_DISPATCH_EXHAUSTED` / `COLLECT_TIMEOUT` / `stage1_empty`，新增值加在已有列上而非新建列
5. **`dm_assignments.status` 值域 `queued / pending_dispatch / dispatched / sent / failed / cancelled` 不得破坏**；dispatch 前二次检测回退到 `pending_dispatch` 复用既有值
6. **租户隔离**：所有新写入路径必须携带 `tenant_id` 过滤；跨租户读写视为 P0 bug
7. **新 migration 文件必须幂等**（`ALTER TABLE … ADD COLUMN IF NOT EXISTS`，`CREATE TABLE IF NOT EXISTS`）
8. **Android Agent 上报接口须通过 `x-agent-id` / `agent_uuid` 反查 `tenant_id`**，禁止客户端直传 `tenant_id`

---

## 累积 FR

### FR-1 小号在线状态：心跳 + UIA 双信号落库

**背景**：现有 `GET /api/agent/burner/sessions` 返回的在线状态仅靠 `last_heartbeat_at > now()-2min`（机器心跳），小号本身是否掉线/被踢不感知。

**实现**：

#### FR-1a  `agent_platform_sessions` 加 UIA 信号字段（migration）
```sql
ALTER TABLE zenithjoy.agent_platform_sessions
  ADD COLUMN IF NOT EXISTS uia_online       BOOLEAN     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS uia_checked_at   TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS uia_error        TEXT        DEFAULT NULL;
```
- `uia_online = true`：UIA 探测到账号在线
- `uia_online = false`：UIA 探测到已掉线/被踢
- `uia_online = NULL`：从未上报过 UIA 信号（初始值，判定层按"未知"处理）
- `uia_error`：UIA 探测本身失败时的错误摘要（面板打不开/超时等）

#### FR-1b  新增 POST `/api/agent/burner/uia-signal` 接收 Android Agent UIA 探测结果
```
POST /api/agent/burner/uia-signal
Header: x-agent-id: <agent_uuid>
Body: {
  account_label: string,       // 小号标识
  uia_online: boolean,         // true=在线 / false=掉线
  uia_error?: string           // 探测失败时的错误描述（可选）
}
Response 200: { success: true }
```
- 服务端用 `x-agent-id` 反查 `agent_id`，再 UPDATE `agent_platform_sessions` 对应行的 `uia_online / uia_checked_at / uia_error`
- 若 `uia_online = false` → 同步将该 session `status` 改为 `offline`（覆盖心跳误判）

#### FR-1c  在线状态三级判定逻辑（GET /api/agent/burner/sessions 扩展返回字段）
判定规则（服务端计算，返回 `computed_online_status` 字段）：

| 条件 | 判定结果 |
|------|---------|
| 机器心跳超时（>2min） | `offline` |
| 心跳正常 + `uia_online = false` | `offline`（UIA 覆盖心跳） |
| 心跳正常 + `uia_online = true` | `online` |
| 心跳正常 + `uia_online = NULL`（从未上报） | `unknown` |
| 心跳正常 + `uia_error` 非空（探测失败） | `unknown` |

返回字段扩展：
```json
{
  "account_label": "...",
  "computed_online_status": "online|offline|unknown",
  "heartbeat_online": true,
  "uia_online": true,
  "uia_checked_at": "2026-07-22T10:00:00Z",
  "uia_error": null
}
```

---

### FR-2 采集失败原因五分类上报

**背景**：现有 `error_code` 是自由字符串，员工真机测试看不出具体失败原因。

**实现**：

#### FR-2a  定义五分类枚举（服务端 + Android Agent 协议）
```
KEYWORD_NO_RESULT   — 关键词无结果（搜索返回空列表）
KEYWORD_BANNED      — 关键词违规（平台屏蔽词）
PLATFORM_LIMIT      — 平台限制（频控/搜索次数超限）
NETWORK_ERROR       — 网络异常（超时/断网）
ACCOUNT_OFFLINE     — 账号状态异常（掉线/被封）
UNKNOWN             — 以上均不符合的兜底
```

#### FR-2b  扩展 POST `/api/acquisition/collect/report` 接受结构化 reason
现有 `reason` 字段支持 `error_code` 字符串，约束接受值为上述六枚举之一；服务端校验失败时记 `UNKNOWN`，不拒绝请求（向后兼容）：
```json
{
  "reason": {
    "search_result": "empty",
    "error_code": "KEYWORD_NO_RESULT"
  }
}
```
- 服务端校验 `error_code` 是否在枚举白名单，非白名单值强制改写为 `UNKNOWN` 并写日志
- `acquisition_collect_tasks.error_code` 落库时存规范化后的枚举值

---

### FR-3 评论最新回复增量写入路径

**背景**：`acquisition_leads.latest_reply / latest_reply_at` 字段已建（migration 20260703），全仓库无写入代码，是纯死列。

**实现**：

#### FR-3a  扩展 POST `/api/acquisition/collect/report` payload，接受 `latest_reply` 字段
Android Agent 在采集评论阶段若发现评论有新回复，上报时携带：
```json
{
  "comments": [...],
  "latest_reply": "这个有链接吗？",
  "latest_reply_at": "2026-07-22T09:30:00Z"
}
```
- 服务端在写 `acquisition_leads` 行时，若 payload 含 `latest_reply`，则 UPDATE 对应 lead 行的 `latest_reply / latest_reply_at`
- 仅当 `latest_reply_at` 更新（即新回复比已记录的更新）时才覆盖，避免旧数据覆盖新数据
- `latest_reply_at IS NULL` 视为首次写入，直接覆盖

#### FR-3b  lead 查询端点（GET /api/acquisition/leads）确认已返回 latest_reply 字段
现有代码（`acquisition.ts` L435/L447）已 SELECT 这两列，确认返回 schema 已包含；本 sprint 无需改 GET 路由，只需补写入路径。

---

### FR-4 dispatch 执行前二次在线检测

**背景**：`buildAssignments`（Step B）查询 burner 在线状态时只看 `last_heartbeat_at`，build 到 dispatch 执行之间存在 gap（账号从在线变离线），`dispatchDue` 执行时未做二次确认。

**实现**：

#### FR-4a  `dispatchDue` 执行前二次检测
在 `dispatchDue` 函数内，取到 `queued` 行后、发实际私信前，重新查当前该 `account_label` 对应 session 的 `computed_online_status`：
- `computed_online_status = offline`（心跳超时 OR `uia_online = false`）→ UPDATE 该行 `status = 'pending_dispatch'`，跳过本次 dispatch，不发私信
- `computed_online_status = online` → 继续正常派单
- `computed_online_status = unknown`（UIA 从未上报或探测失败）→ 保守策略：允许继续派单（不阻断），但写日志 `[dispatch] uia_unknown, proceeding with heartbeat-only`

#### FR-4b  二次检测在线状态辅助函数
新增 `getSessionOnlineStatus(pool, tenantId, accountLabel): Promise<'online'|'offline'|'unknown'>` 复用 FR-1c 的判定逻辑，供 `dispatchDue` 和未来扩展点调用。

---

### FR-5 最小 GET 端点：信号验证 API

**背景**：PrepPRD decision（8dbe91ee 教训）要求本 sprint 加消费验证端点，证明数据真实写入，不靠 dashboard 展示验收。

**实现**：

#### FR-5  GET `/api/acquisition/signal-verify`（smoke 专用验证端点）
```
GET /api/acquisition/signal-verify
Header: Authorization: Bearer <token>
Response 200:
{
  "burner_sessions": [
    {
      "account_label": "xxx",
      "computed_online_status": "online|offline|unknown",
      "uia_checked_at": "2026-07-22T...",
      "uia_online": true
    }
  ],
  "recent_collect_errors": [
    {
      "task_id": "...",
      "error_code": "KEYWORD_NO_RESULT",
      "updated_at": "..."
    }
  ],
  "recent_lead_replies": [
    {
      "lead_id": "...",
      "latest_reply": "...",
      "latest_reply_at": "..."
    }
  ]
}
```
- 只返回当前 tenant 最近 10 条数据，供 smoke 断言
- 不需要分页，不需要筛选参数

---

## NFR

| 维度 | 要求 |
|------|------|
| 幂等性 | 所有 migration 幂等（IF NOT EXISTS）；UIA 信号重复上报覆盖写，不插新行 |
| 性能 | `uia-signal` 写入 P99 < 100ms（单行 UPDATE）；`signal-verify` P99 < 300ms |
| 兼容性 | `collect/report` 接受旧 `error_code` 自由字符串，非枚举值强制降级为 `UNKNOWN` |
| 测试 | 每个 FR 必须有 vitest + supertest 单元测试；FR-4 dispatch 二次检测必须有 mock 离线场景断言 |
| 日志 | UIA 信号写入/dispatch 跳过/error_code 降级均须有结构化日志行，便于真机 debug |
| CI | `windows_cloud` runner 跑通，golden-path-2-smoke.sh 新增步骤全绿 |

---

## Golden Path（核心场景）

1. **小号在线状态双信号**
   - Android Agent 心跳正常 → `last_heartbeat_at` 更新
   - Android Agent UIA 探测在线 → `POST /api/agent/burner/uia-signal` body `{uia_online: true}` → session `uia_online=true / uia_checked_at=NOW()`
   - `GET /api/agent/burner/sessions` → `computed_online_status: "online"`
   - Android Agent UIA 探测掉线 → `POST /api/agent/burner/uia-signal` body `{uia_online: false}` → session `status='offline' / uia_online=false`
   - `GET /api/agent/burner/sessions` → `computed_online_status: "offline"`（覆盖心跳）

2. **采集失败分类上报**
   - Android Agent 遇到关键词无结果 → `POST /collect/report` body `{reason: {error_code: "KEYWORD_NO_RESULT"}}`
   - DB：`acquisition_collect_tasks.error_code = 'KEYWORD_NO_RESULT'`
   - 非枚举值 `"搜索失败"` → DB：`error_code = 'UNKNOWN'`，日志出现 `[acquisition] error_code normalized: UNKNOWN`

3. **评论最新回复写入**
   - Android Agent 采集评论，发现新回复 → `POST /collect/report` 含 `latest_reply / latest_reply_at`
   - DB：`acquisition_leads.latest_reply = '这个有链接吗？' / latest_reply_at = '2026-07-22T09:30:00Z'`
   - 重复上报旧时间戳 → DB 不覆盖（`latest_reply_at` 不更新到更旧值）

4. **dispatch 前二次检测 gap 处理**
   - `buildAssignments` 时 account_label=`burner_001` 在线 → 分配 `queued`
   - gap 期间 UIA 上报离线（`uia_online=false` → `status='offline'`）
   - `dispatchDue` 执行 → 二次检测 `computed_online_status=offline` → UPDATE `status='pending_dispatch'`，不发私信
   - 日志：`[dispatch] pre-dispatch check: offline, requeued as pending_dispatch`

5. **最小验证 API**
   - `GET /api/acquisition/signal-verify` → 返回包含 `burner_sessions[0].computed_online_status` + `recent_collect_errors[0].error_code` + `recent_lead_replies[0].latest_reply_at` 的 JSON

---

## Response Schema

### 新 Migration DDL

```sql
-- migration 文件名: 20260722_android_signal_reporting.sql
ALTER TABLE zenithjoy.agent_platform_sessions
  ADD COLUMN IF NOT EXISTS uia_online     BOOLEAN     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS uia_checked_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS uia_error      TEXT        DEFAULT NULL;
```

### 新端点行为一览

| 端点 | 方法 | 鉴权 | 说明 |
|------|------|------|------|
| `/api/agent/burner/uia-signal` | POST | `x-agent-id`（agentContext） | Android Agent 上报 UIA 探测结果 |
| `/api/agent/burner/sessions` | GET | tenant | 扩展返回 `computed_online_status` + `uia_*` 字段 |
| `/api/acquisition/collect/report` | POST | agentContext | 扩展接受 `latest_reply` + 规范化 `error_code` |
| `/api/acquisition/signal-verify` | GET | tenant | smoke 消费验证端点 |

### Smoke 断言要求（golden-path-2-smoke.sh 新增步骤）

```bash
# Step 15: UIA 在线信号上报与读取
# Step 16: 采集失败 error_code 五分类落库验证
# Step 17: latest_reply 写入路径验证
# Step 18: dispatch 前二次检测 mock 离线场景（API 层等价断言）
# Step 19: signal-verify 端点返回三字段完整性断言
```

---

## 验收标准（Final E2E）

- [ ] `golden-path-2-smoke.sh` Step 15-19 全绿
- [ ] `GET /api/agent/burner/sessions` 返回 `computed_online_status` 字段，值来自心跳+UIA双信号
- [ ] 采集失败 `error_code` 落库为 `KEYWORD_NO_RESULT | KEYWORD_BANNED | PLATFORM_LIMIT | NETWORK_ERROR | ACCOUNT_OFFLINE | UNKNOWN` 之一，非枚举值自动降级 `UNKNOWN`
- [ ] `acquisition_leads.latest_reply / latest_reply_at` 有真实写入路径，旧时间戳不覆盖新值
- [ ] `dispatchDue` mock 离线场景：gap 内账号变离线 → 断言 `dm_assignments.status = 'pending_dispatch'`，不触发私信发送
- [ ] `GET /api/acquisition/signal-verify` 返回三组数据且字段非空
- [ ] CI 全绿（`windows_cloud` runner）

---

## Path 推进声明

本 PR 把 **Path 2 Step 7（中台检测登录态）** 从"心跳粗判"加厚到"心跳+UIA双信号精确判定"，同时把 **Step 8（评论区挖客闭环）** 的信号上报可观测性从无到有建立（失败分类 + 最新回复回填 + dispatch 前二次检测）。

---

journey_type: android_agent_backend
target_environment: windows_cloud
