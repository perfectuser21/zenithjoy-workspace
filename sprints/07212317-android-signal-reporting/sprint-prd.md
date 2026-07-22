# Sprint PRD — Path 2 安卓 Agent 信号上报能力（心跳+UIA 双信号 / 采集失败分类 / 评论回填 / 触达前二次检测）

## OKR 对齐

- **对应 Journey**：Path 2 客户智能获客（Notion: https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf）
- **当前进度**：Step 6-8 服务端链路已通，但 Agent 侧信号上报能力不足：在线状态仅靠笼统心跳、采集失败原因无分类、`acquisition_leads.latest_reply` 字段建好却无写入路径、触达前无二次在线检测
- **本次推进预期**：golden-path-2-smoke.sh 新增 Step 15-19 断言，验证上述四类信号从 Agent 上报到中台可读

## 背景与根因

员工真机测试反馈（2026-07-21）：

1. **小号列表看不出真实在线状态**：`agent_platform_sessions.status` 只有 `active/expired/pending` 三值，全靠 `bound_at` 时间推算，没有心跳粗筛 + UIA 精确确认的二级判定信号。
2. **采集失败不知道具体原因**：`acquisition_collect_tasks.error_code` 字段存在，但 Android Agent 侧上报时只传笼统 `failed`，无五分类枚举（KEYWORD_NO_RESULT / KEYWORD_BANNED / PLATFORM_RATE_LIMIT / NETWORK_ERROR / ACCOUNT_STATUS_ERROR）。
3. **线索详情看不到最新评论回复**：`acquisition_leads.latest_reply` / `latest_reply_at` 已在迁移 `20260703000000_leads_reply_assignee.sql` 建好，但全仓库查不到写入路径——是纯死列。
4. **触达前不知道账号是否真能用**：`buildAssignments` 查在线 burner 时依赖 `agent_platform_sessions.status='active'`，但 status 只在扫码结果写回时更新，不随心跳变化，实际掉线的号仍可能被选中派单。

## Golden Path（用户操作流程）

### GP-1 在线状态二级判定（心跳粗筛 + UIA 精确确认）

```
客户看小号列表 → Agent 上报心跳（粗筛）+ UIA 探测结果（精确）→
  分支 A：心跳超时 → 判离线，status 置 offline
  分支 B：心跳正常 + UIA 确认掉线/强制下线 → 判离线，覆盖心跳误判
  分支 C：心跳正常 + UIA 确认在线 → 判在线，status 置 active
  分支 D：心跳正常 + UIA 探测失败（面板打不开/超时）→ 判"未知"，status 置 uia_unknown
```

Agent 协议扩展：`heartbeat` payload 新增可选字段 `uia_online_status`（枚举：`online | offline | unknown`）。中台收到后按上述逻辑决策并写回 `agent_platform_sessions`。

### GP-2 采集失败原因分类上报

```
Android Agent 执行关键词搜索/抓取 → 遇到问题 → 上报 /api/acquisition/collect/report 时携带 error_code（五分类或 UNKNOWN）
→ 中台写入 acquisition_collect_tasks.error_code → GET /api/acquisition/tasks 能读出具体原因
```

五分类枚举（Android 端实现约定）：
- `KEYWORD_NO_RESULT`：关键词无结果
- `KEYWORD_BANNED`：关键词违规/屏蔽
- `PLATFORM_RATE_LIMIT`：平台触发限流
- `NETWORK_ERROR`：网络异常
- `ACCOUNT_STATUS_ERROR`：账号状态异常（被风控/下线）
- `UNKNOWN`：兜底（不确定原因，必须上报而非静默丢弃）

### GP-3 评论区新回复增量识别与回填

```
采集任务执行中 → Agent 顺带识别评论区新回复（相比上次任务的增量）
→ 上报 /api/agent/burner/crawl-comments-result 时携带 latest_reply 字段
→ 中台 lead-writer 写 acquisition_leads.latest_reply + latest_reply_at
→ GET /api/acquisition/leads 能读出非空值
```

触发时机：复用采集任务，不新建独立轮询。仅增量识别（上次任务记录的 `latest_reply_at` 之后的新回复）。

### GP-4 触达前二次在线检测

```
buildAssignments（Build 阶段）→ 查在线 burner → 指派账号
→ dispatchDue（Dispatch 执行前，发 WebSocket 派单前）→ 再查一次该 assignment 的 account_label 当前在线状态
  → 在线：正常发
  → 离线/unknown：assignment 回退 pending_dispatch，等下一轮 buildAssignments 重新指派
```

Gap 处理：两次查之间（build→dispatch 间隔通常 <5 分钟）若账号变离线，触达任务不强发，回退重排。

### GP-5 最小 API 消费验证

新增 GET 端点：`GET /api/agent/burner/sessions` 响应扩展（或新端点 `GET /api/acquisition/account-signal`）返回：
- `online_status`：`active | offline | uia_unknown`
- `last_error_code`：该账号上次采集任务失败原因（或 null）
- `latest_comment_sync_at`：最近一次评论回填时间戳（或 null）

## 涉及 Feature 与加厚方向

| Feature | 当前 thickness | 本次操作 | 具体变化 |
|---------|--------------|---------|---------|
| 机器管理（在线状态）| medium/working | 加厚内部丰富 | heartbeat payload 加 uia_online_status → agent_platform_sessions 多 offline/uia_unknown 状态值 |
| 抖音私信主动触达 | medium/working | 加厚：二次在线检测 | dispatchDue 执行前查 account_label 当前状态，离线回退 pending_dispatch |
| 采集任务可观测性 | 不存在（新建） | thin | error_code 五分类枚举定义 + Agent 协议约束 + smoke 断言 |

## Response Schema

### 扩展 heartbeat payload（agent-protocol.ts `HeartbeatPayload`）

```typescript
// 新增可选字段
uia_online_status?: 'online' | 'offline' | 'unknown';
// 配套：每个小号的 UIA 探测结果数组（可批量上报）
account_uia_results?: Array<{
  account_label: string;
  uia_status: 'online' | 'offline' | 'unknown';
}>;
```

### 扩展 crawl-comments-result payload

```typescript
// 已有字段基础上新增
latest_reply?: string;           // 最新评论回复文本（null = 无新回复）
latest_reply_at?: string;        // ISO 8601 时间戳
```

### 新增 GET /api/acquisition/account-signal（或扩展 burner/sessions）

```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "account_label": "burner-01",
        "status": "active",
        "online_status": "active",
        "last_error_code": null,
        "latest_comment_sync_at": "2026-07-21T10:30:00Z"
      }
    ]
  },
  "timestamp": "..."
}
```

## DB 变更

### 迁移文件：`20260722_android_signal_reporting.sql`

```sql
-- 1. agent_platform_sessions 新增 uia_online_status 字段
ALTER TABLE zenithjoy.agent_platform_sessions
  ADD COLUMN IF NOT EXISTS uia_online_status text DEFAULT NULL,
  CONSTRAINT chk_aps_uia_status CHECK (
    uia_online_status IS NULL OR uia_online_status IN ('online', 'offline', 'unknown')
  );
-- 更新 status CHECK 约束，加入 offline / uia_unknown
-- （已有 20260524 migration 加过 offline/connected，确认后按需补全）

-- 2. acquisition_collect_tasks error_code 五分类约束（仅文档约束，不 CHECK 强制，因历史数据含旧值）
COMMENT ON COLUMN zenithjoy.acquisition_collect_tasks.error_code IS
  '采集失败原因五分类：KEYWORD_NO_RESULT / KEYWORD_BANNED / PLATFORM_RATE_LIMIT / NETWORK_ERROR / ACCOUNT_STATUS_ERROR / UNKNOWN（兜底）；partial 原因：video_insufficient / comments_closed / zero_comment';
```

## 边界情况

- UIA 探测超时（面板 3 秒内无响应）→ 上报 `uia_status: 'unknown'`，中台写 `uia_online_status='unknown'`，**不默认在线**
- 心跳超时（2 分钟无心跳）→ 直接判离线，`uia_online_status` 字段不作为判断依据
- 采集失败原因无法确定 → 必须上报 `error_code: 'UNKNOWN'`，禁止静默丢弃（丢弃导致中台永远无法定位根因）
- 评论无新增内容 → `latest_reply` 字段传 `null`，`latest_reply_at` 不更新（保留上次值）
- 触达 build-dispatch gap 内账号变离线 → 回退 `pending_dispatch`，不强发；回退次数上限（3 次）后标 `failed`

## 范围限定

**在范围内**：
- `apps/api/src/schemas/agent-protocol.ts`：HeartbeatPayload 新增 `uia_online_status` / `account_uia_results` 可选字段
- `apps/api/src/routes/walking-skeleton.ts`（心跳路由）：接收 UIA 结果，写 `agent_platform_sessions.uia_online_status`
- `apps/api/src/services/acquisition-collect.ts`：error_code 五分类枚举类型定义 + 落库路径验证
- `apps/api/src/services/acquisition-dispatch.ts`：`dispatchDue` 加触达前二次在线检测 + gap 回退逻辑
- `apps/api/src/services/lead-writer.ts`：`crawl-comments-result` 处理路径补写 `latest_reply` / `latest_reply_at`
- `apps/api/src/routes/agent-burner.ts`：`/api/acquisition/account-signal` 新端点（或扩展 burner/sessions）
- `apps/api/db/migrations/20260722_android_signal_reporting.sql`：DB 变更
- `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`：新增 Step 15-19 断言
- Vitest 单测：adoption commit-2 同步（二次在线检测 gap 回退 mock 场景 / error_code 五分类覆盖 / latest_reply 写入路径）

**不在范围内**：
- dashboard 展示层改动（小号在线状态 UI、采集失败原因卡片展示）—— Phase 2 独立 sprint
- 评论独立定时轮询任务
- Android APK 代码改动（Agent 协议约束用服务端契约测试覆盖，Android 侧 Kotlin 单测由 Android 通道负责）
- 触达状态回填获客列表 / 人工触达配置 / 下载客户端链接 / 关键词去重机制 / 任务进程状态展示（另立 sprint）

## 假设

- [ASSUMPTION: `agent_platform_sessions` 表已有 `offline` 值在 status CHECK 约束里（migration 20260524 加过），本次补 `uia_unknown` 或复用 `uia_online_status` 独立字段，确认后取其一]
- [ASSUMPTION: `lead-writer.ts` 的 `crawl-comments-result` 处理路径已能接收额外字段，只需补写两个新字段]
- [ASSUMPTION: `dispatchDue` 执行前距 `buildAssignments` 间隔 <10 分钟，gap 内变离线属小概率但真实发生场景]

## 验收标准（Final E2E）

**所有断言必须进 `golden-path-2-smoke.sh` Step 15-19，不能只进 vitest（铁律 5）**

### Step 15：心跳携带 UIA 结果写入 uia_online_status

```bash
# 发心跳时携带 uia_online_status=online，断言 DB 写入
# 真机段等价断言（TODO android-evaluator-channel）
AGENT_ID=$(psq "SELECT id FROM zenithjoy.agents ...")
curl POST /api/agent/heartbeat -d '{"uia_online_status": "online", "account_uia_results": [{"account_label":"$BURNER_LABEL","uia_status":"online"}]}'
# DB 断言：agent_platform_sessions.uia_online_status = 'online'
UIA=$(psq "SELECT uia_online_status FROM zenithjoy.agent_platform_sessions WHERE account_label='$BURNER_LABEL' AND agent_id='$AGENT_ID'")
[ "$UIA" = "online" ] || fail "Step 15 uia_online_status 未写入"
```

### Step 16：UIA 判离线覆盖心跳在线误判

```bash
# 心跳正常（机器在线）+ UIA 探测到掉线 → status 置 offline
curl POST /api/agent/heartbeat -d '{"account_uia_results": [{"account_label":"$BURNER_LABEL","uia_status":"offline"}]}'
STATUS=$(psq "SELECT status FROM zenithjoy.agent_platform_sessions WHERE account_label='$BURNER_LABEL'")
[ "$STATUS" = "offline" ] || fail "Step 16 UIA 离线覆盖心跳失败"
```

### Step 17：采集失败 error_code 五分类之一落库

```bash
# 模拟 Agent 上报采集失败（KEYWORD_NO_RESULT）
curl POST /api/acquisition/collect/report -H "x-agent-id: $AGENT_PK" \
  -d '{"task_id":"$COLLECT_TASK_ID","status":"failed","error_code":"KEYWORD_NO_RESULT"}'
ERR=$(psq "SELECT error_code FROM zenithjoy.acquisition_collect_tasks WHERE id='$COLLECT_TASK_ID'")
[ "$ERR" = "KEYWORD_NO_RESULT" ] || fail "Step 17 error_code 未落库或不在五分类内"
```

### Step 18：评论新回复写入 acquisition_leads.latest_reply

```bash
# 模拟 crawl-comments-result 携带 latest_reply 字段
curl POST /api/agent/burner/crawl-comments-result -H "x-agent-id: $AGENT_PK" \
  -d '{"task_id":"$CRAWL_TASK_ID","comments":[...],"latest_reply":"测试回复内容","latest_reply_at":"2026-07-22T10:00:00Z"}'
REPLY=$(psq "SELECT latest_reply FROM zenithjoy.acquisition_leads WHERE collect_task_id='$COLLECT_TASK_ID' LIMIT 1")
[ -n "$REPLY" ] || fail "Step 18 latest_reply 未写入（死列确认修复）"
REPLY_AT=$(psq "SELECT latest_reply_at FROM zenithjoy.acquisition_leads WHERE collect_task_id='$COLLECT_TASK_ID' LIMIT 1")
[ -n "$REPLY_AT" ] || fail "Step 18 latest_reply_at 未写入"
```

### Step 19：触达前二次检测 gap 回退 pending_dispatch

```bash
# 构造场景：assignment 已 queued（指派了离线号）→ dispatchDue 执行前二次检测发现账号离线
# → assignment 回退 pending_dispatch，不发出 WebSocket 消息
# 服务端 mock 场景断言（TODO android-evaluator-channel: 真机段由 Android 通道接管）
curl POST /api/acquisition/dispatch-due -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"dry_run_check":true}'  # 或通过 vitest mock 等价断言
REQUEUED=$(psq "SELECT count(*) FROM zenithjoy.dm_assignments WHERE status='pending_dispatch' AND tenant_id='$TENANT_ID'")
[ "$REQUEUED" -ge 1 ] || fail "Step 19 gap 内离线账号未回退 pending_dispatch"
```

### Step 20（最小 API 消费验证）

```bash
# GET /api/acquisition/account-signal 能返回在线状态 + 失败原因 + 评论同步时间戳
S20_TMP=$(mktemp)
curl -s "$API_BASE/api/acquisition/account-signal" -H "X-Tenant-Id: $TENANT_ID" -o "$S20_TMP"
python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
sessions=d['data']['sessions']
assert len(sessions)>=1
s=sessions[0]
assert 'online_status' in s
assert 'last_error_code' in s
assert 'latest_comment_sync_at' in s
print('account-signal 端点字段完整:', s)
" "$S20_TMP" || fail "Step 20 account-signal 端点字段不完整"
ok "Step 20 ✅ 最小 API 消费验证：online_status + last_error_code + latest_comment_sync_at 全齐"
```

**CI 门控（铁律 1）**：本 PR 把 Path 2 smoke Step 15-20 从 ❌ 推到 ✅；Step 1-14 保持全绿。

## 开发顺序（TDD 强制）

```
commit-1：E2E/smoke — golden-path-2-smoke.sh 新增 Step 15-20（此时跑 → 红，定义"什么叫完成"）
commit-2：DB 迁移 — 20260722_android_signal_reporting.sql（uia_online_status 字段 + 注释）
commit-3：协议层 — agent-protocol.ts 新增 uia_online_status / account_uia_results 字段定义
commit-4：心跳路由 + 写 DB — walking-skeleton 心跳处理器写 agent_platform_sessions.uia_online_status
commit-5：采集 error_code 五分类 — acquisition-collect.ts 枚举定义 + 落库路径验证单测
commit-6：lead-writer latest_reply 写入路径 — 修复死列，补单测
commit-7：dispatchDue 二次在线检测 — acquisition-dispatch.ts gap 回退逻辑 + mock 单测
commit-8：account-signal 端点 — 新增 GET 端点，补单测
commit-9：smoke 验证 — golden-path-2-smoke.sh Step 15-20 全绿（CI 门控通过）
```

## 文件清单（预期改动）

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/api/src/schemas/agent-protocol.ts` | 修改 | 新增 uia_online_status / account_uia_results 字段 |
| `apps/api/src/routes/walking-skeleton.ts` | 修改 | 心跳处理器写 uia_online_status |
| `apps/api/src/services/acquisition-collect.ts` | 修改 | error_code 五分类枚举类型 + 验证 |
| `apps/api/src/services/acquisition-dispatch.ts` | 修改 | dispatchDue 二次在线检测 + gap 回退 |
| `apps/api/src/services/lead-writer.ts` | 修改 | crawl-comments-result 写 latest_reply / latest_reply_at |
| `apps/api/src/routes/agent-burner.ts` | 修改 | 新增 GET /api/acquisition/account-signal 端点 |
| `apps/api/db/migrations/20260722_android_signal_reporting.sql` | 新建 | uia_online_status 字段 + error_code 注释 |
| `.github/workflows/scripts/smoke/golden-path-2-smoke.sh` | 修改 | 新增 Step 15-20 断言 |
| `apps/api/src/services/acquisition-collect.test.ts` | 修改 | error_code 五分类覆盖 |
| `apps/api/src/services/acquisition-dispatch.test.ts` | 修改 | gap 回退 mock 场景 |
| `apps/api/src/services/lead-writer.test.ts`（或新建） | 修改/新建 | latest_reply 写入路径 |

---

_Sprint ID: f08ab898-2090-4ffb-9aaa-a48c320d42d2_
_Sprint Dir: sprints/07212317-android-signal-reporting_
_生成时间: 2026-07-22_
