# Sprint PRD：Path 2 Dashboard 展示与人工干预能力建设

## 元数据

| 字段 | 值 |
|------|-----|
| task_id | 7cb465c1-03cc-4934-a638-e61f78195d37 |
| sprint_dir | sprints/07221948-path2-dashboard-visibility |
| journey_id | 39cc40c2-ba63-81cb-b076-f4f9171f1d52 |
| journey_name | 客户智能获客路径（Path 2） |
| journey_type | user_facing |
| target_environment | local_api |
| base_repo | https://github.com/perfectuser21/zenithjoy-workspace.git |
| priority | P2 |
| created_at | 2026-07-21 |
| prd_version | 1.0.0 |

---

## Journey 简介

**Path 2 客户智能获客路径**（Notion: https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf）

8 步闭环：注册 → 装客户端 → 安卓 Agent 连中台 → 建本地三表 → 填获客画像 → 登录小号 → 检测登录态 → 评论挖客触达。

本次 sprint 负责"数据怎么被看见和操作"侧的 5 条员工反馈需求，与已点火的"安卓 Agent 信号上报"任务互补。

---

## Journey 当前状态（PrepPRD 快照 2026-07-22）

| Feature | 状态 |
|---------|------|
| Lead 人工跟进（留言捕获+负责人分配） | thin/working |
| 抖音私信主动触达 | medium/working（刚修完 P0 串台 bug） |
| 安卓客户端自助装机绑定 | thin/planned |
| 采集任务可观测性（失败原因分类+评论同步） | thin/新建（代码未交付） |
| 机器管理（客户机器+机器上抖音号绑定） | medium/working |

---

## 本次要做的（5 条需求）

员工真机测试反馈 12 条问题清单里剩下的 5 条纯 Dashboard/后端需求：

1. 获客列表看不到触达状态
2. 人工触达没有选号/选话术入口
3. 下载客户端卡片没有实际下载链接
4. 关键词重复采集产生重复线索和重复触达
5. 任务执行进度不可见

---

## Golden Path（用户操作流程）

### Step GP-1：获客列表触达状态展示

用户进入获客列表 → 系统对每条 lead JOIN 最新一条 `dm_assignments`（`ORDER BY updated_at DESC LIMIT 1`，串台 bug 修复前历史脏数据用"最新覆盖旧"规则兜底）→ 渲染「未触达 / 已触达 / 待重试」状态徽标。

**边界**：一条线索有多条历史指派记录（含串台脏数据）→ 只认最新一条。

### Step GP-2：人工触达配置弹窗（选号+话术）

用户点「人工触达」→ 弹窗预填「触达小号」（默认候选：机器心跳最近 N 分钟内 + 账号非 limited/blocked，先用现有心跳代理兜底，字段命名预留升级空间，等安卓 Agent 信号上报任务交付后自然升级为真实在线判定）和「触达话术」（默认系统推荐，可切换历史话术）→ 允许人工改选 → 确认发送 → 写 `dm_assignments`（命中现有 `(tenant_id, lead_id, account_label)` 唯一约束则走更新，不重复插入）。

### Step GP-3：安卓客户端下载入口补充

用户在获客中心 / 账号绑定页任意入口都能看到「下载安卓客户端」明确按钮/链接。

**已核实**：APK 下载走 COS 直链，逻辑已实现（`agent-install-pack.ts`），本次只在 `AcquisitionAccountsPage.tsx` 的「📱 Android 绑定」卡片里补引用现有链接的入口，不重建下载逻辑。

### Step GP-4：关键词去重机制

用户发起采集前输入关键词 → 系统查该租户（仅本租户，不跨租户）30 天窗口内历史 `acquisition_collect_tasks.keywords` → 命中则提示「该关键词 N 天前采集过，是否仍要继续」，允许人工选择强制重跑 → 采集结果落库前按 `sec_uid` 强去重（现有 `(tenant_id, sec_uid)` 唯一约束）+ nickname 弱去重兜底（覆盖 `partial=true` / sec_uid 缺失情况）。

**边界**：30 天后自动允许再次采集，无需人工干预。

### Step GP-5：任务进程可视化

任务发起后 Dashboard 展示阶段进度（`pending → running → stage_1_done → done / partial / failed`，DB 已有 7 态，前端目前未接线）→ 失败态展示 `error_code` 人话翻译 + 重试按钮 → `cancelling` 态禁止重复点击。

**设备类型埋点**：至少补齐 `agents.os_type` 与 `line02_account_sessions.device_type` 两套字段命名统一，不做完整分列 UI，但字段必须打通（避免重蹈 decision 8dbe91ee 的坑）。

---

## 涉及的 Feature（thickness 变更）

| Feature | 当前 | 本次目标 | 变更内容 |
|---------|------|----------|---------|
| Lead 人工跟进（留言捕获+负责人分配） | thin | thin（加厚中间件） | 获客列表接入触达状态展示，JOIN dm_assignments 最新一条 |
| 抖音私信主动触达 | medium | medium（交互加厚） | 人工触达配置弹窗：选号/选话术 |
| 安卓客户端自助装机绑定 | thin | thin（入口补充） | AcquisitionAccountsPage.tsx 补 APK 下载链接入口 |
| 采集任务可观测性 | thin/新建 | thin | 关键词去重机制（前端提示+后端去重逻辑） |
| 任务进程可视化（新建） | — | thin（新建） | Dashboard 进度展示+设备类型埋点字段统一 |

---

## 判定点登记表（5 个，已全部拍板）

| 判定点 | 所选方法 | 依据 | 误判后果 |
|--------|----------|------|---------|
| 触达状态取哪条 assignment | A：`updated_at DESC LIMIT 1` | 现有唯一约束按 (tenant,lead,account_label)，串台历史脏数据下"最新"最贴近真实业务语义 | 选错会把串台 bug 修复前脏历史当作当前状态，误导人工判断 |
| 默认在线小号判定源 | B：现有机器心跳代理 | 心跳数据已有，安卓信号任务未合并，不应阻塞本 sprint | 若强行等真实在线判定，Path2 阻塞时间不可控 |
| APK 下载地址来源 | B：保持现状动态查询 | `agent-install-pack.ts` 已实现 COS 直链动态拼版本号，本次只引用不重建 | 误判为需新建下载逻辑会重复造轮子 |
| 关键词去重范围 | B：仅本租户 | 多租户数据隔离是硬约束 | 误做成全局去重会跨租户互相屏蔽关键词，严重数据隔离缺陷 |
| 同一人判定字段 | C：sec_uid 为主 + nickname 弱兜底 | 现有机制已是两级去重，直接复用 | 全用 nickname 会同名误合并；全用 sec_uid 会漏掉残缺号 (partial=true) |
| 任务进度是否区分设备类型 | 介于 A/B：至少补埋点字段 | agents.os_type 与 line02_account_sessions.device_type 两套命名不一致，是 decision 8dbe91ee 坑本体 | 不补埋点，未来任何设备区分需求都要推倒重来 |

---

## 不包含（本次范围外）

- 真实在线小号判定（依赖"安卓 Agent 信号上报"任务交付，本次先用心跳代理兜底）
- 任务进度按设备类型完整拆分展示（本次只补埋点字段，不做完整分列 UI）
- 触达小号/话术的智能推荐算法（本次只做"系统推荐"=简单规则，不做智能排序）

---

## 累积 FR（Functional Requirements）

### FR-1：获客列表触达状态列（Join 最新 dm_assignments）

**对应 Golden Path**: GP-1

- FR-1.1：获客列表 API（`GET /api/acquisition/leads`）响应的每条 lead 必须包含 `outreach_status` 字段，值域为 `untouched | touched | retry_needed`
- FR-1.2：`outreach_status` 取该 lead 最新一条 `dm_assignments`（按 `updated_at DESC LIMIT 1`）的状态映射；无对应 assignment 行时返回 `untouched`
- FR-1.3：有多条历史 assignment（含串台脏数据）时，只取最新一条，其余忽略
- FR-1.4：获客列表页面渲染对应徽标（未触达 / 已触达 / 待重试）
- FR-1.5：smoke 断言：`GET /api/acquisition/leads` 响应中 `outreach_status` 字段存在，且已有 dm_assignment 的 lead 返回非 `untouched` 值

### FR-2：人工触达配置弹窗（选号+话术）

**对应 Golden Path**: GP-2

- FR-2.1：`GET /api/acquisition/outreach/defaults?lead_id=<id>` 返回默认小号列表（心跳最近 N 分钟内 + 非 limited/blocked 状态）和默认话术
- FR-2.2：小号候选基于现有机器心跳数据（`agents` 表 `last_heartbeat_at`），字段命名预留升级空间（`online_source: "heartbeat_proxy"` 标注），等安卓信号上报任务交付后自然升级
- FR-2.3：`POST /api/acquisition/outreach/manual` 接受 `{lead_id, account_label, script_text}`，写入 `dm_assignments`；命中 `(tenant_id, lead_id, account_label)` 唯一约束则 UPDATE，不重复 INSERT
- FR-2.4：前端人工触达弹窗展示默认小号（可改选）+ 默认话术（可切换历史话术），确认发送调用 FR-2.3 接口
- FR-2.5：`cancelling` 状态下触达按钮禁用
- FR-2.6：smoke 断言：`GET .../outreach/defaults` 返回 `accounts` 数组（≥0 元素）+ `default_script` 字段；`POST .../outreach/manual` 返回 200 + dm_assignments 有对应行写入

### FR-3：安卓客户端下载入口

**对应 Golden Path**: GP-3

- FR-3.1：`AcquisitionAccountsPage.tsx` 的「📱 Android 绑定」卡片内补充「下载安卓客户端」按钮，点击跳转/下载 APK
- FR-3.2：下载链接复用现有 `agent-install-pack.ts` 逻辑（COS 直链，不重建），不新增后端端点
- FR-3.3：smoke 断言：`GET /api/agent/install-pack` 或现有下载端点返回含 APK URL 的 200 响应（验证现有逻辑未被破坏）

### FR-4：关键词去重机制

**对应 Golden Path**: GP-4

- FR-4.1：`POST /api/acquisition/collect/start` 接受关键词输入前，后端查询该租户（`tenant_id` 精确匹配，不跨租户）30 天窗口内历史 `acquisition_collect_tasks.keywords`
- FR-4.2：命中时返回 `{duplicate: true, last_used_at: <timestamp>, days_ago: N}`，HTTP 200（不拒绝，由前端弹提示）
- FR-4.3：前端采集发起页：关键词输入后检测去重 API，命中则弹「该关键词 N 天前采集过，是否仍要继续？」，允许强制重跑（传 `force: true` 参数）
- FR-4.4：采集结果落库前按 `sec_uid` 强去重（复用现有 `(tenant_id, sec_uid)` 唯一约束），`partial=true` / sec_uid 缺失时用 nickname 弱去重兜底（覆盖更新 `partial=true` 行）
- FR-4.5：30 天后自动允许再次采集（不命中去重逻辑），无需任何额外操作
- FR-4.6：smoke 断言：同一关键词在 30 天窗口内两次 `collect/start`，第二次响应含 `duplicate: true`；传 `force: true` 则正常执行；超 30 天的历史记录不触发去重提示

### FR-5：任务进程可视化 + 设备类型埋点

**对应 Golden Path**: GP-5

- FR-5.1：Dashboard 采集任务列表展示进度状态（`pending / running / stage_1_done / done / partial / failed / cancelling`，DB 已有 7 态），字段来自 `acquisition_collect_tasks.status`
- FR-5.2：失败态（`failed / partial`）展示 `error_code` 的人话翻译（错误码 → 中文说明映射表，至少覆盖：`quota_exceeded / no_account / network_timeout / invalid_keywords / unknown`）
- FR-5.3：失败态显示重试按钮（调用 `POST /api/acquisition/collect/retry?task_id=<id>`）
- FR-5.4：`cancelling` 态重试按钮禁用，防重复点击
- FR-5.5：设备类型埋点统一——`agents.os_type` 与 `line02_account_sessions.device_type` 两列值域统一（`android | windows | unknown`），不做完整分列 UI 但字段打通；PR 内必须包含 migration 或字段枚举统一文档，不允许只在 TODO 注释里提及
- FR-5.6：smoke 断言：`GET /api/acquisition/collect/tasks` 响应每条任务含 `status` 字段（7 态合法值之一）；`agents` 表 `os_type` 列与 `line02_account_sessions.device_type` 列在 DB schema 中值域一致

---

## NFR（非功能性需求）

### NFR-1：租户数据隔离（铁律级）

- 所有查询/写入必须 scope 到 `tenant_id`；跨租户数据绝不混读混写
- 关键词去重范围明确限定本租户（`WHERE tenant_id = $current_tenant_id`）
- 测试必须覆盖 ≥2 个租户并断言互不串（invariant: `[系统]测试默认多租户`）

### NFR-2：多设备类型字段完整性（invariant 级）

- 本 sprint 涉及 `agents.os_type` / `line02_account_sessions.device_type` 字段命名不一致问题，必须本 sprint 内消解或建正式 decision + 挂任务队列；禁止只在文档里写「留给后续技术债 sprint」（invariant: `多设备类型(os_type/device_platform)UI区分必须在设计/审查阶段强制检查`）
- 验收时 golden-path-reviewer 需检查：设备类型字段在 DB schema 层已统一，哪怕 UI 暂不展示分列视图

### NFR-3：E2E/smoke 先行（铁律级）

- 每个 FR 的实现必须先有对应 smoke 断言（golden-path-2-smoke.sh 新 Step 或扩展）再有实现代码
- smoke 脚本中文件存在性检查找不到必须 `exit 1` 硬失败，禁止静默 `continue`（invariant: `harness pipeline 假阳性smoke+evaluator替代证据双缺口`）
- PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记（invariant: `feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh`）

### NFR-4：dm_assignments 幂等性

- `POST /api/acquisition/outreach/manual` 命中 `(tenant_id, lead_id, account_label)` 唯一约束时走 UPDATE，不允许 INSERT 抛 conflict 错误

### NFR-5：cancelling 态防重入

- 任何涉及任务操作的按钮（重试/触达/取消），在对应任务处于 `cancelling` 态时必须禁用并给出提示

### NFR-6：性能

- 获客列表 API（含 JOIN dm_assignments）P99 < 500ms（staging 环境，≤1000 行数据）

---

## Invariant 约束

本次 sprint 需遵守的系统级铁律（从 Brain invariants 表提取，共 8 条活跃 invariant 与本次直接相关）：

### INV-1：多设备类型 UI 区分强制设计期检查

> `多设备类型(os_type/device_platform)UI区分必须在设计/审查阶段强制检查`

新字段与既有字段语义重叠时必须本 sprint 内消解或建正式 decision + 挂任务队列，禁止只在文档里写「留给后续技术债 sprint」了事。contract-reviewer 遇到此类表述直接判 needs_revision。

**本次触发**：`agents.os_type` vs `line02_account_sessions.device_type` 两套命名不一致，FR-5.5 必须处理。

### INV-2：租户隔离

> `[系统]租户隔离`

碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写。

**本次触发**：关键词去重（FR-4.1）、触达状态查询（FR-1.2）、小号列表查询（FR-2.1）。

### INV-3：测试默认多租户

> `[系统]测试默认多租户`

单元/E2E 测试默认种 ≥2 个租户并断言互不串，让隔离漏洞当场暴露。

**本次触发**：关键词去重测试必须验证 tenant A 的历史关键词不影响 tenant B 的去重判断。

### INV-4：harness 人工救场禁用 CI 绿顶替 evaluator 验收 + 合同必须 1:1 映射 PrepPRD Golden Path

> `harness 人工救场禁用 CI 绿顶替 evaluator 验收 + 合同必须 1:1 映射 PrepPRD Golden Path`

GAN reviewer 审合同必须拿 PrepPRD Golden Path 逐步核对 BEHAVIOR 覆盖，步骤无对应 BEHAVIOR = REJECTED。

**本次触发**：contract-dod 必须与 GP-1 到 GP-5 逐一对应，不能只有 CI 绿放行。

### INV-5：harness pipeline 假阳性 smoke + evaluator 替代证据双缺口

> `harness pipeline 假阳性smoke+evaluator替代证据双缺口`

smoke 脚本文件存在性检查找不到必须 `exit 1` 硬失败，禁止静默跳过；evaluator 在 `target_environment=local_api` 下禁止把「CI 状态绿」直接当 unverifiable 项的替代证据放行。

**本次触发**：golden-path-2-smoke.sh 新增 Step 的断言必须硬失败，不允许静默跳过。

### INV-6：harness judge 必须按 target_environment 校准证据要求

> `harness judge 未按 target_environment 校准证据要求`

judge 在校验前必须先读 `target_environment`，按环境能力上限校准——`local_api` 环境没有真实设备，不能要求设备端日志或真实 LLM 调用。

**本次触发**：本 sprint `target_environment=local_api`，judge 只验 API 层断言，不要求 Android 真机输出。

### INV-7：合同批准前必须记录 manual oracle 真实 exit code

> `[capture-triage] learning: 合同批准前必须同时记录 manual oracle 的真实 exit code`

合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。

**本次触发**：contract-dod 提交前须在 staging 环境执行 smoke 脚本并记录 exit code。

### INV-8：target_environment 从 DB tasks.payload 读取

> `[agent-offline-alert] learning: target_environment 从 DB tasks.payload 读取，不从文件读`

**本次触发**：本任务 `payload.target_environment=local_api` 已正确注册，harness 组件读此字段时无需更改。

---

## 前置工作（已逐项确认，无 TBD）

| 项目 | 状态 |
|------|------|
| 复用现有 staging 测试租户 | 已就绪 |
| 全部复用中台既有 API/DB 连接，无需新增外部凭据 | 已确认 |
| APK 下载复用现有 COS 直链逻辑 | 已核实（`agent-install-pack.ts`） |
| 沿用现有 staging 测试租户流程 | 已就绪 |
| 不涉及视频/图片素材 | 已确认 |
| staging 环境已就绪，golden-path-2-smoke.sh 可扩展新 Step | 已就绪（当前 24 Step，本次扩展） |

---

## 验收标准（Final E2E）

以下断言均写入 `golden-path-2-smoke.sh` 新增 Step，CI 全绿为通过标准：

- [ ] **Step 25**（FR-1）：获客列表 API 响应含 `outreach_status` 字段；有 dm_assignment 的 lead 返回 `touched`，无 assignment 的 lead 返回 `untouched`；有多条历史 assignment 时取最新一条的映射值
- [ ] **Step 26**（FR-2）：`GET /api/acquisition/outreach/defaults` 返回默认小号（心跳在线代理）+ 默认话术；`POST /api/acquisition/outreach/manual` 写入 dm_assignments，命中唯一约束时 UPDATE 不重复 INSERT
- [ ] **Step 27**（FR-3）：现有 APK 下载端点（`/api/agent/install-pack` 或等价）返回含 `download_url` 字段的 200 响应（验证入口引用现有逻辑未破坏）
- [ ] **Step 28**（FR-4）：同一租户同一关键词 30 天内第二次 `collect/start` 响应含 `duplicate: true + days_ago`；传 `force: true` 正常执行；不同租户同一关键词不互相触发去重；超 30 天历史记录不触发
- [ ] **Step 29**（FR-5）：`GET /api/acquisition/collect/tasks` 每条任务含 `status` 字段（7 态合法值之一）；`agents.os_type` 与 `line02_account_sessions.device_type` 列在 DB schema 中值域一致（psql 断言枚举或 check constraint 匹配）
- [ ] **CI 全绿**：所有现有 Step 1-24 保持绿（无回归）

---

## 技术约束与实现备注

### 数据库层

- `dm_assignments` 现有唯一约束 `(tenant_id, lead_id, account_label)` → 人工触达写入时 ON CONFLICT DO UPDATE
- `acquisition_collect_tasks.keywords` 字段类型需确认（`text[]` 或 `jsonb`），去重查询用 `@>` 或 `= ANY(keywords)` 取决于存储格式
- `agents.os_type` 与 `line02_account_sessions.device_type` 统一：统一成 `text` enum `android | windows | unknown`，若其中一列是 `varchar` 枚举需出 migration

### 前端层

- 获客列表状态徽标：复用现有 badge 组件，不新建 UI 组件
- 人工触达弹窗：复用现有 Modal 组件，不新建样式
- `AcquisitionAccountsPage.tsx`：只补 `<a href={downloadUrl}>下载安卓客户端</a>` 入口，`downloadUrl` 从现有接口取
- 任务进度：复用现有任务列表组件，加 status 字段展示逻辑

### API 层

- 小号候选筛选：`SELECT * FROM agents WHERE tenant_id = $tid AND last_heartbeat_at > NOW() - interval '10 minutes'`（10 分钟阈值可配置），过滤掉 `account_sessions.status IN ('limited','blocked')` 的账号
- 话术：历史话术从 `dm_assignments.script_text DISTINCT` 查，默认话术取最近使用的（`ORDER BY updated_at DESC LIMIT 1`）

---

## 开发顺序（强制）

```
commit-1: golden-path-2-smoke.sh 新增 Step 25-29（失败态，定义"什么叫完成"）
commit-2: 后端 API 实现（FR-1 to FR-5）
commit-3: 前端组件接线
commit-4: 确保 Step 25-29 绿（E2E 通过）
```

第一个 commit 必须是 smoke 新 Step，不是实现代码，不是 unit test。

---

*本 PRD 由 harness-planner subagent 产出，基于 PrepPRD（task_id: 7cb465c1）+ Brain invariants（86 条，8 条与本次直接相关）*
*产出时间：2026-07-24*
