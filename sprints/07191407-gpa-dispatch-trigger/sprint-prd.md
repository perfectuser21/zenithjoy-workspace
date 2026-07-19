# Sprint PRD：GP-A 主动语音触达 — 补齐触发入口与派发链路

## 元数据

| 字段 | 值 |
|------|-----|
| task_id | 2ac0e77b-c2e3-47e9-92dd-7549622835d7 |
| sprint_dir | sprints/07191407-gpa-dispatch-trigger |
| journey | 智能客服 · GP-A 主动语音触达（ID: 55d26529-2274-4c30-85fe-168edcef4d76） |
| journey_type | user_facing |
| target_environment | windows_wechat |
| maturity | not_started → thin（全链路可用但尚未真机压测） |

## 本 Sprint 推进声明

本 PR 把 GP-A 主动语音触达 从「skeleton」（PR #1397 三个孤立 Feature 已验证）推进到「thin」（完整可用 Golden Path）：

- **Feature `CRM手动呼叫入口`**（新建 thin）：客户详情页呼叫按钮 + 二次确认弹窗 + 鉴权修复
- **Feature `自动规则触发引擎`**（新建 thin）：条件表达式扫描 + dry-run 预览 + 一键关闭
- **Feature `API-Agent派发链路`**（新建 thin）：pending 轮询接口 + 乐观锁认领 + 子进程隔离 + 锁文件防重启并发 + machine 级熔断
- **Feature `防重复拨打`**（新建 thin）：call_phase='dialing' 同步 UPDATE 返回 0 行即中止
- **Feature `AI对话真接线`**（新建 thin）：make_voice_call() → start_audio_bridge() 接线
- **Feature `通话记录展示`**（新建 thin）：CRM列表状态列 + 通话记录标签页 + ASR转写全文
- **Feature `去重机制`**（新建 thin）：10分钟技术窗口 + 3天业务冷却期
- **Feature `可观测性告警`**（新建 thin）：6项指标 + 复用 FEISHU_ALERT_WEBHOOK

---

## 前置条件（已合并 PR #1397 的骨架）

| 状态 | Feature | 文件 | 厚度 |
|------|---------|------|------|
| ✅ 已有 | RPA拨号执行（locate_contact / wait_for_answer / make_voice_call） | `voice_call/call_rpa.py` | thin |
| ✅ 已有 | 虚拟声卡音频桥接（start_audio_bridge / 设备自检 I-2） | `voice_call/audio_bridge.py` | thin |
| ✅ 已有 | 通话记录回写 API（POST /records + GET /records） | `apps/api/src/routes/voice-outreach.ts` | thin |
| ✅ 已有 | voice_call_records 表（id/tenant_id/contact_name/status/duration_seconds） | `apps/api/db/migrations/20260718_voice_call_records.sql` | thin |
| ✅ 已有 | GP-A smoke CI段（文件结构 + python 单元测试） | `.github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh` | thin |

---

## Invariant 约束（累积，上游 sprint 全部继承）

| # | 约束 | 出处 |
|---|------|------|
| I-1 | **联系人精确匹配前置**：RPA 拨号前必须搜索框定位，聊天窗口标题与目标名不精确匹配时立即中止，绝不静默继续 | 真实事故驱动（坐标法漂移打错人） |
| I-2 | **音频设备阻断启动**：Agent 启动时自检 WDM-KS 输出 + WASAPI 输入均可打开，任一失败立即红日志阻断 | PrepPRD 失败路径 3.1 |
| I-3 | **60 秒超时兜底**：拨号后 60 秒内 VOIP 窗口未出现 mm:ss 计时器 → 判定 no_answer 终态，安全清理 | PrepPRD 失败路径 2.1 |
| I-4 | **合规开场必须播出**：接通后第一条音频输出必须是合规告知，不可跳过或延后 | 《人工智能拟人化互动服务管理暂行办法》第十八条 |
| I-5 | **WebSocket 断线不静默**：豆包 Realtime API 断线 → 断线重连（上限 3 次 × 2s）或明确失败通知，禁止静默丢弃 | PrepPRD 失败路径 3.2 |
| I-6 | **禁止坐标点击定位联系人**：联系人列表坐标在微信重启后漂移，禁止用坐标定位（通话按钮相对坐标可用） | 真实事故驱动 |
| I-7 | **[Line04] 后台静默发送**：只走后台 UIA，禁前台键鼠全局注入 | c985f7e7 |
| I-8 | **程序化恢复窗口后不可信**：RPA 流程设计避免微信窗口被最小化，不指望 ShowWindow(SW_RESTORE) | handoff 202607180920 §5 |
| I-9 | **call_phase 原子推进**：call_phase='dialing' 必须通过 UPDATE ... WHERE call_phase='claimed' AND ... RETURNING 来原子确认，返回 0 行立即中止不执行拨号（防重复拨打核心机制） | PrepPRD 判定点 |
| I-10 | **子进程与父进程 1:1 绑定**：每个 call_id 在本机最多启动一个 RPA 子进程，用本地锁文件（/tmp/gpa-{call_id}.lock）防止 Agent 重启后产生第二个子进程 | PrepPRD 失败路径（Agent重启测试）|
| I-11 | **machine 熔断阈值**：60分钟窗口内连续 N（初始=5）次「认领后 <30s 秒级失败」→ 触发熔断，停止认领并飞书告警；agent 重启复位（仿 OverlayWatchdog 模式） | PrepPRD 判定点 ⚠️ |
| I-12 | **去重双层保护**：10分钟技术窗口（同一 tenant_id+contact_name+wechat_account 的 call_phase 非 completed/no_answer/failed 记录存在 → 拒绝新建）+ 3天业务冷却期（no_answer 终态后 3 天内自动规则不触发） | PrepPRD 防重复规格 |
| I-13 | **DB 故障降级**：pending 接口 DB 故障时返回 200 空列表而非 500，保持 Agent 轮询不中断 | PrepPRD Golden Path Step 2 |
| I-14 | **干预授权**：CRM 手动触发入口鉴权改为 requireCsAdminOrSuperAdmin，不再用 requireCsWriteAccess('wechatId')（修复 :wechatId 参数缺失导致 404 死链） | PrepPRD Step 1 |

---

## 累积 FR（GP-A 已落地 + 本次新增）

| 状态 | Feature | 厚度 |
|------|---------|------|
| ✅ 前置 | 智能客服绑定/安装（qr_bind.py / preflight.py） | mvp |
| ✅ 前置 | 豆包 Realtime Dialogue WebSocket 协议（doubao-protocol.js，PR #1361/#1366） | medium |
| ✅ 前置 | 国内语音管线服务端中继（/ws/domestic，server.js，PR #1368） | thin |
| ✅ 已有 | RPA拨号执行（搜索定位+标题校验+拨号+接通判定+超时挂断） | thin |
| ✅ 已有 | 虚拟声卡音频桥接（WDM-KS 写入 + WASAPI 读取 + 自检） | thin |
| ✅ 已有 | 通话记录回写（时长/接通状态 → 中台 API） | thin |
| 🔄 本次 | **CRM手动呼叫入口**（客户详情页按钮 + 二次确认弹窗 + 鉴权修复） | planned → thin |
| 🔄 本次 | **自动规则触发引擎**（条件表达式 + dry-run 预览 + 15分钟定时 + 一键关闭） | planned → thin |
| 🔄 本次 | **API-Agent派发链路**（GET /pending + 乐观锁认领 + 子进程隔离 + 锁文件 + machine熔断） | planned → thin |
| 🔄 本次 | **防重复拨打**（call_phase 字段 + dialing 原子 UPDATE 0行中止） | planned → thin |
| 🔄 本次 | **AI对话真接线**（make_voice_call() → start_audio_bridge() 接线） | planned → thin |
| 🔄 本次 | **通话记录展示**（CRM列表通话列 + 通话记录标签页 + ASR转写存储） | planned → thin |
| 🔄 本次 | **去重机制**（10分钟技术窗口 + 3天业务冷却期） | planned → thin |
| 🔄 本次 | **可观测性告警**（6指标 + FEISHU_ALERT_WEBHOOK） | planned → thin |

---

## Golden Path（完整线性步骤序列）

```
1. 触发层（双入口，统一出口）
   a) 手动：客服人员（owner/admin）在 CustomerProfilePage 点「呼叫该客户」
      → 弹二次确认弹窗（展示联系人名 + 上次通话结果/状态）
      → 确认 → POST /api/cs/voice-outreach/call
         { tenant_id, contact_name, wechat_account, trigger_source:'manual', triggered_by: user_id }
      鉴权：requireCsAdminOrSuperAdmin（修复旧 requireCsWriteAccess('wechatId') 的 404 死链 I-14）

   b) 自动：OutreachRuleEngine（Node.js 定时，每 15 分钟一轮）
      扫描 voice_outreach_rules 表 → 对每条 enabled=true 规则：
        执行条件表达式（初始值：status='A1' AND last_seen_at < NOW()-interval '3 days'）
        → 命中的 customers 逐一检查去重（I-12 双层）
        → dry-run=true 时：发飞书通知「今日将外呼 N 人」，不写 call 记录
        → dry-run=false（租户已确认）时：统一调用 POST /api/cs/voice-outreach/call
         { trigger_source:'auto_rule', rule_id, triggered_by:'system' }
      租户可随时通过 PUT /api/cs/voice-outreach/rules/:id { enabled: false } 一键关闭

2. call 入库 + 去重校验（I-12）
   POST /api/cs/voice-outreach/call handler：
   → 检查 10 分钟技术窗口：
     SELECT count(*) FROM voice_call_records
       WHERE tenant_id=$1 AND contact_name=$2 AND wechat_account=$3
         AND call_phase NOT IN ('completed','no_answer','failed')
         AND called_at > NOW()-interval '10 min'
     → count > 0 → 返回 409 DUPLICATE_CALL
   → 写入 voice_call_records：
     call_phase='queued', status=NULL（I-9 设计：status 只存终态）
     trigger_source, triggered_by, machine_id=NULL（Agent 认领时回填）
   → 返回 202 { call_id, status:'queued', queued_at }

3. Agent 轮询认领（listen_chat.py 主循环，1s 非阻塞 poll）
   GET /api/cs/voice-outreach/pending?machine_id=<id>&limit=1
   → 响应：[] 或 [{ call_id, contact_name, wechat_account, tenant_id }]
   → DB 故障 → 返回 200 空列表（I-13 降级）
   
   认领（乐观锁）：
   UPDATE voice_call_records
     SET call_phase='claimed', machine_id=$1, claimed_at=NOW()
   WHERE id=$2 AND call_phase='queued'
   RETURNING id
   → 返回 0 行 → 跳过（另一 Agent 或子进程已认领）
   → 返回 1 行 → 认领成功

   本地锁文件检查（I-10）：
   → 检查 /tmp/gpa-{call_id}.lock 是否存在且 PID 还在 → 存在且活跃 → 跳过（防重启并发）
   → 不存在 → 写入锁文件 → spawn 独立子进程

4. 子进程执行 RPA 拨号
   进入子进程后第一步：同步推进 call_phase
   UPDATE voice_call_records
     SET call_phase='dialing', dialing_at=NOW()
   WHERE id=$1 AND call_phase='claimed' AND machine_id=$2
   RETURNING id
   → 返回 0 行 → 立即退出子进程，不执行拨号（I-9 防重复拨打核心）
   → 返回 1 行 → 继续

   执行 call_rpa.locate_contact(contact_name)
   → contact_mismatch → UPDATE call_phase='failed', status='failed', error_reason='contact_mismatch'
   → ok → 继续

   执行 call_rpa.trigger_voice_call(chat_win)
   → 调用前将 call_phase 推为 'in_call'：
     UPDATE voice_call_records SET call_phase='in_call', answered_at=NOW()
     WHERE id=$1 AND call_phase='dialing' RETURNING id
   → 返回 0 行 → 中止（极罕见：父进程重启并发写入）

5. 接通后 AI 对话真接线（I-4 合规开场）
   call_rpa.wait_for_answer(timeout=60):
   → 60s 内未接通 → UPDATE call_phase='completed', status='no_answer'
                   → 记录 3 天冷却起点（I-12）
   → 接通 → make_voice_call() 内调用 start_audio_bridge()：
     · 播出合规开场白（"您好，我是徐先生企业自媒体的智能语音助手"）（I-4）
     · 建立豆包 Realtime WebSocket 连接（/ws/domestic）
     · 启动双向音频循环（WDM-KS 写/WASAPI 读）
     · 持续采集 ASR 识别文字 → 追加至 asr_buffer（用于通话结束后写 transcript）

6. 通话结束 + 回写
   call_rpa.wait_for_hangup(app, chat_win):
   → VOIP 窗口消失 → 停止音频桥接 + 关闭 WebSocket
   → 读聊天气泡最后一条判定终态（bubble_text）
   → 3 次指数退避 POST /api/cs/voice-outreach/records：
     { call_id, status, duration_seconds, trigger_source, triggered_by,
       machine_id, transcript: asr_buffer.join('\n'), bubble_text }
   → 耗尽 3 次 → 本地落盘（/tmp/gpa-failed-records.jsonl）等待重放
   → UPDATE call_phase='completed', status=终态

   清理：删除 /tmp/gpa-{call_id}.lock

7. 通话记录可见（CRM 展示）
   CustomerListPage：新增「最近通话」列（answered/no_answer/failed 徽章）
   CustomerProfilePage：新增「通话记录」标签页
     → GET /api/cs/voice-outreach/records?tenant_id=xxx&contact_name=xxx
     → 展示：时间 / 时长 / 接通状态 / 触发方式 / ASR 转写全文（可折叠）
```

---

## Schema 扩展（voice_call_records 表变更）

```sql
-- Migration: 20260719_voice_call_records_v2.sql
-- 在已有表上幂等添加新字段（ALTER TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS）

ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS call_phase TEXT
    CHECK (call_phase IN ('queued','claimed','dialing','in_call','completed'))
    DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS trigger_source TEXT,       -- 'manual' | 'auto_rule'
  ADD COLUMN IF NOT EXISTS triggered_by TEXT,         -- user_id or 'system'
  ADD COLUMN IF NOT EXISTS machine_id TEXT,
  ADD COLUMN IF NOT EXISTS transcript TEXT,           -- ASR 转写全文（换行分隔）
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dialing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ;

-- status 约束放宽为允许 NULL（中间态）+ 新增 ai_dropped 终态
-- 先删旧 CHECK 再建新（幂等：如果已经是新约束就不报错）
ALTER TABLE voice_call_records
  DROP CONSTRAINT IF EXISTS voice_call_records_status_check;
ALTER TABLE voice_call_records
  ADD CONSTRAINT voice_call_records_status_check
    CHECK (status IN ('answered','no_answer','failed','ai_dropped') OR status IS NULL);

-- call_phase 索引（pending 轮询用）
CREATE INDEX IF NOT EXISTS idx_voice_call_records_phase
  ON voice_call_records (call_phase, called_at ASC)
  WHERE call_phase = 'queued';

-- 去重查询索引（10分钟技术窗口）
CREATE INDEX IF NOT EXISTS idx_voice_call_records_dedup
  ON voice_call_records (tenant_id, contact_name, wechat_account, called_at DESC)
  WHERE call_phase NOT IN ('completed','no_answer','failed');
```

```sql
-- 自动规则表（新建）
CREATE TABLE IF NOT EXISTS voice_outreach_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  condition_expr  TEXT NOT NULL,   -- SQL-subset 条件，初始 "status='A1' AND ..."
  dry_run         BOOLEAN NOT NULL DEFAULT true,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  cooldown_days   INTEGER NOT NULL DEFAULT 3,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voice_outreach_rules_tenant
  ON voice_outreach_rules (tenant_id) WHERE enabled = true;
```

---

## Response Schema（新增接口）

```typescript
// GET /api/cs/voice-outreach/pending?machine_id=<id>&limit=1
// 鉴权：requireCsAdminOrSuperAdmin（Agent 服务账号走 legacy service credential）
interface PendingCallTask {
  id: string;           // voice_call_records.id（用于乐观锁 UPDATE）
  call_id: string;
  tenant_id: string;
  contact_name: string;
  wechat_account: string | null;
  trigger_source: 'manual' | 'auto_rule';
  triggered_by: string;
  queued_at: string;   // called_at ISO8601
}
// 200 { success: true, data: PendingCallTask[] }
// DB故障降级 → 200 { success: true, data: [] }（I-13）

// POST /api/cs/voice-outreach/call（鉴权改为 requireCsAdminOrSuperAdmin，修复 I-14）
interface VoiceCallRequest {
  tenant_id: string;
  contact_name: string;
  wechat_account?: string;
  trigger_source?: 'manual' | 'auto_rule';
  triggered_by?: string;
  rule_id?: string;
}
// 409 DUPLICATE_CALL（10分钟技术窗口命中）

// POST /api/cs/voice-outreach/records（扩展回写字段）
interface VoiceCallRecordWriteBody {
  call_id: string;
  tenant_id: string;
  contact_name: string;
  status: 'answered' | 'no_answer' | 'failed' | 'ai_dropped';
  duration_seconds: number;
  trigger_source?: string;
  triggered_by?: string;
  machine_id?: string;
  transcript?: string;
  bubble_text?: string;
  error_reason?: string;
}

// GET /api/cs/voice-outreach/rules — 列出本租户规则
// POST /api/cs/voice-outreach/rules — 创建规则
// PUT /api/cs/voice-outreach/rules/:id — 更新规则（含 enabled 一键关闭）
interface VoiceOutreachRule {
  id: string;
  tenant_id: string;
  name: string;
  condition_expr: string;
  dry_run: boolean;
  enabled: boolean;
  cooldown_days: number;
}
```

---

## 代码变更地图

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `apps/api/db/migrations/20260719_voice_call_records_v2.sql` | 新增 | call_phase/trigger_source/triggered_by/machine_id/transcript 字段；status 约束放宽 NULL+ai_dropped；voice_outreach_rules 表 |
| `apps/api/src/routes/voice-outreach.ts` | 修改 | ① POST /call 鉴权改 requireCsAdminOrSuperAdmin（I-14）② 加 10min 去重校验（I-12）③ call_phase='queued' 初始化 ④ 新增 GET /pending 端点（乐观锁认领用）⑤ POST /records 扩展 machine_id/transcript/trigger_source/triggered_by ⑥ CRUD /rules 端点 |
| `apps/api/src/routes/voice-outreach.test.ts` | 修改 | 补测 GET /pending（返回 queued 记录）、POST /call 去重409、鉴权变更 |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/dispatcher.py` | 新增 | VoiceOutreachDispatcher：轮询 GET /pending → 乐观锁认领 → 锁文件创建 → spawn 子进程；machine 熔断（OverlayWatchdog 模式，窗口60min N=5次<30s快失败→熔断+飞书告警） |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/worker.py` | 新增 | 子进程入口：call_phase 推进 dialing 原子 UPDATE（I-9）→ make_voice_call() → start_audio_bridge() 接线 → 3次指数退避回写 /records → 本地落盘兜底 → 锁文件清理（I-10） |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py` | 修改 | ① make_voice_call() 内注入 start_audio_bridge() 调用（接通后立即调用，asr_buffer 参数传出）② error_reason 补充分类字段（contact_mismatch / dial_failed / timeout） |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/audio_bridge.py` | 修改 | start_audio_bridge() 新增 asr_callback 参数，将 ASR 识别片段实时 append 到调用方提供的 list（worker.py 收集后写 transcript） |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/rule_engine.py` | 新增 | OutreachRuleEngine：每 15 分钟扫描 voice_outreach_rules → 条件表达式求值（白名单 SQL-subset）→ 去重（I-12）→ dry-run 飞书通知 / 真实调 POST /call |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_dispatcher.py` | 新增 | dispatcher 单元测试：乐观锁 UPDATE 返回0行跳过 / 锁文件已存在跳过 / 熔断阈值N次快失败触发 / DB故障空列表降级 |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_worker.py` | 新增 | worker 单元测试：dialing UPDATE 0行立即中止（不调 make_voice_call）/ contact_mismatch 路径 / 指数退避重试 / 本地落盘兜底 |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_rule_engine.py` | 新增 | rule_engine 单元测试：dry-run 飞书通知（不写call）/ 3天冷却期命中跳过 / 10min去重命中跳过 / enabled=false 不执行 |
| `apps/dashboard/src/pages/CustomerProfilePage.tsx` | 修改 | 新增「通话记录」标签页（VoiceCallRecordsTab）：GET /records 拉取 → 列表展示（时间/时长/状态/触发方式/转写全文折叠）；新增「呼叫」按钮 + 二次确认弹窗（上次通话结果展示） |
| `apps/dashboard/src/pages/CustomerListPage.tsx` | 修改 | AG Grid 新增「最近通话」列（answered=✅/no_answer=📵/failed=⚠️/null=—），数据来自已有 customer row 关联查询（扩展 GET /api/crm/customers 响应或独立 join） |
| `.github/workflows/scripts/smoke/gpa-dispatch-trigger-smoke.sh` | 新增 | 本次 sprint 的 smoke：① GET /pending 接口可达+DB字段断言 ② POST /call 去重409断言 ③ call_phase 字段 schema 断言 ④ voice_outreach_rules 表存在断言 ⑤ Python dispatcher/worker/rule_engine 单元测试 ⑥ 真机段等价断言注释 |
| `.github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh` | 修改 | 回流本次真机bug修复判据（call_phase推进逻辑）+ 更新引用新migration文件 |

---

## 可观测性（6 项指标 + 飞书告警）

| 指标 | 收集方式 | 告警阈值 |
|------|---------|---------|
| `gpa.call.queued` | POST /call 写库成功时 +1 | — |
| `gpa.call.answered` | status='answered' 回写时 +1 | — |
| `gpa.call.no_answer_rate` | no_answer / (answered+no_answer) | >60% 时飞书告警 |
| `gpa.call.fast_fail_count` | <30s 秒级失败次数（熔断计数） | =N（5次）时飞书告警 + 停止认领 |
| `gpa.call.circuit_open` | 熔断状态 | =1 时飞书每小时重复告警 |
| `gpa.call.transcript_missing` | status=answered 但 transcript 为空 | >20% 时飞书告警 |

飞书告警复用现有 `FEISHU_ALERT_WEBHOOK` 环境变量（crm.ts 模式复用）。

---

## 开发顺序（E2E-First 强制）

```
commit-1: E2E smoke（gpa-dispatch-trigger-smoke.sh）——定义完成标准
commit-2: DB migration（voice_call_records_v2 + voice_outreach_rules）
commit-3: API 新端点（GET /pending、/rules CRUD、POST /call 去重 + 鉴权修复）
commit-4: API 单元测试（voice-outreach.test.ts 扩展）
commit-5: Python dispatcher.py + 单元测试
commit-6: Python worker.py（接线 make_voice_call→start_audio_bridge）+ 单元测试
commit-7: Python rule_engine.py + 单元测试
commit-8: Dashboard CustomerProfilePage 通话记录标签页 + 呼叫按钮
commit-9: Dashboard CustomerListPage 最近通话列
commit-10: 回流 gpa-voice-outreach-smoke.sh（真机判据）
```

---

## 边界情况

- 3 天冷却期计算：以最近一条 status='no_answer' 的 called_at 为起点，rule_engine 在 SELECT 时 filter（不修改 DB 状态）
- dry-run 预览：PreviewRound 仅写飞书通知，不写 voice_call_records；连续 3 次 dry-run 结果稳定（±0人）后允许切换 dry_run=false
- ASR 转写存储：transcript 字段 TEXT 类型，无长度限制；通话超过 10 分钟时仅保留最后 5000 字符（防 DB 大字段）
- ai_dropped 终态范围：仅覆盖「连接建立阶段 WebSocket 永久失败（3次重连耗尽）」，通话中途掉线另立 sprint
- lease/子进程清理：子进程正常/异常退出时均触发 finally 块删除锁文件；父进程（dispatcher）检测子进程 PID 时若 stale 锁文件（PID 不存在）自动清理

---

## 假设

- [ASSUMPTION: voice_outreach_rules 的条件表达式 `status='A1' AND last_seen_at < NOW()-interval '3 days'` 是合法的白名单 SQL 片段，由 rule_engine 拼入 `SELECT id,contact_name FROM customers WHERE tenant_id=$1 AND (${condition_expr})` 查询]
- [ASSUMPTION: 自动规则引擎跑在 listen_chat.py 同一进程（Python，xian-rog），通过独立线程或协程每 15 分钟执行一次，不依赖外部 cron]
- [ASSUMPTION: machine 熔断快失败阈值 N=5、窗口 60min、快失败判定 <30s，待真机压测后可调，本 sprint 固化初始值]
- [ASSUMPTION: ASR 转写由 audio_bridge.py 从豆包 Realtime API 的文字回传中收集，无需额外 ASR 服务]

---

## NFR（非功能要求）

| # | 要求 | 指标 |
|---|------|------|
| N-1 | **轮询非阻塞**：GET /pending 轮询间隔 1s，每次查询 DB 时间 < 200ms（PG index scan），不阻塞 listen_chat 主循环其他 handler | idx_voice_call_records_phase 索引保证 |
| N-2 | **乐观锁冲突静默**：UPDATE 返回 0 行时不写日志（INFO 级以上），仅计 DEBUG 计数，防日志噪声 | dispatcher.py 实现约束 |
| N-3 | **多租户隔离**：所有 DB 写入带 tenant_id，API 路由通过 requireCsAdminOrSuperAdmin 闸 | 复用 crm.ts 模式 |
| N-4 | **幂等 Migration**：ALTER TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS，可重复运行 | DDL 幂等 |
| N-5 | **本地落盘重放**：3次退避耗尽后落盘 /tmp/gpa-failed-records.jsonl，不丢数据；agent 启动时自动扫描重放 | worker.py 实现 |
| N-6 | **合规开场不可跳过**（继承 N-6）：audio_bridge.py 合规告知 TTS 串行排在 ASR 监听之前完整播出 | I-4 实现 |
| N-7 | **子进程隔离**：RPA 子进程崩溃（exception/SIGKILL）不影响 listen_chat 主循环，父进程用 subprocess.Popen 非阻塞模式监控 | I-10 实现 |
| N-8 | **Dry-run 无副作用**：dry_run=true 的 rule_engine 轮次不写任何 voice_call_records 行，只发飞书通知（包含命中联系人列表摘要） | rule_engine.py 约束 |

---

## 验收标准（Final E2E）

CI 可达（smoke + 单元测试）：

- [ ] `gpa-dispatch-trigger-smoke.sh` 全绿：
  - GET /pending 返回 queued 列表且含 call_phase 字段
  - POST /call 重复请求（10min内）返回 409 DUPLICATE_CALL
  - voice_outreach_rules 表存在且含 condition_expr / dry_run / cooldown_days 字段
  - Python test_dispatcher.py（乐观锁0行跳过、锁文件跳过、熔断阈值、DB空列表降级）
  - Python test_worker.py（dialing UPDATE 0行中止、contact_mismatch路径、指数退避、落盘兜底）
  - Python test_rule_engine.py（dry-run 飞书通知、3天冷却命中跳过、10min去重跳过）
- [ ] voice-outreach.test.ts vitest 全绿（GET /pending、POST /call 去重409、鉴权变更）

真机 E2E（CI 不可达，需在 xian-rog 手动运行，每项需截图/日志存档）：

- [ ] 通过 `POST /call` 能触发 Agent 真正认领并执行拨号（call_phase 从 queued→claimed→dialing 可在 DB 观察）
- [ ] 完整走一次真实拨打（联系人：默忆或小胡同学）：
  - 接通判定正确（call_phase=in_answer→completed, status=answered）
  - AI 开场合规告知播出（对方反馈听到"您好，我是徐先生企业自媒体的智能语音助手"）
  - make_voice_call() → start_audio_bridge() 接线正常（ASR 实时字幕可见）
  - 通话记录（含 transcript）正确回写（psql 查 voice_call_records 验证）
- [ ] 完整走一次「对方不接听」场景：60秒超时 → status=no_answer → 3天冷却期内自动规则不再触发（rule_engine 干跑验证）
- [ ] 并发认领测试：同一 call_id 被两个 listener 同时 UPDATE，只有一条 RETURNING → 只产生一个子进程
- [ ] machine 熔断测试：手动注入 5 次 <30s 快失败 → dispatcher 停止认领 + 飞书告警触发（截图）
- [ ] Agent 重启测试：子进程运行中 kill 父进程 → 重启父进程 → 检查锁文件已存在 → 不产生第二个子进程
- [ ] CRM 客户详情页「呼叫」按钮触发全链路（Playwright 真机段等价断言：按钮存在 + 弹窗出现 + POST /call 被调用）

---

## 不包含（本 Sprint）

- AI 对话「接通后中途掉线」的完整监听检测机制（ai_dropped 范围仅限连接建立阶段失败）
- lease 预算的真机实测标定（320s 估算值，待真机压测后调整）
- 多机器绑定同一微信号时的选择规则（当前: 任意 machine 认领均可）
- 平台级并发限流（证据不足，先用延迟埋点日志攒数据观察）
- 声学回声消除（AEC）
- 多账号矩阵拨号

---

## journey_type: user_facing
## journey_type_reason: 最终面向真实客户（客户接到电话），核心价值在于客户侧感知（接通/AI对话/合规告知），属于用户路径功能
## target_environment: windows_wechat
## target_environment_reason: 核心执行链路在 Windows 桌面（xian-rog），依赖 Windows 微信客户端 GUI 自动化（UIA + pyautogui）+ Windows 音频设备（WDM-KS/WASAPI），CI runner 无法自动验证真机段
