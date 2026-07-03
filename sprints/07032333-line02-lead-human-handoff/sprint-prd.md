# Sprint PRD — Line 02 留言→人工跟进闭环（评论回复捕获 + 负责人 + Dashboard统一leads表）

## OKR 对齐

- **对应 KR**：Line 02 客户智能获客采集闭环（journey line02）
- **当前进度**：Step 5 评论区触达已通，Step 6 人工跟进闭环 not_started
- **本次推进预期**：Step 6 thin — 捕获公开回复 + 负责人分配 + Dashboard统一表

## 背景

系统已能发评论+私信，但完全没有捕获"对方是否回复了"的机制。飞书 Lead 表没有"最新回复"和"负责人"字段，运营无法判断谁在回应、该谁跟进。同时 Dashboard 存在两套独立 leads 表实现（LeadsPage + AcquisitionTasksPage 内嵌子表），字段不一致；"触达状态"列硬编码"—"，无任何真实数据。

## Golden Path（核心场景）

**入口**：系统定时轮询已触达 lead 的对应视频评论区

**步骤**：

1. 轮询时从 `acquisition_leads` 取已触达（有 `comment_replied_at`）的 lead → 查其 `source_video_ids` 对应视频评论区 → 找到对方昵称对我方评论的公开回复
2. 找到回复 → 写入 `acquisition_leads.latest_reply`（TEXT，最新一条） + `latest_reply_at`（timestamptz） → 更新飞书 Lead 表"最新回复"列
3. 新 Lead 落库时 → 从配置项 `assignee_roster`（占位名单，初始 2 个占位账号）按当天 lead 计数取模轮询 → 写入 `acquisition_leads.assignee` → 写入飞书 Lead 表"负责人"列
4. 运营打开 Dashboard Leads 页 → 看到统一的 `<LeadsTable />` 组件（LeadsPage 和 AcquisitionTasksPage 内嵌子表共用同一实现）→ 列：昵称 / 评论内容 / 最新回复 / 负责人 / 来源视频 / 评级 / 时间
5. "触达状态"列已删除（AcquisitionTasksPage 内嵌子表中硬编码"—"的那列）

**出口**：运营在飞书 Lead 表看到"最新回复"和"负责人"两列有真实数据；Dashboard 只有一套 leads 表

**失败路径**：

- 捕获到回复但对应 lead 在 DB 中找不到（被删除/sec_uid 不匹配）→ 写入 `acquisition_orphan_replies` 日志表（video_id, commenter_nickname, reply_text, captured_at），不崩溃

## 边界情况

- 对方未回复 → `latest_reply` 保持 NULL，飞书"最新回复"列留空，不写"—"
- 占位负责人名单为空 → assignee 写 NULL，记 warn 日志，不阻断 lead 写入
- 飞书 API 写列失败 → lead 已落 DB，飞书写失败记 `feishu_write_status=failed`，可重试
- 同一 lead 多条回复 → 只取最新一条（按 reply 时间降序取第一条）写 `latest_reply`

## 范围限定

**在范围内**：
- 评论区公开回复捕获（检查对方对我方评论的回复）
- acquisition_leads 加 latest_reply / latest_reply_at / assignee 三字段（DB migration）
- 新 lead 落库时按占位名单轮询写 assignee
- 飞书 Lead 表写"最新回复"和"负责人"两新列
- Dashboard `<LeadsTable />` 共用组件（LeadsPage + AcquisitionTasksPage 内嵌表合一）
- 删除 AcquisitionTasksPage 内嵌子表的"触达状态"列
- 孤儿回复日志表（acquisition_orphan_replies）

**不在范围内**：
- 私信收件箱回复抓取（风控风险高）
- 真实客服人员名单接入（先用占位，用户后续在飞书改）
- 负责人认领/转移 UI（后续 sprint）
- 触达状态字段的真实数据回填（删字段，不做计算）

## 假设

- [ASSUMPTION: 占位负责人名单通过配置项 `ASSIGNEE_ROSTER` 环境变量注入，格式 JSON 数组，默认值 `["客服A","客服B"]`]
- [ASSUMPTION: 评论区回复轮询复用现有 collect task agent 的抖音 session，不新增账号]
- [ASSUMPTION: 飞书 Bitable "负责人"和"最新回复"列在飞书侧手动预建，系统通过列名匹配写入]
- [ASSUMPTION: AcquisitionTasksPage 内嵌 leads 子表与 LeadsPage 展示同一 `/api/acquisition/leads` 端点数据]

## 预期受影响文件

- `apps/api/db/migrations/<timestamp>_leads_reply_assignee.sql`：加 latest_reply / latest_reply_at / assignee 字段 + orphan_replies 表
- `apps/api/src/routes/acquisition.ts`：GET /leads 返回新字段；POST/PATCH 支持 assignee 写入
- `apps/api/src/services/acquisition-dispatch.ts`：新 lead 落库时轮询 assignee
- `services/agent/src/line02/`：采集任务增加回复轮询逻辑
- `apps/api/src/services/feishu-lead-writer.ts`（或同层文件）：飞书写入补"最新回复"+"负责人"列
- `apps/dashboard/src/components/LeadsTable.tsx`：新建共用组件
- `apps/dashboard/src/pages/LeadsPage.tsx`：改用 `<LeadsTable />`
- `apps/dashboard/src/pages/AcquisitionTasksPage.tsx`：内嵌子表改用 `<LeadsTable />`，删"触达状态"列

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：待定（PrepPRD 未指定，评论区轮询建议 ≤30s/次）
- 频控：评论区回复轮询复用现有抖音 session 频控约束
- 版本要求：（无新增）
- 可观测：孤儿回复必须写 acquisition_orphan_replies 日志，不得静默丢失

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，本 line 历史已确认规则 -->
- [租户隔离] acquisition_leads 所有查询必须带 tenant_id 过滤，禁止跨租户读写
- [防假成功] 飞书写入失败不得返回 200/成功状态，必须反映在 feishu_write_status 字段
- [数据不丢失] 孤儿回复必须落 acquisition_orphan_replies，不得静默丢弃

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: Line02 已完成 sprint 的 golden_path 摘要 -->
- 公司信息页：填写+保存+持久化，3 Tab，租户隔离 ✅
- 采集任务：关键词触发 pending→running→done/partial，acquisition_collect_tasks 状态机 ✅
- 主号采集全链：keyword-search→视频→评论→commenter→acquisition_leads 写库 ✅
- 飞书文档扩词：enterprise_doc_token 读 docx 纯文本扩词关键词 ✅
- 机器感知路由：burner 账号自动路由，Dashboard 机器感知 ✅
- leads 跨租户隔离：GET /leads 强制 tenant_id 过滤，修复跨租户泄露 ✅

## E2E 验收

> 占位区块，proposer 在 GAN 阶段按 target_environment=windows_cloud 写入可执行 bash/ps1 脚本。

```bash
# 期望验收点（自然语言，proposer 翻译成命令）：
# 1. DB 迁移成功 — acquisition_leads 含 latest_reply / latest_reply_at / assignee 三列
# 2. 新 lead 落库时 assignee 非空（按占位名单轮询）
# 3. 模拟"对方回复评论"数据 → 轮询逻辑写入 latest_reply
# 4. GET /api/acquisition/leads 返回 latest_reply + assignee 字段
# 5. 飞书 Lead 表"最新回复"+"负责人"列有真实数据（curl feishu bitable API 验证）
# 6. CI 全绿（LeadsTable 组件单元测试 + migration smoke）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ LeadsPage + AcquisitionTasksPage 前端 UI 合并
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard 统一走 GitHub Actions windows-latest runner（干净 VM sandbox）
## journey_id: line02
## step_id: L02-S6
