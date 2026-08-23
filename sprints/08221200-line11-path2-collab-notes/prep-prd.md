# Sprint PRD — 员工知识中枢 路② 协同笔记/文档 · 第一刀（S1+S2+S3 单 org 端到端可用）

## OKR 对齐

- **对应 Journey/GP**：line11 员工知识中枢 / capability `collaborative_docs`（GP golden_paths=`301bd18f-ba56-4e57-b99f-3d0a1e90fad5`，journey=`da60cb26`，status=candidate）
- **当前进度**：collaborative_docs 0%（净新建 documents 域）
- **本次推进预期**：骨干 5 步的前 3 步（S1 写留 / S2 CRDT 实时协同 / S3 权限三档）落地，单 org 端到端可用；S4/S5（AI 读/写回）留后续刀

## 背景

路② 要让员工在 Staff Hub 里写文档、多人实时协同、按组织权限管住，替代 Notion 的协同文档能力。合同 v2 已签（version 1，pending_action 64a52575 approved，hash 47a8bf4c）。本刀是骨干第一刀：把「文档写得出留得住 + 多人字符级不打架 + 权限管得住」跑通，**不含任何 AI 读/写回**。碰四类真实接缝：生产 DB（文档=企业核心资产）、跨企业多租户真墙、WS 长连真机、富文本存储型 XSS 面 —— 故 S2 承诺 L3 真机真验。

## Golden Path（核心场景 · 单 org 端到端）

**GP-Anchor: line11/collaborative_docs#step1**

1. **S1 文档写得出、留得住**：员工在文档树某节点点「新建」→ 写富文本正文（标题/段落/列表/勾选/代码块/内嵌图片引用/@提及文档）→ 自动保存 → 刷新后仍在，出现在本组织文档树；可移动/重命名/软删+30 天回收站；整篇导出 Markdown 拿走。自动保存失败（弱网/500）时编辑器**可见提示且本地草稿保留**，绝不静默丢字。
2. **S2 多人实时协同、字符级不打架**：第二名员工打开同一文档 → 看到对方**多人光标**在哪；两人改**不同段落**字符级自动合并互不覆盖、改**同一句**无静默丢字；断连 → 只读横幅+本地暂存并提示，重连 → 自动 resync 合并。裸 WS 客户端注入非白名单节点 → 服务端 CV 在落库前拒绝，crdt_state/content jsonb 均不含该节点。
3. **S3 文档按权限管得住**：员工在文档/文件夹设可见+可编辑范围（组织可见 / 指定成员集合 / 仅自己 三档），沿树继承取 most-restrictive；无权者在 **树 / 搜索 / 打开 / 导出 / @提及 / 协作准入 六处**（本刀不含 AI 检索，那是 S4）全部拿不到（统一 404 同文案同形状）；指定成员集合命中后 live 校验该 member 仍属本 org；权限查询失败 fail-closed 503 不降级为可见。

**出口**：第一人建档写存刷新在 → 第二人实时协同字符级合并+多人光标 → 设「仅自己」→ 第三人打不开/搜不到/进不了协作。

## 边界情况

- 自动保存失败：编辑器可见提示 + 本地草稿保留（不得继承 CustomerListPage 全量重拉掩盖失败）。
- @提及/无权 id：统一 404 不泄标题（反枚举）。
- 多 org 成员（tenant_members 命中 rows.length>1）：WS 握手拒绝不建房，**绝不取 rows[0]**；前端可读提示（体验项）。
- 会话失效：下一 ping 周期/写操作断连重验，长连不静默续命。
- 内嵌图片：禁 base64 入 JSONB，走对象存储只存引用。
- 私密文档移进更宽父级：不自动放宽，需二次确认（fail-safe 继承）。

## 范围限定

**在范围内**：S1（documents 表 + TipTap 跨 app 移植进 staff-hub + schema 白名单 + 树/自动保存/软删回收站/Markdown 导出）；S2（Yjs + y-prosemirror + awareness 多人光标 + `/collab-ws` 手写 cookie 会话握手 + 多 org 拒绝 + 会话失效断连重验 + CV 服务端 schema 校验 + crdt_state/content 双写 + 断连降级 resync）；S3（三档可见/可编辑 + most-restrictive 继承 + 六处过滤 + member live 校验 + fail-closed 503）；G2 备份恢复演练。

**不在范围内**：S4/S5（AI 读/AI 写回、检索器、opt-out AI 检索开关、A5/A6）；Notion/飞书导入；@人通知；模板建档/过期提醒；评论/内嵌 database/版本全量回滚；多 org **正常协同**（active_org 未定，本刀只保证 fail-closed 拒绝不越权）。

## 假设

- [ASSUMPTION] 文档端点挂在既有 `apps/api/src/routes/workbench.ts`（已 `router.use(workbenchAuthGuard)`，复用 G0 组织底座），路径前缀 `/api/workbench/documents`。具体 Response Schema 由 proposer 在合同定稿，本 PRD 只框行为。
- [ASSUMPTION] WS 协作通道路径 `/collab-ws`，独立于 `/agent-ws`；抄 agent-ws.ts 的 `ws` 库 noServer+upgrade+ping 模式，鉴权换手写 cookie 会话解析（`auth.api.getSession({headers: fromNodeHeaders(upgradeReq.headers)})` → tenant_members 真查）。
- [ASSUMPTION] 服务端 schema 白名单为单一实现（HTTP 保存 / CRDT-CV 共用同一函数），本刀无 AI 写回故仅二路复用。
- [ASSUMPTION] active_org 多组织模型未定：本刀验收下限=单 org 成员端到端可用 + 多 org fail-closed 拒绝不建房不越权；**禁替 multiorg agent 猜 active_org 语义**。

## 预期受影响文件

- `apps/api/src/routes/workbench.ts`：新增 documents CRUD/树/搜索/导出/移动/软删恢复/可见性端点（挂既有 workbenchAuthGuard）。
- `apps/api/src/services/collab-ws.ts`（净新增）：`/collab-ws` 手写握手 + 协作房 + CV 校验 + 多 org 拒绝 + 会话失效断连重验；`apps/api/src/index.ts` wire `attachCollabWS(server)`。
- `apps/api/src/workbench/document-schema.ts`（净新增）：ProseMirror schema 白名单（节点+mark 属性协议白名单：link href 仅 http/https/mailto，image src 禁 javascript:/data:，禁 raw HTML），HTTP 保存与 CRDT-CV 共用。
- `apps/api/src/workbench/document.service.ts`（净新增）：documents DAO + most-restrictive 继承解析 + 六处过滤 + member live 校验 + fail-closed。
- DB migration：新建 `zenithjoy.documents`（id UUID / org_id NOT NULL / parent_id / title / owner_member_id / visibility / content jsonb / crdt_state bytea / ai_retrieval_opt_out bool DEFAULT false / deleted_at）+ 可见成员集合表（member_ids）。
- `apps/staff-hub/src/**`：文档树 UI（复用 @dnd-kit）+ TipTap 3.x 跨 app 移植（照路③ AG Grid 范式）+ Yjs collaboration/cursor 扩展 + 权限设置面板 + 自动保存/降级横幅。
- `apps/staff-hub/package.json`：新增 @tiptap/react、starter-kit、extension-image、extension-link、extension-collaboration、collaboration-cursor、yjs、y-prosemirror（版本锁）。
- 备份 cron：documents pg_dump + 恢复演练 job（照路③ G2 范式）。
- **不改** `apps/api/src/routes/knowledge.ts`（路①）与路③ workbench 既有端点（回归面见 A9）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: 合同 gp-contract-v2.json lifelines_and_nfr（class=lifeline）；本刀命中 S1/S2/S3 相关 6 条 -->
- [cross-tenant 隔离] 文档/文件夹/正文/@提及/协作房六层任一伪造 org_id 指向他企业 → 4xx/空集且他企业文档逐字未变；变异改回读身份头/注掉 WS 握手鉴权必转红（来源: area/lifeline①）
- [intra-org 权限] 三档在 树/搜索/打开/导出/@提及/协作准入 六处（本刀不含 AI 检索）全部前置过滤，无权=统一 404，权限查询失败 fail-closed 503 不降级为可见（来源: journey_feature/lifeline②）
- [XSS/SQL 白名单] ProseMirror schema 属性协议白名单收窄渲染 XSS（禁 raw HTML），SQL 注入面参数化物理为零；HTTP 保存 + CRDT/WS（CV：Yjs update apply 后落库前校验派生 doc）共用同一条服务端白名单（来源: journey_feature/lifeline④）
- [WS 握手鉴权] `/collab-ws` 复用 cookie 会话解析、按 (org_id,doc_id) 强隔离、每连接校验 doc 编辑权、无会话不建房；多 org 命中 rows.length>1 拒绝不建房（绝不取 rows[0]）；会话失效即断连重验不静默续命（来源: journey_feature/lifeline⑤）
- [备份可恢复] content jsonb + crdt_state bytea + 关键字段 pg_dump 定时+异地，恢复演练进 cron（来源: journey_feature/lifeline⑦）
- [无静默丢失] CRDT 字符级合并零丢字、自动保存失败编辑器可见并保留本地草稿、断连本地暂存（来源: journey_feature/lifeline⑧）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: line11 已合并 ability，本刀 A9 保护 -->
- 路① 经验沉淀与问答: Step1 knowledgeAuthGuard 身份只来自服务端会话 → Step2 POST /entries 建经验 → Step3 GET /recent、GET /projection CRUD 端点与前端消费链不回归（本刀引入 documents 到共享知识/检索基建后须保持路① 既有 smoke 全绿）
- 路③ 结构化工作台: Step1 workbenchAuthGuard 泛化 knowledgeAuthGuard、多 org fail-closed 409、反枚举 404 无 timestamp → Step2 AG Grid 表/行/视图 CRUD（本刀复用其 auth 底座，不改其既有端点）

## NFR 约束

<!-- 来源: 合同 lifelines_and_nfr + budget_guard；PrepPRD 显式值优先 -->
- 超时/延迟: CRDT 实时延迟/多人光标顺滑度 best_effort（windows_cloud 双会话肉眼实时，非硬门）
- 频控: 不适用（无对外发送）；导出限流留 P2 实现期
- 版本要求: TipTap 3.x + Yjs 版本锁（package.json 锁 + 协作协议版本号，升级须回归 A3）
- 可观测: 自动保存失败/断连/多 org 拒绝/会话失效/CV 拒绝 均须有可见信号（前端提示或服务端 log），失败不静默
- 预算: total_cost_cap $10 / atom $2 / atom runtime 1800s / parallelism 1

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出（Playwright 双 browser context 模拟两人同编，验字符级合并+多人光标）+ CI vitest（服务端安全断言 A1/A2/A3-b/c/e/A4/A7/A9/A10）。smoke 须 `[CONFIG]` 接线进 CI（spec 进 workflow 清单、smoke 进 smoke-baseline.txt、聚合进 required check）。

```bash
# 占位（windows_cloud Playwright 全链，本刀=A8 的 S1→S3 子集，不含 AI 尾段）
# 期望验收点（自然语言）：
#   建档→写富文本→自动保存→刷新在→第二 context 实时协同字符级合并+多人光标可见
#   →设「仅自己」→第三 context 打不开/搜不到/进不了协作（统一 404）
# 服务端安全断言（CI vitest，local_api 可跑）：A1 cross-tenant 六层 / A2 XSS+SQL+autosave 不静默
#   / A3-b/c/e WS 握手安全 / A4 权限六处+live 校验+fail-closed / A7 备份恢复 / A9 路① 回归 / A10 CRDT-CV
```

## journey_type: user_facing
## journey_type_reason: 头部承诺是 apps/staff-hub 网页端富文本协同编辑器（UI 一等），配套 apps/api 端点与 WS，用户可感知的编辑/协同/权限交互是验收主线
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 任何 UI/Dashboard E2E 死规则走 windows_cloud（GitHub Actions windows-latest 干净 VM，双 browser context 模拟两人同编验 CRDT L3）；服务端安全断言随 CI vitest 在同一 runner 跑
## journey_id: da60cb26（journey；GP golden_paths=301bd18f-ba56-4e57-b99f-3d0a1e90fad5，capability_code=collaborative_docs）
## step_id: line11/collaborative_docs#step1（S1+S2+S3，本刀骨干前 3 步）
