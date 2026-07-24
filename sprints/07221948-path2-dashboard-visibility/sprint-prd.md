# Sprint PRD — Path 2 Dashboard 展示与人工干预能力

**Task**: 7cb465c1-03cc-4934-a638-e61f78195d37
**Sprint**: 07221948-path2-dashboard-visibility
**Date**: 2026-07-24
**Journey**: Path 2 客户智能获客（https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf）
**Journey Maturity**: not_started → 推进 Dashboard 可观测性一侧

---

## Invariant 约束

1. `dm_assignments` 唯一键 `(tenant_id, lead_id, account_label)` 不可破坏；写入触达记录必须用 `ON CONFLICT ... DO UPDATE` 语义（不重复 INSERT）
2. `acquisition_collect_tasks.status` 7 态值域固定：`pending|running|cancelling|cancelled|done|partial|failed`（CHECK 约束），前端展示不得依赖库外枚举
3. 关键词去重范围**仅本租户**（`tenant_id` 过滤），绝不跨租户
4. lead 去重：`(tenant_id, sec_uid)` 唯一约束为主，`nickname` 弱兜底（`partial=true`/sec_uid 缺失），现有逻辑不得回退
5. APK 下载逻辑**不重建**：复用 `agent-install-pack.ts` 已有 `apk_url`（`ANDROID_APK_COS_URL` env / 默认 COS 直链），前端只新增入口引用
6. `agents.os_type` 与 `agent_platform_sessions.device_type` 两套命名语义不同（前者是 OS 类型，后者是绑号来源），本次只补埋点字段对齐，不合并两套命名
7. 默认在线小号判定：先用心跳时间窗代理（`agents.last_heartbeat_at > NOW() - N分钟`），字段命名预留升级空间，等安卓 Agent 信号上报任务交付后自然升级
8. 租户隔离：所有读写携带 `tenant_id`，不得跨租户
9. `cancelling` 态的采集任务禁止前端重复触发重试操作
10. 历史脏数据（串台 bug 修复前）：`dm_assignments` 多行时取 `updated_at DESC LIMIT 1` 最新一条，不追溯旧历史

---

## 累积 FR

### FR-1 获客列表接入触达状态展示

**后端（`GET /api/acquisition/leads`）**
- 在现有 SQL 中新增 LATERAL 子查询，JOIN `dm_assignments` 取该 lead 最新一条（按 `updated_at DESC LIMIT 1`）的 `status`
- 命中：返回 `outreach_status: 'queued'|'dispatched'|'sent'|'limited'|'failed'|'cancelled'|'pending_dispatch'`
- 未命中：返回 `outreach_status: null`
- 前端语义映射：
  - `null`：**未触达**（灰色徽标）
  - `sent`：**已触达**（绿色徽标）
  - `queued|dispatched|pending_dispatch`：**待触达**（蓝色徽标）
  - `limited|failed|cancelled`：**待重试**（橙色/红色徽标）

**前端（`LeadsTable.tsx` 或 `LeadsPage.tsx`）**
- 现有 `outreach_eligible` 列保留（显示"可触达/不触达"），新增 `outreach_status` 列显示徽标
- 串台脏数据兜底：多历史行取最新，前端无需特殊处理（后端 SQL 已处理）

---

### FR-2 人工触达配置弹窗（选号/选话术）

**后端**
- 新增 `GET /api/acquisition/manual-outreach/candidates` 端点
  - 查询参数：`tenant_id`（从 header 或 session 取）
  - 返回：`{ accounts: [{account_label, device_type, last_seen_at, is_online: bool}], default_message: string }`
  - 在线判定：`agents.last_heartbeat_at > NOW() - interval '5 minutes'`（心跳代理，字段名 `is_online` 预留升级空间）
  - `default_message` 取 `acquisition_config.dm_message`（该租户已有配置）
  - 排序：`is_online DESC, last_seen_at DESC`

- 新增 `POST /api/acquisition/manual-outreach` 端点
  - Body: `{ lead_id: string, account_label: string, message?: string }`
  - 写 `dm_assignments`：命中 `(tenant_id, lead_id, account_label)` 唯一约束则走 `ON CONFLICT DO UPDATE SET status='queued', updated_at=now()`，不重复插入
  - 响应：`{ success: true, data: { assignment_id: string } }`

**前端（`AcquisitionOutreachPage.tsx` 或 `LeadsPage.tsx`）**
- 获客列表每行"人工触达"按钮 → 弹窗
- 弹窗内容：选号列表（默认选第一个在线号）+ 话术文本框（默认填 `default_message`，可修改）
- 确认后调 `POST /api/acquisition/manual-outreach`
- 提交中态：禁用确认按钮，显示 loading

---

### FR-3 绑号页补安卓客户端下载入口

**前端（`AcquisitionAccountsPage.tsx`）**
- 在页面内"📱 Android 绑定"卡片区域，新增「下载安卓客户端」按钮/链接
- 点击调 `GET /api/install-pack/manifest`（现有端点），从响应的 `apk_url` 字段拿到下载地址
- 或直接展示已知的 `apk_url` 的 `<a href>` 链接（从 manifest 端点动态查）
- 不重建下载逻辑，不硬编码 APK URL

---

### FR-4 关键词去重提示

**后端（`POST /api/acquisition/collect/start`）**
- 发起采集前，在现有 INSERT 之前增加去重检查：
  ```sql
  SELECT keywords, created_at
    FROM zenithjoy.acquisition_collect_tasks
   WHERE tenant_id = $1
     AND created_at > NOW() - interval '30 days'
     AND keywords && $2::text[]  -- 有交集
   ORDER BY created_at DESC
   LIMIT 1
  ```
- 命中且未带 `force: true` 参数：返回 `409 KEYWORD_RECENTLY_USED`，body 含 `{ last_used_at: string, matched_keywords: string[] }`
- 命中但带 `force: true`：正常执行，不返回 409
- 30 天后（`created_at < NOW() - interval '30 days'`）：正常执行，不提示

**前端（`AcquisitionTasksPage.tsx` 采集发起入口）**
- 收到 409 `KEYWORD_RECENTLY_USED` → 弹确认对话框："关键词 [X] 在 N 天前采集过，是否仍要继续？"
- 用户选"继续"：重新请求带 `force: true`
- 用户选"取消"：关闭对话框，不发起采集

---

### FR-5 采集任务进度展示 + 设备类型埋点字段对齐

**后端（`GET /api/acquisition/collect-tasks`）**
- 现有端点已返回 `status`、`error_code`、`video_count`
- 补充返回 `stage`（若表中有此字段则直接透传，否则从 `status` 映射：`running` → 展示为进行中，`failed/partial` → 展示错误）
- `error_code` 人话翻译表（后端直接返回，前端不重复维护）：
  | error_code | 展示文案 |
  |------------|---------|
  | `AGENT_OFFLINE` | 设备离线，请检查客户端连接 |
  | `NO_KEYWORD` | 关键词为空，请先配置画像 |
  | `TIMEOUT` | 采集超时，点击重试 |
  | `NETWORK_ERROR` | 网络错误，点击重试 |
  | 其他/NULL | 采集失败，点击重试 |

**埋点字段对齐（仅 DB migration，不做完整分列 UI）**
- 新增 migration `20260724_path2_device_type_align.sql`：
  ```sql
  -- 补 acquisition_collect_tasks.os_type 字段（记录发起该任务的 agent 的 os_type，来自 agents 表）
  ALTER TABLE zenithjoy.acquisition_collect_tasks
    ADD COLUMN IF NOT EXISTS agent_os_type text;
  COMMENT ON COLUMN zenithjoy.acquisition_collect_tasks.agent_os_type IS
    '采集任务执行设备 os_type（从 agents.os_type 冗余，decision 8dbe91ee 坑的补偿）；'
    'line02_account_sessions.device_type 与本字段语义独立，前者是绑号来源，后者是 OS 类型';
  ```
- `POST /api/acquisition/collect/start` 在写 `acquisition_collect_tasks` 时，从 `agents.os_type` 冗余写入 `agent_os_type`（若能查到；查不到则留 NULL，不 fail）

**前端（`AcquisitionTasksPage.tsx`）**
- 任务列表新增进度展示：状态徽标 + 状态文案（见 7 态映射）
- `failed/partial` 态：展示错误文案（来自后端翻译表）+ "重试"按钮（调 `POST /collect/start` 原始 keywords）
- `cancelling` 态：禁用重试按钮，展示"正在取消..."

---

## NFR

| 维度 | 要求 |
|------|------|
| 性能 | `/leads` 的 LATERAL 子查询加 `dm_assignments (tenant_id, lead_id, updated_at DESC)` 索引，P99 < 300ms（500 条以内） |
| 幂等 | migration 全部 `IF NOT EXISTS`；manual-outreach 写入 `ON CONFLICT DO UPDATE`，重复提交不报错 |
| 租户隔离 | 所有新端点必须携带 `tenant_id` 过滤 |
| 安全 | manual-outreach 端点必须通过现有 `tenantContextOptional` 中间件，无 tenant 上下文返回 401 |
| 测试顺序 | commit-1 写 E2E/smoke test（失败）→ commit-2 写实现（通过） |

---

## Golden Path（核心场景）

1. **触达状态展示**：用户打开获客列表 → 每条 lead 显示触达状态徽标（未触达/待触达/已触达/待重试）
2. **人工触达**：点"人工触达"→ 弹窗预填在线小号 + 默认话术 → 确认 → `dm_assignments` 写入/更新
3. **下载客户端**：用户在绑号页点「下载安卓客户端」→ 浏览器跳转 APK 下载 URL
4. **关键词去重**：用户输入 30 天内用过的关键词 → 系统提示"已采集过，是否继续" → 选择继续 → 采集正常执行
5. **任务进度**：采集任务列表展示进度徽标 + 失败时展示错误原因 + 重试按钮

---

## Response Schema

### 新/改 API 端点

```typescript
// GET /api/acquisition/leads（改）
// 新增字段 outreach_status
{
  leads: Array<{
    commenter_id: string;
    // ...现有字段...
    outreach_eligible: boolean | null;
    outreach_status: 'queued'|'dispatched'|'sent'|'limited'|'failed'|'cancelled'|'pending_dispatch'|null; // 新增
  }>;
  total: number;
}

// GET /api/acquisition/manual-outreach/candidates（新增）
{
  success: true;
  data: {
    accounts: Array<{
      account_label: string;
      device_type: 'web' | 'android';
      last_seen_at: string | null;
      is_online: boolean; // last_heartbeat_at > NOW() - 5min
    }>;
    default_message: string;
  };
}

// POST /api/acquisition/manual-outreach（新增）
// Request: { lead_id: string, account_label: string, message?: string }
// Response 成功:
{
  success: true;
  data: { assignment_id: string };
  timestamp: string;
}

// POST /api/acquisition/collect/start（改）
// 新增 force 参数支持
// Request: { keywords: string[], force?: boolean }
// 409 KEYWORD_RECENTLY_USED（30天内命中 + 未传 force）:
{
  success: false;
  error: {
    code: 'KEYWORD_RECENTLY_USED';
    message: '关键词近期已采集过';
    last_used_at: string;
    matched_keywords: string[];
  };
  timestamp: string;
}

// GET /api/acquisition/collect-tasks（改）
// 新增字段 agent_os_type + error_code_message
{
  tasks: Array<{
    id: string;
    status: string;
    keywords: string[];
    video_count: number;
    lead_count: number;
    error_code: string | null;
    error_code_message: string | null; // 新增，后端翻译好的人话
    agent_os_type: string | null;       // 新增埋点字段
    created_at: string;
  }>;
}
```

### 新 Migration DDL

```sql
-- 20260724_path2_device_type_align.sql
ALTER TABLE zenithjoy.acquisition_collect_tasks
  ADD COLUMN IF NOT EXISTS agent_os_type text;
COMMENT ON COLUMN zenithjoy.acquisition_collect_tasks.agent_os_type IS
  '采集任务执行设备 os_type（从 agents.os_type 冗余写入，decision 8dbe91ee 坑的补偿）；'
  'line02_account_sessions.device_type 与本字段语义独立（前者绑号来源，后者 OS 类型），不合并';

-- dm_assignments 的查询优化索引（若不存在）
CREATE INDEX IF NOT EXISTS idx_dm_assign_tenant_lead_updated
  ON zenithjoy.dm_assignments(tenant_id, lead_id, updated_at DESC);
```

---

## 验收标准（Final E2E）

### golden-path-2-smoke.sh 新增 Step

```bash
# Step 25：触达状态 — GET /leads 返回最新 dm_assignment 状态
# Step 26：人工触达 API — candidates 返回在线小号 + default_message；manual-outreach 写入幂等
# Step 27：APK 下载入口 — install-pack/manifest 返回 apk_url（非空且以 http 开头）
# Step 28：关键词去重 — 30天内重复关键词返回 409 KEYWORD_RECENTLY_USED；force=true 正常执行
# Step 29：设备类型埋点 — acquisition_collect_tasks.agent_os_type 字段在库
```

### 详细断言

- **Step 25**：`GET /api/acquisition/leads` 返回的 lead 对象含 `outreach_status` 字段，值为合法值域或 null；对已有 `dm_assignment` 的 lead，`outreach_status` 非 null
- **Step 26a**：`GET /api/acquisition/manual-outreach/candidates` 返回 HTTP 200，`data.accounts` 为数组，`data.default_message` 为非空字符串
- **Step 26b**：`POST /api/acquisition/manual-outreach` 写入 `dm_assignments`，重复提交不报 409（幂等更新）
- **Step 27**：`GET /api/install-pack/manifest` 返回 HTTP 200，`apk_url` 非空且以 `http` 开头
- **Step 28a**：30天内重复关键词 → 返回 409，body 含 `error.code='KEYWORD_RECENTLY_USED'` + `matched_keywords` + `last_used_at`
- **Step 28b**：同关键词带 `force: true` → 返回 200，`data.task_id` 非空
- **Step 29**：`SELECT 1 FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='acquisition_collect_tasks' AND column_name='agent_os_type'` 返回 1
- **CI 全绿**

---

## 开发顺序（强制）

```
commit-1: 新增 golden-path-2-smoke.sh Step 25-29（失败状态，定义验收条件）
commit-2: migration 20260724_path2_device_type_align.sql
commit-3: 后端实现（GET /leads 加 outreach_status、manual-outreach 两个端点、collect/start 关键词去重、collect-tasks error_code_message）
commit-4: 前端实现（LeadsTable 触达状态徽标、人工触达弹窗、AcquisitionAccountsPage APK 入口、AcquisitionTasksPage 进度展示+关键词去重提示）
commit-5: 让 Step 25-29 全绿
```

---

## 不包含（本 Sprint 范围外）

- 真实在线小号判定（依赖安卓 Agent 信号上报任务）
- 触达小号/话术智能推荐算法
- 任务进度按设备类型完整分列 UI（只补埋点字段）
- 企微 webhook 接入

---

journey_type: dashboard_visibility
target_environment: windows_cloud
path: path2
