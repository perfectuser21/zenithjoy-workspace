# Sprint PRD — Line02 Dashboard IA 重做：Golden Path 顺序 + 触达记录视图

## OKR 对齐

- **对应 KR**：Line02 客户智能获客路径 — 端到端获客闭环可观测
- **当前进度**：Step 1/2/3/5 done，私信触达 planned
- **本次推进预期**：Hub IA 对齐 Golden Path，触达记录从 planned 推进到 working（可视化只读视图）

## 背景

Dashboard 智能获客主页的 4 张卡片与真实 Golden Path 顺序脱节：两张卡指向同一个错误 URL 且标"即将上线"（触达逻辑已在跑）；AcquisitionConfigPage 混合了不相关的功能；Leads 页是孤儿路由（无 Hub 入口）；账号管理页的"抖音昵称"列显示页面标题而非真实昵称。本次做纯 IA 层面重组，让管理员从主页一眼看出获客先后顺序，且每个入口都能进到真实内容。

## Golden Path（核心场景）

管理员打开「智能获客」主页 → 看到 4 张按 Golden Path 顺序排列的入口卡片 → 点任意卡片都能进入真实内容页面 → 完成对应操作。

具体：

1. **[入口]** 管理员点击左侧导航「智能获客」→ 进入 Hub 页，看到 4 张卡片：① 绑抖音小号、② 采集、③ 看线索、④ 触达记录，顺序与操作先后一致，无"即将上线"标签，无死链接
2. **[绑号]** 点「绑抖音小号」→ 进入账号管理页 → 表格只显示"小号名"、"角色"、"状态"、"绑定时间"等列，不再出现显示错误数据的"抖音昵称"列
3. **[采集]** 点「采集」→ 进入采集任务页（`/area/acquisition/tasks`，现有页面不改）
4. **[看线索]** 点「看线索」→ 直接进入 Leads 页 → 可看到评论内容/最新回复/负责人/评级（现有 LeadsPage 不改内容，只接入导航）
5. **[触达记录]** 点「触达记录」→ 看到触达历史列表：每行显示"Lead 昵称 / 指派小号 / 排期时间 / 发送状态"，数据来自 `dm_assignments` join `dm_outreach_log`；当前租户无触达记录时显示"暂无触达记录"空状态提示
6. **[设置]** Hub 页或顶部导航提供独立「设置」入口 → 进入瘦身后的 AcquisitionConfigPage，只含采集/触达/养号/Cookie 四组参数配置表单，不再混入指派计划和主号状态

## 边界情况

- 触达记录页：租户无任何 dm_assignments/dm_outreach_log 记录 → 显示友好空状态（"暂无触达记录，触达任务运行后将在此显示"），不报错、不显示空表格
- 账号管理页：删除 account_nickname 列后，BurnerSession interface 中 account_nickname 字段可保留（后端数据不删），只删前端渲染的那列
- AcquisitionConfigPage 瘦身：删除的块（指派计划块 DispatchPlanSection、Cookie 健康块 CookieHealthSection、getLine02AccountStatus 主号状态）迁移到对应功能页，本页只保留 GROUPS 配置表单 + 保存按钮
- Hub 页不再展示"客户分析"/"触达中心"名称，这两张旧卡片整体替换为新的 4 张 GP 顺序卡片

## 范围限定

**在范围内**：
- Hub 页 MODULES 数组替换为 GP 顺序的 4 张卡 + 独立设置入口
- 账号管理页删除"抖音昵称"列
- AcquisitionConfigPage 删除 DispatchPlanSection + CookieHealthSection + getLine02AccountStatus 相关代码，只留参数配置表单
- Leads 页接入 Hub 导航（新卡片 link 到 `/area/acquisition/leads`，navigation.config 新增该路由）
- 新建 AcquisitionOutreachPage（`/area/acquisition/outreach`），只读展示触达历史
- 新增后端 API：`GET /api/acquisition/outreach-history`，读 dm_assignments join dm_outreach_log，按 scheduled_for 倒序，返回分页列表
- navigation.config 注册新路由：`/area/acquisition/leads` + `/area/acquisition/outreach`

**不在范围内**：
- 修复抖音昵称抓取逻辑根因（page.title() 问题）
- 飞书画像填写引导（Step 4）
- 微信引流号绑定
- 私信收件箱回复抓取
- 指派计划功能（DispatchPlanSection）本身不删业务逻辑，只从设置页移出；移到哪个页面本次不定

## 假设

- [ASSUMPTION: `/area/acquisition/leads` 是 Leads 页的新路由；navigation.config 新增该 path → LeadsPage 映射，旧 `/dashboard/leads` 保持兼容不删]
- [ASSUMPTION: AcquisitionConfigPage 保留现有路由 `/dashboard/acquisition-config`，Hub 设置卡片 link 指向此 URL；页面标题改为"设置"]
- [ASSUMPTION: 触达记录 API 返回格式：`{ data: { items: [{id, lead_nickname, account_label, status, scheduled_for, sent_at}], total } }`，lead_nickname 从 acquisition_leads 表 join]
- [ASSUMPTION: dm_assignments.status 枚举（queued/dispatched/sent/limited/failed）直接展示中文映射]

## 预期受影响文件

- `apps/dashboard/src/pages/AcquisitionHubPage.tsx`：重写 MODULES 数组（4 张 GP 顺序卡 + 设置入口）
- `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`：删除第 123/133 行"抖音昵称"列渲染
- `apps/dashboard/src/pages/AcquisitionConfigPage.tsx`：删除 DispatchPlanSection + CookieHealthSection + getLine02AccountStatus 相关代码（约 400 行 → 约 250 行）；标题改"设置"
- `apps/dashboard/src/pages/AcquisitionOutreachPage.tsx`：新建，只读触达历史列表页
- `apps/dashboard/src/api/acquisition-dispatch.api.ts`：新增 fetchOutreachHistory() 函数
- `apps/dashboard/src/config/navigation.config.ts`：新增 `/area/acquisition/leads` 和 `/area/acquisition/outreach` 路由；注册 AcquisitionOutreachPage 组件
- `apps/api/src/routes/acquisition-dispatch.ts`：新增 `GET /api/acquisition/outreach-history` 端点

## NFR 约束

<!-- 来源: decisions 表 category=nfr；Brain API 在本次规划阶段不可访问，PrepPRD 显式值优先 -->
- 超时/延迟：触达记录 API 响应 ≤ 2s（只读查询，数据量预期小）
- 频控：不涉及（只读视图）
- 版本要求：无特殊版本要求
- 可观测：触达记录 API 查询失败须在前端显示错误提示，不静默吞错

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；Brain API 不可访问，本 line 已知 invariant 从代码上下文推断 -->
- [租户隔离] 所有 API 查询必须按 tenant_id 过滤，触达记录端点不得跨租户返回数据（来源: area）
- [只读视图] 触达记录页本次只展示历史，不提供发送/操作入口（来源: PrepPRD 明确限定）
- [无死链接] Hub 页所有卡片 link 必须指向真实存在的路由，禁止 comingSoon 标签（来源: PrepPRD 验收标准）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: Line02 已完成 ability 的 golden_path；Brain API 不可访问，从 git 最近 PR 推断 -->
- 评论采集闭环：采集任务页支持关键词采集 + 评论列表查看（AcquisitionTasksPage，不改）
- Leads 评分+跟进：LeadsPage 展示评论内容/回复/负责人/评级，留言→人工跟进闭环已实现（不改）
- 小号绑定：AcquisitionAccountsPage 支持绑定/解绑抖音小号，状态可见（只删昵称列，不改其他）
- 指派调度：buildAssignments 真实调度已在 API 层实现（本次从设置页移出 UI 块，调度逻辑本身不改）

## E2E 验收

> proposer 在 GAN 阶段按 target_environment=windows_cloud 产出完整 Playwright .spec.ts 脚本。

```bash
# 占位：proposer 将填入 Playwright spec（windows_cloud = GitHub Actions windows-latest runner）
# 期望验收点（自然语言）：
# 1. 登录后进入 /area/acquisition → Hub 页显示 4 张卡片（绑抖音小号/采集/看线索/触达记录），无"即将上线"标签
# 2. 点「绑抖音小号」→ 进入账号管理页，DOM 中不存在"抖音昵称"列头文本
# 3. 点「看线索」→ 进入 Leads 页（URL 含 /leads），页面有内容（或空状态提示）
# 4. 点「触达记录」→ 进入触达记录页，显示列表或"暂无触达记录"空状态（不报 500/404）
# 5. 有独立「设置」入口 → 进入 AcquisitionConfigPage，页面只显示参数配置表单，无"指派计划"区块
# 6. CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 前端页面 IA 改动，用户通过浏览器操作 Dashboard
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard UI 测试统一走 GitHub Actions windows-latest runner（干净 VM，无历史状态）
## journey_id: line02（客户智能获客路径；Brain API 不可访问时按 PrepPRD 锚定）
## step_id: L02-outreach-viz（触达记录可视化 — 抖音私信主动触达 feature planned→working）
