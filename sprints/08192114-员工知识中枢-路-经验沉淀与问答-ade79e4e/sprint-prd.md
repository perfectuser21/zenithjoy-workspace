# Sprint PRD — 员工知识中枢 路① 经验沉淀与问答

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（Line 11 员工知识中枢新线，GP `knowledge_experience_qa`）
- **当前进度**：82%
- **本次推进预期**：+2%（沉淀→问答→注入三步闭环骨架落地）

## 背景

主理人 2026-08-19 拍板（决策 `ab866172`）：自建员工知识中枢替代 Notion，作为团队知识底座。
路①要兑现的承诺：**人或 agent 产生经验 → 之后团队任何人和任何 agent 都问得到，并在干活前被强制喂到 —— 且喂的只会是仍然成立的经验**。
承诺终态全部落在 Staff Hub 屏幕上（base_repo=zenithjoy），cecelia 作跨仓依赖仓（SSOT 账本 + agent 注入点）。

## Golden Path（核心场景）

入口：人或 agent 干完一次真实活，产生一条经验
→ 系统自动沉淀成型（质量分档 + 卫生闸 + 归属/可见性）并落库
→ 团队任何人用大白话问，拿到带出处的答案
→ agent 开工前被强制喂到仍然成立的经验
出口：主理人在开工簿看到本次喂了哪几条、每条被用过多少次，并能一键关掉注入

具体（3 步）：
1. **S1 经验被留住**：员工/agent 干完活不用刻意记录 → 系统自动抓取、分档、过卫生与归属闸后落库 → 本人在 Staff Hub「最近沉淀」**提交后 30 秒内**看到自己这条已成型的经验，带可点击的证据链接。
2. **S2 问得到**：团队任何人用大白话提问 → 语义检索命中仍成立（`status=active`）的经验 → 返回带出处链接的答案；**「库里还没有」与「检索暂时查不了」是两种明确不同的回答**，后者禁止静默降级成前者。
3. **S3 干活前被喂到**：agent 开工 → 系统按任务上下文 + 组织，把 active 且未被取代的经验注入 prompt（高危经验须人审才进池）→ 主理人在开工簿看到这次喂了哪几条、每条历史被用过多少次，**并能一键关掉注入**。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- **已证伪/已标废经验绝不注入**（全路最重）；标废后 5 分钟内同一问题不再返回该条。
- 带毒/高危经验（触及生产/DB/凭据/删除/发布）被高危检出拦在注入池外，人审通过才进。
- 跨企业经验绝不混读/混写；身份不可伪造 —— 知识端点只信服务端会话，源码不读身份头。
- 员工登录后拿不到组织 → 403 `NO_TENANT`（与 401「登录已失效」文案不同）；无组织归属声明 → 403 `NO_ORG_ASSIGNMENT`；均 fail-closed，绝不落默认/个人租户兜底。
- embedding 断供 → 显式失败而非静默 no-op；问答降级为「检索暂不可用」。
- 注入服务不可达 → fail-open，任务照跑，`injection_status=failed` 留痕可重放。

## 范围限定

**在范围内**：S1 沉淀 +「最近沉淀」可见；S2 带出处问答（含「没有 vs 查不了」两态）；S3 开工注入 + 使用台账 + kill switch/影子模式；组织→部门→角色底座与跨企业硬隔离；身份会话化（`knowledgeAuthGuard` + feishu-login 签发会话）；带组织维度的员工目录；存量 ≥200 条精选迁移；G2 卫生 fail-closed（DB 层 trigger）。
**不在范围内**：路②协同笔记 / 路③结构化工作台；经验被用后自演化（归下一条路）；super-admin 会话化；`capture_atoms` 积压清理；既有 16 个 `staffGuard` 端点改会话（属改既有鉴权，须另开 PR）。

## 假设

- [ASSUMPTION: embedding 部署形态由 Gate G0-A 决策拍板（REC=本地模型 bge-small，向量化不出网），未落 decisions 前不开 Sprint C。]
- [ASSUMPTION: 语义索引落 cecelia 库、zenithjoy 侧只读投影 + API 反代；跨企业过滤在 Brain 侧 SQL 执行，禁 zenithjoy 侧取全量再过滤。]
- [ASSUMPTION: 两家企业同一飞书租户则 open_id 单命名空间成立；若分属两租户须升为 (app_id, open_id) 复合键，实施第一步先确认并回写 decisions。]

## 预期受影响文件

- `apps/staff-hub/src/*`：录入 UI /「最近沉淀」/ 问答 / 开工簿四屏（读实时源）
- `apps/api/src/routes/staff.ts`：新增知识端点 + `feishu-login` 改签发服务端会话并按声明组织入驻
- `apps/api/src/middleware/knowledgeAuthGuard.ts`（新）：只信 better-auth session，无 header 回落
- `apps/api/src/env-registry.ts`：分组白名单 env（`STAFF_EMAILS__<ORG>` 等）+ `STAFF_ORG_MAP`
- `(cecelia) packages/brain/*`：`learnings` 生命周期列 + 归属三列 + 卫生列 trigger + 写入闸 + 14 处写入点收编 + 投影管线 + 注入点分类改造 + kill switch/台账

## NFR 约束

<!-- 来源: decisions category=nfr 双源均空；下列为 PrepPRD 显式值 -->
- 超时/延迟：「最近沉淀」提交后 30 秒内可见；端到端问答 P95 < 基线 + 2.5s 且绝对值 < 5s（Gate G0-B，hk-vps 容器内采基线）
- 频控/成本：运行期第三方调用月度 cap = **$60/月**（决策 J19），配置读不到按 cap=0 停机（fail-closed）
- 向量化不出网：embedding 走本地模型（G0-A 分支①，断供 `OPENAI_API_KEY` 后仍成功）；若走分支② 须脱敏后 0 命中 + 书面降级该 lifeline
- 可观测：注入失败必写 `injection_status`（fail-open + 强制留痕）；`status=active` 池 embedding 覆盖率 ≥95%，低于阈值 CI 报红且问答返回「索引未就绪」
- 版本要求：无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 两源 + capability 红线 -->
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [多租户测试] 单元/E2E 测试默认种 ≥2 个租户并断言互不串（来源: area）
- [跨企业硬隔离] 员工只问得到 / 被喂到本组织仍成立的经验；跨企业经验被注入次数 = 0，身份不可由请求头伪造（来源: capability 决策 ab866172 第 2 条）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史 —— 员工知识中枢为新 line，本 ability 为路①首个已签合同）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出（Playwright + 服务端真库断言）。

```bash
# 占位：proposer 将按 windows_cloud（GitHub Actions windows-latest，Staff Hub Playwright）填入真实脚本
# 期望验收点（自然语言）：
#   S1：真跑一个 harness 任务 → cecelia learnings 新增 unverified 行（org_id/author_member_id/visibility 非空）
#       + zenithjoy 投影出现同 content_hash 且 org_id 等于任务上下文声明组织 → Staff Hub「最近沉淀」30s 内可见带证据链接
#   S2：问答页大白话提问 → 出现带出处链接的答案；停 embedding → 出「检索暂不可用」（不等于「库里没有」）
#   S3：预埋 3 条经验真跑任务 → 运行记录 injected_experience_ids 含全部预埋 id 且 ≤ 上限；开工簿显示注入台账；
#       kill switch 关掉后注入=0 且台账 injection_status=disabled；已标废/跨组织经验被注入次数=0
```

## journey_type: user_facing
## journey_type_reason: 承诺三步终态全部落在 Staff Hub 前端可见面（最近沉淀 / 问答 / 开工簿三屏），属 apps/staff-hub UI。
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 任何 UI 走 windows_cloud（GitHub Actions windows-latest 干净 VM，全局死规则）。
## journey_id: da60cb26-5635-4f51-a1f3-a80013f6d69d
## step_id: knowledge_experience_qa:S1,S2,S3（PrepPRD 切刀表锚定 2 刀 3 步）
