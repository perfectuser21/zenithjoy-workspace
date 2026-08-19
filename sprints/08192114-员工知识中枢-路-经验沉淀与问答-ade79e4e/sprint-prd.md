# Sprint PRD — 员工知识中枢 路① 经验沉淀与问答（thin-slice 第一刀：G4 第零刀 + S1 最小闭环）

## OKR 对齐

- **对应 KR**：line11 员工知识中枢 · GP `knowledge_experience_qa`（GP 合同 v1 已签署，contract_id `bb9bc24c`）
- **当前进度**：0%（新 line，GP 状态 proposed，本 sprint 为第一刀）
- **本次推进预期**：S1 打通至「录入→最近沉淀可见」，G4 身份底座落地并被守卫钉住

## 背景

thin_prd（产品法律，逐字）：**人或 agent 产生经验→之后团队任何人和任何 agent 都问得到,并在干活前被强制喂到——且喂的只会是仍然成立的经验**。

GP 合同覆盖整条路①（S1 沉淀 / S2 问答 / S3 注入）。合同 `release_and_blast_radius.stages` 把第一刀钉死为「S1-g 会话签发 + 员工目录 + 按声明组织入驻 + `knowledgeAuthGuard` + A27/A30 守卫先行落地（**在 A27 与 A30 钉住之前，不允许合入任何知识端点**）」。本 sprint 只做这一刀 + S1 最小闭环。

## Golden Path（核心场景）

员工从 [Staff Hub 飞书登录] → 经过 [服务端签会话 + 按员工目录声明入驻组织 + 录入一条经验] → 到达 [「最近沉淀」页 30 秒内看到本人这条，带证据链接]。

具体：
1. 白名单员工走飞书登录 → 服务端签发会话 cookie（httpOnly; Secure; SameSite=Lax），并在同一事务内按其在员工目录中**声明的那一家企业**写入成员行（J20）；员工目录里查不到归属 → 403 `NO_ORG_ASSIGNMENT`，不建 user、不签会话。
2. 员工打开知识面任一页 → 服务端只从会话解析身份/角色/组织，**任何请求头都不影响判定**；无会话 → 401「登录已失效」；有会话无成员行 → 403 `NO_TENANT`（三种文案各不相同）。
3. 员工在录入界面填「触发条件 + 结论 + 证据链接」提交 → **人或 agent 产生的这条经验**落入 Cecelia 账本（SSOT），带该员工的 org_id 与 author_member_id；缺组织上下文即拒写并回原因码。
4. 员工打开「最近沉淀」页 → 30 秒内看到自己刚提交的这条，带得到证据链接；页面只展示本组织可见的条目。
5. 服务启动时跑员工目录一致性自检（A30 四项）：任一项不成立 → 启动自检失败，服务不起。

## 边界情况

- 白名单里有、员工目录无归属声明 → 403 `NO_ORG_ASSIGNMENT`，**禁止默认组织兜底**。
- staff 路径命中 `bridgeNewUserToTenant` 的 `Personal-*` 个人租户兜底 → 视为组织分裂，必须禁用（普通客户注册的 free fallback 不动）。
- `STAFF_ORG_MAP` 中 uuid 在 `tenants` 中不存在 → 启动自检失败（fail-closed）。
- 既有 16 个 `staffGuard` 端点的调用点**继续携带** `X-User-Email` / `X-Feishu-User-Id`；只有知识面调用不拼身份头。摘错 → 既有页面全站 403。
- 录入提交失败 → 页面区分「写回 0 条」与「写回失败」，失败带原因码（缺组织上下文 / 唯一约束冲突 / 库不可达）。

## 范围限定

**在范围内**：
- G4 组织权限底座**第零刀**：`feishu-login` 签发服务端会话；`knowledgeAuthGuard` 新中间件（只信会话、无 header 回落，不改 `staffGuard`）；带组织维度的员工目录（`STAFF_EMAILS__<ORG>` / `STAFF_FEISHU_OPENIDS__<ORG>` / `STAFF_ORG_MAP`）；J20 按声明组织入驻；第二家企业的 `tenants` 行。
- 知识库表：zenithjoy 侧**只读投影表 schema**（含 `org_id NOT NULL`）+ 只读读端。
- S1 最小闭环：经验录入 API + 「最近沉淀」页（读实时源）。
- 守卫：A27 身份头静态守卫、A30 员工目录一致性守卫（四项，proven-to-fire）。
- smoke：`.github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh`，接进 CI，**A30 自检为核心断言**。

**不在范围内（不做清单，后续 sprint）**：
- S2 问答 UI / 语义检索 / embedding 部署形态（G0-A 拍板）/ 覆盖率闸 / 标废与修订。
- S3 注入点改造 / 注入台账 / 高危检出 / kill switch / 影子模式 / 心跳（cecelia Sprint D）。
- cecelia 侧 `learnings` schema 生命周期列、卫生列 trigger、14 处写入点收编、存量 9245 行 org_id 回填（cecelia Sprint A，独立派单）。
- G1 存量 ≥200 条迁移、G2 敏感过滤闸、A18 导出还原演练、运行期成本 cap（J19）。
- A31（企业B 调 16 个既有 `staffGuard` 端点的 403/200 双向断言）—— 依赖两家企业真实测试账号，本 sprint 只保证既有调用点身份头不被摘除。
- 部门（`dept_id` / departments 表）与角色三层的完整落地；标废/人审授权角色。

## 假设

- [ASSUMPTION: cecelia Sprint A 的 `learnings` 归属三列与写入闸本 sprint 未就绪，故 S1 录入的落库形状由 GAN 阶段与 cecelia 侧对齐；若 org_id 列不可用，录入端点须 fail-closed 拒写并回 `NO_ORG_CONTEXT`，不得静默写无归属行。]
- [ASSUMPTION: 两家企业共用同一 `FEISHU_APP_ID`（open_id 同源），join 键为单值 open_id；若分属两个飞书租户，须升为 (app_id, open_id) 复合键——此前提在实现期需确认（提案 P2#22）。]
- [ASSUMPTION: 「最近沉淀」页读实时源（Brain 侧 SQL 做 org/visibility 过滤），不读投影表，故不受投影延迟约束。]

## 预期受影响文件

- `apps/api/src/routes/staff.ts`：`feishu-login` 改为签发会话 + 按声明组织入驻；新增知识端点（录入 / 最近沉淀）
- `apps/api/src/middleware/`：新增 `knowledgeAuthGuard`（不改 `staff.ts` 的 `staffGuard`）
- `apps/api/src/`：员工目录解析 + `STAFF_ORG_MAP` + 启动自检（A30）
- `apps/staff-hub/src/`：录入界面 + 「最近沉淀」页；知识面调用不拼身份头（既有 16 端点调用点保持原样）
- `apps/api/migrations/`：zenithjoy 只读投影表 schema（`org_id NOT NULL`）
- `.github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh` + windows_cloud 车道 paths/守卫扩容

## NFR 约束

<!-- 来源: decisions 表 category=nfr 查询返回空（step 级 0 条 / ability_id 为空跳过 feature 级），下列取自 GP 合同 lifelines_and_nfr -->
- 可见延迟：录入到「最近沉淀」页可见 ≤ **30 秒**（S1 承诺；投影 ≤5 分钟只约束 S2，不在本 sprint）
- 会话属性：`httpOnly; Secure; SameSite=Lax`（响应级可断言）
- 故障姿态：身份/组织/目录三处一律 **fail-closed**（读不到即拒绝，禁止默认组织兜底、禁止 name 模糊匹配）
- 可观测：录入失败必须带原因码，页面区分「写回 0 条」与「写回失败」
- 版本要求：无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: GP 合同 lifelines_and_nfr 全 14 条 lifeline 全量注入；step 级 golden-path-decisions?category=invariant 返回 0 条；ability_id 为空故跳过 journey_feature 级 -->
- [身份来自会话] 知识端点的身份、角色与组织归属只能来自服务端会话，任何请求头都不得影响判定；组织归属须来自挂在其**员工目录声明组织**下的 `tenant_members` 成员行，不得为个人租户/默认组织兜底；无声明即 403 `NO_ORG_ASSIGNMENT` 不签会话（来源: 合同 lifeline#1）
- [跨企业硬隔离] 任何查询、投影与注入都不得返回非本组织的经验（来源: 合同 lifeline#2）
- [信息卫生 fail-closed] 写 `learnings` 必须经闸函数标注，未标注的写入直接失败；不确定即进隔离区（来源: 合同 lifeline#3）
- [注入池纯净] 高危未审 / 已标废 / status≠active 的经验被注入次数恒为 0（来源: 合同 lifeline#4）
- [SSOT 单向] Cecelia 账本是唯一真相，zenithjoy 团队库为**只读投影，无任何写入端点**（来源: 合同 lifeline#5）
- [不出网] 经验正文不得以明文离开自有基础设施（向量化与问答链路）（来源: 合同 lifeline#6）
- [标废时效] 标废后 5 分钟内不进新上下文，影响面清单可直接执行复核（来源: 合同 lifeline#7）
- [注入留痕] S3 注入 fail-open，但 `injection_status` 必写，禁止静默（来源: 合同 lifeline#8）
- [可还原] 导出文件可独立还原成可查询库（每月自动演练）（来源: 合同 lifeline#9）
- [授权来自会话] 仅 `knowledge_admin`（默认仅主理人）可标废与高危人审，作者可标废自己的条目，授权判定的身份来自服务端会话（来源: 合同 lifeline#10）
- [kill switch 不静默] 关闭注入开关后注入条数为 0，且台账留 `injection_status='disabled'` 行（来源: 合同 lifeline#11）
- [不静默降级] 检索不可用时禁止静默降级成「库里还没有」（来源: 合同 lifeline#12）
- [成本 cap] 第三方支出受月度 cap 约束，80% 告警、100% 停 backfill 与注入；读不到 cap 按 cap=0 停机（来源: 合同 lifeline#13）
- [覆盖率闸] 可注入池与最近 90 天写入条目 embedding 覆盖率均 ≥95%，低于阈值 S2 不得对外开放（来源: 合同 lifeline#14）
- [守卫非空] A27 / A30 变异证明必须 proven-to-fire，守卫报不了红即不许合并（来源: 合同 rollback_triggers 末条）
- [harness流程] area 级 invariant 共 88 条，全部为 capture-triage 自动捕获的 harness 流程学习（非本路产品铁律），已加载但不逐条抄录（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史 —— `GET /journeys/da60cb26/golden-paths` 返回 0 条 ability，line11 为新建 line，本 sprint 是第一刀）

## E2E 验收

> Planner 初稿留占位。可执行脚本由 proposer 在 GAN 阶段按 `target_environment=windows_cloud` 填入（`.github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh` + windows job spec）。

```bash
# 占位：proposer 按 windows_cloud 车道填入真实脚本
# 期望验收点（自然语言）：
# 1. A30 员工目录一致性自检四项全绿，且四条变异（企业A 分组加一个不在扁平里的人 / 扁平加一个不在任何分组里的人 / 某人同时写进两家 / STAFF_ORG_MAP uuid 改成库里不存在的值）各自报红 —— 本 sprint 核心断言
# 2. A27 静态守卫：知识路由与 knowledgeAuthGuard 源码中零身份头名；故意加回一行读头 → 报红
# 3. 白名单员工完成飞书登录 → 响应带 httpOnly; Secure; SameSite=Lax 会话 cookie；psql 反查其成员行挂在声明组织下，命中 Personal-% 租户计数 = 0，登录前后 tenants 行数相等
# 4. 员工目录无归属声明的账号登录 → 403 NO_ORG_ASSIGNMENT，且未建 user、未签会话
# 5. 用该会话调录入端点写入一条经验 → 「最近沉淀」页 30 秒内出现该条，带证据链接（windows_cloud UI E2E）
# 6. 无会话调知识端点 → 401；伪造 X-User-Email/X-Feishu-User-Id 头 → 判定不变（仍 401/403），真库未变
```

## journey_type: user_facing
## journey_type_reason: 承诺终态在 Staff Hub 员工可见页面（录入界面 + 「最近沉淀」页），属 apps/staff-hub 前端面。
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 任何 UI/Dashboard 一律走 GitHub Actions windows-latest 干净 runner（全局 E2E 环境路由死规则），payload.target_environment 亦为 windows_cloud。
## journey_id: da60cb26-5635-4f51-a1f3-a80013f6d69d
## step_id: line00/knowledge_experience_qa#step1（gp_anchor，对应 GP 步骤 S1；golden_path_id ade79e4e-ab35-4e06-997b-def34e9f5cff）
