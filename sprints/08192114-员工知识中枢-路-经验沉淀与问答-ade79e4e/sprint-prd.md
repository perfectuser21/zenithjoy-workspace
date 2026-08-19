# Sprint PRD — 员工知识中枢 路① 经验沉淀与问答

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线（员工知识中枢 Staff Hub 面）
- **当前进度**：77%
- **本次推进预期**：+3%（打通 S1→S2→S3 三步骨干的可观察终态）

## 背景

主理人 2026-08-19 拍板（decision `ab866172`）：自建替代 Notion 的团队知识底座。本路①承诺 =
**人或 agent 产生经验** → 之后**团队任何人和任何 agent 都问得到**，并在**干活前被强制喂到** —— 且喂的只会是**仍然成立的经验**。
Capability `ade79e4e`，Value Stream line11「员工知识中枢」，本路是该 line 首条 Golden Path。

## Golden Path（核心场景）

用户/系统从 [产生经验] → 经过 [沉淀入库·可问答·开工注入] → 到达 [开工簿看到喂了哪几条并可一键关闭]。

- **S1 沉淀**：员工或 agent 干完活不用刻意记录，本人在 Staff Hub「最近沉淀」**30 秒内**看到自己这条已成型的经验，带可点击的证据链接（PR/task）。
- **S2 问答**：团队任何人用大白话提问，拿到**带出处链接**的答案；「库里还没有」与「检索暂时查不了」是两种明确不同的回答。
- **S3 注入**：agent 开工时**相关且仍然成立的旧坑已经在它手里**（只喂 `status=active`、未被取代、未过期的经验）；主理人在开工簿看得到这次喂了哪几条、每条被用过多少次，并能**一键关掉注入**（kill switch / 影子模式）。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- **身份伪造**：只带请求头冒充授权角色 → 401/403，不生效（身份只认服务端会话）。
- **跨企业**：企业B 身份读知识面 → 与企业A 数据交集为空；且不得触达企业A 既有 16 个 staffGuard 端点。
- **并发同源写入**：同源多条并发 → 库内 1 条或带合并标记（需先建 unique 约束）。
- **对抗输入**：经验正文含注入指令 → 被 untrusted 包裹/转义 + 高危检出拦在注入池外。
- **检索失效**：embedding 断供 → 明确回「查不了」，禁止静默降级成「库里没有」。

## 范围限定

**在范围内**：S1 录入 + 「最近沉淀」实时可见；S2 带出处问答 + 「没有 vs 查不了」两态；S3 开工强制注入 active 经验 + 注入台账 + kill switch；跨企业硬隔离与服务端会话身份底座；G2 信息卫生 DB 层闸；SSOT 单向投影。
**不在范围内**：经验被用后自演化/反刍（归下一条路）；路②协同笔记、路③结构化工作台；给既有 `staffGuard` 加组织维度（改既有鉴权，另开 PR）；super-admin 会话化。

## 假设

- [ASSUMPTION: embedding 部署形态（本地模型 vs 白名单+脱敏）由 Gate G0-A 拍板落 decisions 后才开 S2 索引落地。]
- [ASSUMPTION: 两家企业若分属两个飞书租户，join 键升为 (app_id, open_id) 复合键（P2#22，实施第一步确认）。]
- [ASSUMPTION: 本路跨仓 —— base_repo=zenithjoy（承诺终态在 Staff Hub 屏幕），SSOT 与 S3 注入点在 cecelia，按 Sprint A/B/C/D 显式派单。]

## 预期受影响文件

- `apps/staff-hub/`：S1 录入 UI +「最近沉淀」+ S2 问答 UI + 开工簿视图。
- `apps/api/src/routes/staff.ts`、`apps/api/src/middleware/knowledgeAuthGuard.ts`（新建）：知识端点 + 会话身份底座。
- `apps/api/src/routes/staff.ts`（feishu-login）：签发服务端会话 + 按员工目录声明入驻组织。
- cecelia `packages/brain/*`：learnings 生命周期/归属/卫生列 + 写入闸 + 投影管线 + S3 注入点分类改造 + 台账/kill switch。

## NFR 约束

<!-- 来源: PrepPRD 显式值（主源）；decisions category=nfr 副源本 sprint 为空 -->
- 检索性能：端到端问答 P95 < 基线 + 2.5s 且绝对值 < 5s（Gate G0-B）。
- embedding 覆盖率：`status=active` 池与最近 90 天写入均 ≥95%，低于则 CI 红且 S2 返回「索引未就绪」（A24）。
- 运行期成本 cap：第三方调用月度 = $60/月，写入 decisions，端点从配置读；读不到配置按 cap=0 停机（fail-closed，J19）。
- 向量化出网：默认「不出网」（本地 embedding，G0-A REC 分支①）；若走分支② 则脱敏后出网并书面降级该 lifeline。
- 时效：「最近沉淀」30 秒内可见；标废 5 分钟内不再进新上下文；S3 注入失败 fail-open 且 `injection_status` 必写。
- 人审 SLA：高危待审积压上限 30 条、单条 7 天，超上限新条目不排队直接标 unverified（J7）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（area 级 [系统] 8 条）+ 本路签字合同 lifeline（journey_feature 级，decision ab866172）；[capture-triage]/[agent-offline-alert] 属 harness/CI 区，非本产品路铁律，未注入 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户绝不混读/混写（来源: area）
- [测试默认多租户] 单元/E2E 默认种 ≥2 个租户并断言互不串（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的接缝断言必须在真目标上验证过才算 done（来源: area）
- [禁写死环境假设] 屏幕外坐标/阈值/假设 .env 有 Y 等环境假设值禁写死，从环境推导或真机校准（来源: area）
- [单slot串行] 一个 slot/会话内任务严格串行，需要并行用多个 slot（来源: area）
- [跨企业硬隔离] 碰知识数据的查询/写入必须 scope 到组织，跨企业绝不混读/混写（来源: journey_feature，红线）
- [身份不可伪造] 知识端点身份/角色/组织只来自服务端会话，源码不得出现身份头名（来源: journey_feature）
- [卫生fail-closed] 敏感内容 DB 层 trigger 拦截，绕闸裸 INSERT 必失败（来源: journey_feature）
- [只喂成立经验] 只注入 status=active 且未被 superseded 且未过 valid_until 的经验（来源: journey_feature，全路最重）
- [外部原文不可注入] 含外部原文的经验默认不可注入，只可被人查询（来源: journey_feature，防投毒）
- [SSOT单向] Cecelia 账本唯一真相，团队库只读投影，禁双向同步（来源: journey_feature）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey da60cb26 查询返回空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出（GitHub Actions windows-latest + Playwright），并回填组织隔离/会话身份/注入台账的真库断言。

```bash
# 占位：proposer 按 target_environment=windows_cloud 填入 Playwright(.spec.ts) + 服务端真库(psql/curl) 脚本
# 期望验收点（自然语言）：
# S1 —— 真跑 harness 任务后本人在「最近沉淀」30 秒内看到该条(带真实 PR/task 链接)，两库(cecelia+zenithjoy 投影)各查到且 org_id 非空
# S2 —— 大白话提问返回带出处链接答案；停 embedding 时返回「查不了」而非「库里没有」
# S3 —— 预埋经验在开工任务运行记录 injected_experience_ids 命中；关 kill switch 后注入=0 且台账留 disabled 痕
# 隔离 —— 企业B 真实会话读知识面与企业A 交集为空，且逐个调 16 个既有 staffGuard 端点均 403；企业A 同法调用须 200
```

## journey_type: user_facing
## journey_type_reason: 承诺终态在 Staff Hub（apps/staff-hub）员工/主理人可感知的录入·问答·开工簿三个页面上。
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 任何 UI 走 windows_cloud 全局死规则，E2E 在 GitHub Actions windows-latest 干净 VM 跑 Playwright。
## journey_id: da60cb26-5635-4f51-a1f3-a80013f6d69d
## step_id: knowledge_experience_qa#step1
