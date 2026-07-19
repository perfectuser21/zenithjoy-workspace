# Sprint PRD：GP-A 主动语音触达 — 补齐触发入口与派发链路

## 元数据

| 字段 | 值 |
|------|-----|
| task_id | 2ac0e77b-c2e3-47e9-92dd-7549622835d7 |
| sprint_dir | sprints/07191407-gpa-dispatch-trigger |
| journey | 智能客服 · GP-A 主动语音触达（ID: 55d26529-2274-4c30-85fe-168edcef4d76） |
| journey_type | user_facing |
| target_environment | windows_wechat（真机 xian-rog）+ windows_cloud（CI Playwright） |
| maturity | skeleton → thin |
| 前置 sprint | 07182017-gpa-voice-outreach（PR #1397，已合并） |

## 本 Sprint 推进声明

本 PR 把 GP-A 主动语音触达 从「skeleton」推进到「thin」：
- 串联前置三个孤立 Feature（RPA 拨号 / 音频桥接 / 记录 API）成完整可触发闭环
- Feature `CRM 手动呼叫入口`（新建 thin）：前端按钮 + 二次确认弹窗 + 鉴权修复
- Feature `自动规则触发引擎`（新建 thin）：条件表达式扫描 + dry-run 预览 + 一键关闭
- Feature `API-Agent 派发链路`（新建 thin）：pending 轮询 + 乐观锁认领 + 子进程隔离 + machine 熔断
- Feature `通话记录展示`（新建 thin）：CRM 列表状态列 + 通话记录标签页 + ASR 转写存储
- Feature `RPA 拨号执行`（已有，补充 error_reason 分类 + call_phase 状态同步写回）
- Feature `虚拟声卡音频桥接`（已有，接线到 make_voice_call()）
- Feature `通话记录回写`（已有，扩展 schema：call_phase / machine_id / trigger_source / triggered_by / asr_transcript）
- Feature `可观测性告警`（新建 thin，复用 FEISHU_ALERT_WEBHOOK）

---

## Invariant 约束

（前置 sprint 继承 I-1 ～ I-8，本次新增 I-9 ～ I-15）

| # | 约束 | 出处 |
|---|------|------|
| I-1 | **联系人精确匹配前置**：RPA 拨号前搜索框定位 + 聊天窗口标题精确校验，不匹配立即中止 | 前置 sprint 事故驱动 |
| I-2 | **音频设备阻断启动**：Agent 启动时必须自检 WDM-KS + WASAPI 均可打开；失败 → 阻断 | 前置 sprint I-2 |
| I-3 | **60 秒超时兜底**：60s 内 VOIPDurationTextView 无 mm:ss → no_answer + safe_hangup | 前置 sprint I-3 |
| I-4 | **合规开场必须播出**：接通后第一句 `COMPLIANCE_OPENING`，不可跳过 | 前置 sprint I-4 |
| I-5 | **WebSocket 断线不静默**：最多 3 次重连 + 间隔 2s，超限 → fail_with_reason + 挂断 | 前置 sprint I-5 |
| I-6 | **禁止坐标定位联系人**：仅 UIA SendKeys 输入搜索框 | 前置 sprint I-6 |
| I-7 | **后台静默发送**：只走后台 UIA；禁前台键鼠全局注入 | c985f7e7 Line04 铁律 |
| I-8 | **程序化恢复窗口不可信**：微信窗口不得被最小化，不依赖 SW_RESTORE | 前置 sprint I-8 |
| I-9 | **防重复拨打（乐观锁）**：拨号前同步 `UPDATE … SET call_phase='dialing' WHERE call_phase='claimed'`，返回 0 行立即中止；不能用内存标记（重启丢失） | PrepPRD 判定点表 |
| I-10 | **10 分钟技术去重窗口**：同一 (tenant_id, contact_name) 在 10 分钟内只允许一条 queued/claimed/dialing 记录；重复请求返回 409 + 已有 call_id | PrepPRD 防重复拨打 |
| I-11 | **3 天业务冷却期**：同一联系人的上次通话（answered/no_answer）距今不足 3 天时，`POST /call` 返回 429 `COOLING_DOWN` | PrepPRD 防重复拨打 |
| I-12 | **machine 熔断阈值**：60 分钟窗口内同一 machine_id 连续出现 ≥5 次「认领后 30s 内失败」→ 该 machine 停止认领 + 飞书告警（仿 OverlayWatchdog 模式，参数可调） | PrepPRD 判定点表 |
| I-13 | **子进程不重复启动**：Agent 父进程重启时，若检测到同一 call_id 的子进程 PID 仍存活，禁止再 spawn 新子进程 | PrepPRD 验收标准 |
| I-14 | **dry-run 预览必须先人工确认才能切自动执行**：自动规则引擎首次激活必须通过一轮 dry-run 预览，用户显式确认后方可开启自动执行模式 | PrepPRD 自动规则 |
| I-15 | **鉴权修复必须先于 CRM 入口上线**：`POST /api/cs/voice-outreach/call` 的 `requireCsWriteAccess('wechatId')` 在无 wechatId param 情景下必然 404；本次改为 `requireCsAdminOrSuperAdmin`（已存在于 cs-config-guard.ts:107） | PrepPRD Golden Path Step 1 |

---

## 数据库 Schema 扩展

在已有 `voice_call_records` 表基础上，新增 migration（幂等 ALTER TABLE IF NOT EXISTS）：

```sql
-- Migration: 20260719_voice_call_dispatch.sql
ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS call_phase      TEXT DEFAULT 'queued'
      CHECK (call_phase IN ('queued','claimed','dialing','answered','no_answer','failed')),
  ADD COLUMN IF NOT EXISTS machine_id      TEXT,
  ADD COLUMN IF NOT EXISTS trigger_source  TEXT DEFAULT 'manual'
      CHECK (trigger_source IN ('manual','auto_rule')),
  ADD COLUMN IF NOT EXISTS triggered_by    TEXT,
  ADD COLUMN IF NOT EXISTS asr_transcript  TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dialing_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_until     TIMESTAMPTZ;

-- 防重复：同 tenant + contact 10 分钟去重索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_vcr_dedup_window
  ON voice_call_records (tenant_id, contact_name)
  WHERE call_phase IN ('queued','claimed','dialing');

-- machine 熔断查询索引
CREATE INDEX IF NOT EXISTS idx_vcr_machine_recent
  ON voice_call_records (machine_id, called_at DESC)
  WHERE machine_id IS NOT NULL;
```

---

## 新 API 端点规格

### GET /api/cs/voice-outreach/pending

Agent 轮询（1s 非阻塞），获取本 machine 可认领的任务。

**请求**：`?machine_id=<uuid>&tenant_id=<tenant_id>`（或 session 注入 tenant_id）

**响应**：
```json
{
  "success": true,
  "data": {
    "call_id": "...",
    "tenant_id": "...",
    "contact_name": "...",
    "wechat_account": "...",
    "trigger_source": "manual|auto_rule",
    "triggered_by": "user_email or null"
  } | null
}
```
- 无任务时 data=null（不阻塞，立即返回）
- 仅返回 `call_phase='queued'` 且 `(lease_until IS NULL OR lease_until < NOW())` 的第一条
- 不在此端点做认领（认领需原子 UPDATE）

### POST /api/cs/voice-outreach/claim

Agent 原子认领。乐观锁：`UPDATE … SET call_phase='claimed', machine_id=$1, claimed_at=NOW(), lease_until=NOW()+interval '10 min' WHERE call_id=$2 AND call_phase='queued'`。

**请求**：`{ call_id, machine_id, tenant_id }`

**响应**：
- 成功（rowCount=1）→ 202 `{ success: true, data: { call_id, claimed_at } }`
- 认领失败（rowCount=0，已被其他 machine 抢走）→ 409 `CLAIM_CONFLICT`

### GET /api/cs/voice-outreach/machine-circuit-status

查询某 machine 是否熔断。Agent 认领前检查。

**请求**：`?machine_id=<uuid>`

**响应**：`{ data: { machine_id, circuit_open: boolean, fast_fail_count: integer } }`

### POST /api/cs/voice-outreach/call（修改现有）

- 鉴权从 `requireCsWriteAccess('wechatId')` 改为 `requireCsAdminOrSuperAdmin`
- 新增字段：`trigger_source`（manual | auto_rule，默认 manual）、`triggered_by`（操作人邮箱）
- 新增去重校验（I-10 + I-11）：10 分钟窗口 / 3 天冷却期
- call_phase 落库初始值改为 `'queued'`（原来是直接存 `'failed'`）

### POST /api/cs/voice-outreach/records（修改现有）

- 新增字段：`asr_transcript`（TEXT，可选，ASR 全文转写）、`call_phase`（最终态）
- Agent 回写时支持 call_phase 推进到 answered/no_answer/failed

### GET /api/cs/voice-outreach/auto-rules（新建）

获取本租户的自动触发规则列表。

**响应**：`{ data: AutoRule[] }`

### PUT /api/cs/voice-outreach/auto-rules/:id（新建）

更新规则：启用/禁用、修改条件表达式、切换 dry-run/active 模式。

---

## 自动规则触发引擎规格

### 数据模型（新表 `voice_outreach_auto_rules`）

```sql
CREATE TABLE IF NOT EXISTS voice_outreach_auto_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  condition_expr  TEXT NOT NULL,  -- e.g. "status='A1' AND last_seen_at < NOW()-interval '3 days'"
  enabled         BOOLEAN DEFAULT false,
  dry_run_mode    BOOLEAN DEFAULT true,   -- I-14：首次必须 dry-run
  dry_run_confirmed_at TIMESTAMPTZ,       -- 有值 + enabled=true 才允许真执行
  scan_interval_minutes INTEGER DEFAULT 15,
  last_scanned_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 扫描逻辑（定时任务，15 分钟/次）

1. 取 `enabled=true` 的规则列表
2. 对每条规则，执行 `condition_expr` 扫描 `customers` 表（已有多租户隔离）
3. `dry_run_mode=true`：仅返回命中客户列表 + 预计拨打数量（不写 voice_call_records）
4. `dry_run_mode=false AND dry_run_confirmed_at IS NOT NULL`：每个命中客户调用 `POST /call`（trigger_source='auto_rule'），经过 I-10/I-11 过滤自动去重
5. 记录本次扫描时间到 `last_scanned_at`

---

## Golden Path（六步串联，对应 PrepPRD）

```
Step 1  [CRM 前端 + 鉴权修复]
  客服（owner/admin）在 CRM 客户详情页点「呼叫该客户」→
  二次确认弹窗（展示上次通话状态 / 时间）→ 确认后 POST /api/cs/voice-outreach/call
  ← API 返回 { call_id, status:'queued', queued_at }

  OR：自动规则引擎 15 分钟扫描命中 → dry-run 预览确认后 POST /call（trigger_source='auto_rule'）

Step 2  [API-Agent 派发链路 - 轮询 + 乐观锁认领]
  listen_chat.py 主循环（1s 非阻塞轮询）GET /pending?machine_id=<id>
  → 有任务 → 检查 machine 熔断状态 → POST /claim（乐观锁，返回 0 行则跳过）
  → 认领成功 → spawn 独立子进程（call_worker.py）执行 RPA
  → 子进程 PID 写内存映射（防 I-13 重复 spawn）

Step 3  [RPA 拨号 - call_phase 状态同步]
  call_worker.py 子进程：
  a. 拨号前同步 UPDATE call_phase='dialing'（I-9：返回 0 行 → 中止）
  b. locate_contact() + initiate_voice_call()（I-1/I-6）
  c. wait_for_answer(60s)（I-3）

Step 4  [AI 对话真接线]
  接通 → make_voice_call() 真正调用 start_audio_bridge()（之前未接线的空洞补齐）
  → 合规开场白（I-4）→ 双向音频循环 → WebSocket 断线重连（I-5）

Step 5  [通话记录回写 + ASR 转写]
  通话结束（VOIP 窗口消失）→ call_worker.py 解析气泡文字
  → POST /api/cs/voice-outreach/records { call_id, status, duration_seconds, asr_transcript }
  3 次指数退避重试（1s/2s/4s）
  → API 更新 call_phase 到最终态

Step 6  [CRM 展示]
  CRM 客户列表新增「上次通话」状态列
  CRM 客户详情页新增「通话记录」标签页（历史列表 + 点展开 → ASR 全文转写）
```

---

## 文件清单（需新建 / 修改）

### API 层（Node.js TypeScript）

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/api/src/routes/voice-outreach.ts` | 修改 | 鉴权修复 + 新端点 pending/claim/machine-circuit-status + auto-rules CRUD + 去重校验（I-10/I-11）+ 扩展字段 |
| `apps/api/src/routes/voice-outreach.test.ts` | 修改 | 补充并发认领/去重/冷却期/熔断单元测试 |
| `apps/api/db/migrations/20260719_voice_call_dispatch.sql` | 新建 | schema 扩展（call_phase / machine_id / trigger_source / asr_transcript 等） |
| `apps/api/db/migrations/20260719_voice_outreach_auto_rules.sql` | 新建 | voice_outreach_auto_rules 表 |
| `apps/api/src/services/voice-outreach-rule-engine.ts` | 新建 | 自动规则扫描定时任务（thin，条件 SQL + dry-run 分支） |

### Agent 层（Python）

| 文件 | 操作 | 说明 |
|------|------|------|
| `services/agent/wechat-rpa/voice_call/call_worker.py` | 新建 | 子进程入口：RPA + audio_bridge 串联 + 3 次退避回写 |
| `services/agent/wechat-rpa/voice_call/dispatch_loop.py` | 新建 | Agent 轮询派发逻辑（GET pending → POST claim → spawn call_worker） |
| `services/agent/wechat-rpa/voice_call/machine_circuit.py` | 新建 | machine 熔断计数器（仿 OverlayWatchdog，I-12） |
| `services/agent/wechat-rpa/voice_call/call_rpa.py` | 修改 | 补充 error_reason 枚举分类（contact_mismatch / no_answer / rpa_error / device_error / ai_dropped）+ call_phase 同步写 UPDATE（I-9） |
| `services/agent/wechat-rpa/voice_call/audio_bridge.py` | 修改 | 接线到 call_worker.py 的 make_voice_call() 调用入口（补齐之前未接线的空洞） |
| `services/agent/wechat-rpa/listen_chat.py` | 修改 | 主循环集成 dispatch_loop.poll_once()（1s 非阻塞，不阻塞现有私信监听） |
| `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` | 新建 | dispatch 单元测试（状态机转换 / 去重窗口计算 / lease 回收 / 熔断逻辑）|

### Dashboard 层（React TypeScript）

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/dashboard/src/pages/CustomerListPage.tsx` | 修改 | 新增「上次通话」状态列（thin：展示状态 + 时间 + 时长） |
| `apps/dashboard/src/pages/CustomerDetailPage.tsx` | 新建/修改 | 客户详情页：「呼叫该客户」按钮 + 二次确认弹窗 + 通话记录标签页（历史列表 + ASR 转写展开） |
| `apps/dashboard/src/api/voice-outreach.api.ts` | 新建 | API 调用封装（triggerCall / listRecords / listAutoRules / updateAutoRule） |
| `apps/dashboard/e2e/voice-outreach-crm.spec.ts` | 新建 | Playwright E2E：按钮 → 弹窗 → 确认 → API mock 验证 queued 状态展示 |

### Smoke / CI

| 文件 | 操作 | 说明 |
|------|------|------|
| `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` | 修改 | 新增 GP-A 段：POST /call → GET /pending → 模拟 POST /claim → POST /records → GET /records 验证 |

---

## 累积 FR（GP-A 全部已落地/本次新增 Features）

| 状态 | Feature | 厚度 |
|------|---------|------|
| ✅ 前置复用 | 智能客服绑定/安装（qr_bind.py / preflight.py） | mvp |
| ✅ 前置复用 | 豆包 Realtime WebSocket 协议（doubao-protocol.js，PR #1361/#1366） | medium |
| ✅ 前置复用 | 国内语音管线服务端中继（/ws/domestic，PR #1368） | thin |
| ✅ 前置 sprint | RPA 拨号执行（call_rpa.py，PR #1397） | thin |
| ✅ 前置 sprint | 虚拟声卡音频桥接（audio_bridge.py，PR #1397） | thin |
| ✅ 前置 sprint | 通话记录回写基础 API（voice-outreach.ts + migration，PR #1397） | thin |
| 🔄 本次 | **CRM 手动呼叫入口**（前端按钮 + 鉴权修复） | planned → thin |
| 🔄 本次 | **自动规则触发引擎**（条件扫描 + dry-run + 一键关闭） | planned → thin |
| 🔄 本次 | **API-Agent 派发链路**（pending 轮询 + 乐观锁认领 + 子进程隔离 + machine 熔断） | planned → thin |
| 🔄 本次 | **通话记录展示**（CRM 列状态列 + 通话记录标签页 + ASR 转写存储） | planned → thin |
| 🔄 本次 | **RPA 拨号执行**（error_reason 分类 + call_phase 状态同步写回补齐） | thin（补丁） |
| 🔄 本次 | **虚拟声卡音频桥接**（接线到 make_voice_call()） | thin（接线） |
| 🔄 本次 | **通话记录回写**（schema 扩展：call_phase / machine_id / trigger_source / asr_transcript） | thin（扩展） |
| 🔄 本次 | **可观测性告警**（6 项 metrics + 飞书 FEISHU_ALERT_WEBHOOK） | planned → thin |

---

## NFR

### 可观测性（6 项指标 + 飞书告警）

| 指标 | 采集方式 | 告警条件 |
|------|---------|---------|
| 任务积压数（queued 且 lease 未过期超 5 分钟）| DB 查询（定时） | > 10 条 → 飞书告警 |
| 认领成功率（claim 成功 / pending 返回任务数）| API 埋点日志 | < 50% → 飞书告警 |
| 接通率（answered / (answered+no_answer)）| DB 统计 | < 20% → 飞书告警（可能对方群体不接陌生号） |
| machine 熔断事件 | machine_circuit.py 触发时推飞书 | 每次熔断即告警 |
| AI 对话建立失败率（ai_dropped / 接通数）| DB 统计 | > 30% → 飞书告警（豆包连通性问题） |
| ASR 回写延迟（records 写入时间 - called_at）| DB 计算 | p95 > 30s → 飞书告警 |

飞书告警复用现有 `FEISHU_ALERT_WEBHOOK` 环境变量（env-registry.ts:68 已注册）。

---

## 验收标准（Final E2E）

### E2E 分层

| 场景 | 验证层 | 存放位置 |
|------|--------|---------|
| API 状态机转换（queued→claimed→dialing→answered/no_answer/failed）| vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` |
| 并发认领（两个 machine 同时 POST /claim）只有一条推进到 dialing | vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` |
| 10 分钟去重窗口计算 / 3 天冷却期计算 | vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` |
| machine 熔断逻辑（5 次快速失败 → circuit_open=true）| pytest 单元测试 | `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` |
| dispatch_loop 轮询 + 子进程不重复 spawn | pytest 单元测试 | `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` |
| lease 超时回收（lease_until 过期后 pending 可重新认领）| vitest 单元测试 | `apps/api/src/routes/voice-outreach.test.ts` |
| CRM 呼叫按钮 → 弹窗 → 确认 → queued 状态展示 | Playwright E2E | `apps/dashboard/e2e/voice-outreach-crm.spec.ts` |
| 完整拨打链路（真机：接通 / no_answer / ASR 回写）| smoke.sh 真机段等价断言 | `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` |

### CI 硬门槛

- `apps/api/src/routes/voice-outreach.test.ts` 全绿
- `services/agent/wechat-rpa/voice_call/tests/test_dispatch.py` 全绿
- `apps/dashboard/e2e/voice-outreach-crm.spec.ts` 全绿（windows_cloud runner）
- `golden-path-4-smoke.sh` API 层等价断言全绿（真机段标注 TODO 真机验证）

---

## 不包含（本次边界）

- AI 对话接通后中途掉线的完整监听检测机制（另立 sprint）
- 平台级并发限流工程（先用延迟埋点日志攒数据）
- lease 预算的真机实测标定
- 多台机器绑定同一微信号时的选择规则
- 声学回声消除（AEC）、声音克隆/音色定制
- 通话录音文件存储（本次只存 ASR 文本，不存音频文件）

---

## 5 问对齐

1. **Journey**：智能客服 · GP-A 主动语音触达（55d26529），Maturity: skeleton → thin
2. **角色**：中台 API / Dashboard 前端 / Windows Agent（listen_chat.py + call_worker.py）——三个系统组件，不涉及多设备类型分歧
3. **涉及 Feature**：8 个（见累积 FR 表），均标注 thickness from→to
4. **Feature 0 端到端 smoke**：golden-path-4-smoke.sh API 层段全绿 = 整 sprint 通过门槛
5. **设备类型**：仅 Windows（xian-rog）真机执行 RPA；Dashboard 操作界面 windows_cloud Playwright 验证；两者均为单一操作系统，无跨平台分歧
