# Sprint PRD — 组织与权限底座·多组织切换 第一刀（人侧核心 active_org）

## OKR 对齐

- **对应 GP**：line11/org_context_switch（9eb535b2，status=proposed）
- **冻结 spec**：`.harness/gp-contract-v2.json`（version 1 已签，hash d4e93625）——本 PRD 只锚定第一刀 scope，断言原文以合同为准（proposer 从合同倒推 DoD/测试，不得放宽）。
- **本次推进预期**：Step1 选定 / Step2 隔离读写 / Step3 原子切换 三步骨干全落，Gate 0 四处同刀放开，人侧多组织跑通上 staging。

## 背景

现网四道 fail-closed/旁门共同禁止「一个账号归属 ≥2 家企业」：workbench-auth rows>1→409、knowledge-auth ORDER BY created_at LIMIT1 静默取最早、single-org-selfcheck 多组织即拒启动、selfHealOwnerMember license LIMIT1 自动补行。主理人真实归属两家（悦升云端 aedac4f8 / 金诺盛源 f66a26f8），补第二条 tenant_members 行会直接触 A11 让 apps/api 起不来。本刀受控反转，给账号引入服务端会话态 `active_org` 维度，让用户主动选定当前企业并可随时切换、跨企业数据严格隔离。

## Golden Path（核心场景）

员工用飞书账号登录 Staff Hub（已被 admin/手动供给多行归属）→ 主动选定当前企业 → 在该企业下建表录数问答切视图（读写严格落这家）→ 随时切到另一家、旧企业数据即刻不可见。

具体：
1. 登录后看到自己**全部**已供给归属企业列表；归属 0 家→NO_TENANT；1 家→透明进入不弹选择器（零回归）；≥2 家未选→停下要求先选、系统**绝不自动挑**；顶部常驻显示「当前企业=X」。
2. 选中企业下建表/录数/问答/切视图，组织归属只来自服务端可信 `active_org`（绝不取自请求头/体），每请求对 LIVE 成员集实时重校；`active_org` 缺失/伪造→全挡；成员被移除→当次挡并清 `active_org`。
3. 随时切换：`POST /switch-org` 校验目标 ∈ 该成员 tenant_members 集合、原子重解析视图、旧企业数据即刻不可见（active_org=A 时 GET B 的表 id 返 404，切到 B 后 GET A 的表 id 也返 404）；切换非原子失败→回滚提示「仍在 A」；有未提交草稿→拦截提示保存；其它 tab reload/锁定前同样先跑草稿检查、不静默丢失。

## 断言映射（第一刀落哪些，原文见合同）

在范围（proposer 从 gp-contract-v2.json 倒推 [BEHAVIOR]/[ARTIFACT]）：
- A1 反枚举同形 404 / A3 正向对照 psql tenant_id 全=A / A4 缺失+伪造全挡 / A5 第二家 B 四类各一 L2 写入 tenant_id=B 且 A 读不到 / A6 切换原子性+旧数据即刻不可见 / A7 LIVE 成员实时重校 / A8 单企业零回归 / A10 静态守卫（域=路③+新增 org 中间件，**不含 agent-context**）/ A11 org 审计中间件自动副作用 / A12 启动自检双向变异（维度齐备正常启动、维度缺失拒绝启动）。
- 8 条 proven-to-fire 变异：A1/A4/A7/A10/A11/A12 落本刀（A2/A9 见下不在本刀）。

## 范围限定

**在范围内**：apps/api 新增 better-auth session `active_org` 字段（J7 载体）+ 归属企业列表端点 + `POST /switch-org` 原子切换 + admin/手动 org 供给端点（J8）+ 每请求 LIVE 成员重校 + org 审计中间件；改 workbench-auth（rows>1→选 active_org 并解析，其余护栏一行不改）/ knowledge-auth（LIMIT1→按 active_org 解析）/ single-org-selfcheck（反转为校验维度齐备）/ staff-directory（A30-2 归属唯一放开）/ selfHealOwnerMember 退役（Gate 0 四处同刀）；apps/staff-hub 企业切换器 + 顶部当前企业标识 + AuthContext org 维度 + 多 tab reload 前草稿拦截。A10 静态守卫扫描域=路③ + 新增 org 中间件。

**不在范围内（后续刀）**：命门④ agent-context.ts body.agent_id 旁门退役 + internal-auth org 维度（Gate 1，A9/A10 的 agent-context 扩域）；命门③ tenant-context 的 X-Feishu-User-Id/X-Bypass-Tenant/tenantContextOptional body 三旁门退役 + works/fields/credits/acquisition/agent-machines 家族十余路由迁移（A2 对 works 家族的旁门注入变异随该刀落）；feishu-login 一般员工自动多行供给（P2-6）；dept/role 层（P2-2）。

## 边界情况

- 归属 0/1/≥2 家三分支；伪造 active_org=C（不归属）；成员会话有效期内被移出；切换非原子失败回滚；在途旧 org 写不得落新 org；多 tab 未提交草稿 reload 前拦截；单企业账号透明进入零回归。

## 假设

- [ASSUMPTION: staff-hub 现有登录/AuthContext 可扩 org 维度而不重写鉴权；better-auth session 支持附加自定义字段（J7 已在合同拍板为载体）]
- [ASSUMPTION: staging DB 已有两租户悦升云端 aedac4f8 / 金诺盛源 f66a26f8，可造人造双企业成员行验证 A12（Gate 0 先 staging 后生产）]

## 预期受影响文件

- `apps/api/src/middleware/workbench-auth.ts` / `knowledge-auth.ts`：命门①② 第四态改造
- `apps/api/src/middleware/tenant-context.ts`：仅退役 selfHealOwnerMember（三旁门后续刀）
- `apps/api/src/startup/single-org-selfcheck.ts` + `index.ts`：启动自检反转
- `apps/api/src/staff-directory.ts`：A30-2 归属唯一放开
- `apps/api/src/routes/`（新增 orgs 列表 / switch-org / admin 供给）+ 新增 org-audit 中间件 + active_org 会话字段
- `apps/staff-hub/src/`：企业切换器 + 当前企业标识 + AuthContext + 多 tab 草稿拦截
- `.github/workflows/`：A10 守卫扩域（路③+org 中间件）+ staff-hub windows_cloud E2E 嵌横切断言

## NFR 约束

<!-- 来源: gp-contract-v2.json yield_order + release_and_blast_radius；PrepPRD 显式值优先 -->
- 安全/资金正确性 > 数据一致性 > 功能完整 > 性能 > 体验顺滑（yield_order）
- fail-closed：active_org 缺失/伪造/越成员集合一律拒绝不默认；成员校验每请求实时（禁登录时一次性快照）
- Gate 0：staging 带人造双企业成员行验证 apps/api 正常启动 + A1/A4 全绿后才碰主理人真账号；绝不直接改生产 tenant_members
- 可观测：org 解析/切换/越权 deny 必落审计行（中间件自动副作用）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（area 级）+ 路①/路③ 已验收隔离闸 -->
- [租户隔离] 路①知识/路③工作台已验收的跨企业隔离绝不可被本刀破坏——一个企业员工永不可读写另一企业数据（workbench-auth.ts 注释：判据一旦可伪造，隔离与表级可见性同时失效）
- [身份 session-only] 组织归属只来自服务端会话/凭据，绝不从请求头/体取；引入 X-Org-Id 类请求头当场触 A10/A2 报红
- [凭据不混用] 多人协作禁止混用授权凭据，操作他人账号资源须用其本人授权（area 级，agent 凭据层，本刀只落人侧 org 层）
- [反枚举同形] 跨组织不可达与不存在返逐字节同形 404（notFoundBody() 不带 timestamp）
- [正反成对] 反向 403/404 串必与正向对照同次运行成对执行，psql 查回落库 tenant_id，防「一律拒绝」假绿

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: line11 员工知识中枢已合并 PR（journey golden-paths 端点空返，据 handoff 补） -->
- 路①经验沉淀与问答: 飞书登录签会话 → 按企业落成员行(无归属403) → 知识录入落账本 → 「最近沉淀」页 → 跨企业隔离(knowledgeAuthGuard) → A30 员工目录自检
- 路③结构化工作台: S1建表 → S2录数据(行级乐观锁409+软删回收站) → S3视图看板(view-prefs四端点) → S4跨表关联(relation字段+反向引用) → 全程组织隔离(workbenchAuthGuard rows>1→409)

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 按 target_environment=windows_cloud 产出（staff-hub 真浏览器 Playwright + apps/api vitest 后端断言）。

```bash
# 占位：proposer 按 windows_cloud 填 Playwright(.spec) + apps/api vitest 后端断言脚本
# 期望验收点（自然语言）：
#  1. 双企业账号登录 staff-hub → 看到两家列表、未选前进不去任何数据 → 主动选定 A → 顶部显「当前企业=A」
#  2. A 下建表录数 → psql 查回 tenant_id=A；GET B 的真实表 id → 404 与随机不存在 id 逐字节同形
#  3. 切到 B → 立即 GET A 的表 id → 404；B 下建表录数 → tenant_id=B、A 会话读不到
#  4. 单企业账号透明进入不弹选择器、全链读写逐字回归(A8)
#  5. apps/api 带人造双企业成员行 + active_org 维度齐备 → 正常启动；维度缺失 → 拒绝启动(A12 双向)
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/staff-hub 常驻 Web UI（企业切换器+当前企业标识），用户可见交互终态
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 任何 UI/Dashboard 走 windows_cloud（GitHub Actions windows-latest 干净 sandbox，全局 E2E 环境路由死规则）
## journey_id: da60cb26-5635-4f51-a1f3-a80013f6d69d
## step_id: none（横切件，锚 line11/org_context_switch#step1，无独立 journey_step UUID）
