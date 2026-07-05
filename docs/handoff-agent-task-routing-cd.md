# Hand-off：Agent 任务路由重设计（方案 C + D）

**背景**：当前 `acquisition_keyword_tasks` 只存 `tenant_id`，租户内所有 online agent 竞争抢任务，导致"xian-pc 触发，ROG 跑"的混乱。

---

## 目标行为

- 方案 C：Dashboard 常驻"当前机器"感知，任务默认绑定到选中机器，多机时才弹选
- 方案 D：采集任务按 burner session（抖音小号 cookie）自动路由到持有 session 的机器，物理隔离

---

## 方案 C：Dashboard 机器感知

### 数据库

```sql
-- acquisition_keyword_tasks 加 agent_id 列
ALTER TABLE zenithjoy.acquisition_keyword_tasks
  ADD COLUMN agent_id UUID REFERENCES zenithjoy.agents(id) ON DELETE SET NULL;

CREATE INDEX idx_acq_kw_tasks_agent ON zenithjoy.acquisition_keyword_tasks(agent_id)
  WHERE agent_id IS NOT NULL;
```

### API 改动

**`POST /api/acquisition/keyword-search`**（创建任务）
- Request body 新增可选字段 `agent_id: string`
- 若传了 `agent_id`，写入 `acquisition_keyword_tasks.agent_id`
- 若没传，`agent_id = NULL`（向后兼容，任意 agent 可抢）

**`GET /api/acquisition/pending-collect-tasks`**（agent 轮询）
- 现有逻辑：按 `tenant_id` 过滤
- 新增逻辑：`WHERE (agent_id = $requestingAgentId OR agent_id IS NULL)`
- 即：只返回指定给自己的任务，或者没有指定（向后兼容老任务）

### Dashboard 改动

**顶栏：MachineSelector 组件**
- 启动时 `GET /api/agent/fleet`，过滤 `status=online` 的机器
- 存入 `localStorage['preferred_agent_id']`，读回显示名称和在线状态（每 30s 刷新）
- 规则：
  - 0 台 online → 红色警告"无在线机器"，禁止创建任务
  - 1 台 online → 自动选中，不弹
  - N 台 online → 第一次弹选择器，选完记住，后续不再弹
  - 选中机器掉线 → 橙色警告，重新触发选择

**任务创建流程**：
- 创建请求 body 带上 `agent_id: localStorage['preferred_agent_id']`
- 若 `preferred_agent_id` 不存在或对应机器 offline → 拦截，不发请求，提示选机器

---

## 方案 D：Burner Session → 机器自动路由

### 逻辑

抖音小号的 session（cookie）存在 `line02_account_sessions` 表，每条记录已关联 `agent_id`（哪台机器绑的号）。

采集任务本质上需要用那个小号的 cookie 登录抖音去搜/抓，所以任务必须在持有 session 的机器上跑，物理上不可能串。

### API 改动

**`POST /api/acquisition/keyword-search`** 创建任务时：
1. 从请求中拿 `burner_account_id`（用户选了哪个抖音小号做采集）
2. 查 `line02_account_sessions WHERE account_id = $burner_account_id AND status = 'active'`
3. 取出 `agent_id` → 写入 `acquisition_keyword_tasks.agent_id`
4. 若查不到 active session → 返回 400，提示"该小号未绑定或 session 已过期，请重新扫码绑定"

### Dashboard 改动

**采集任务创建弹窗**：
- 新增"使用账号"下拉，列出当前 tenant 的 active burner sessions（显示昵称 + 绑定机器名）
- 选了账号 → 自动确定跑在哪台机器，界面显示"将在 XX-ROG 上运行"
- 如果账号的机器当前 offline → 警告"该账号所在机器离线，无法执行"

---

## 优先级建议

| 步骤 | 内容 | 优先级 |
|------|------|--------|
| 1 | DB migration：`acquisition_keyword_tasks` 加 `agent_id` | P0 先做 |
| 2 | API：pending-collect-tasks 按 agent_id 过滤 | P0 先做 |
| 3 | Dashboard：MachineSelector 顶栏组件 | P1 |
| 4 | API + Dashboard：burner session → agent_id 路由（方案 D）| P1 |
| 5 | 任务 stuck 自动检测（processing 超 30min 自动 reset） | P2 |

---

## 附：美甲教程 stuck 问题

`美甲教程` 卡在 `processing` 超 1 小时，根因是 agent 中途挂了没回报 terminal。
临时修复：`UPDATE zenithjoy.acquisition_keyword_tasks SET status='failed' WHERE keyword='美甲教程' AND status='processing';`
根治：加 stuck 检测 cron job，`processing` 超 30min 自动 reset 为 `pending`。
