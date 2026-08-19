# Sprint Contract Draft (Round 1)

**Sprint**: 员工知识中枢 路① 经验沉淀与问答 — thin-slice 第一刀（G4 第零刀 + S1 最小闭环）
**journey_type**: user_facing
**target_environment**: windows_cloud
**GP 合同**: `bb9bc24c-99f6-40f6-a861-35583af72cd5` v1（hash `5b3033c7…`）— 本合同为其下位约束，不得与 lifelines 冲突
**base_sha**: `2fb21d5fed95d9d154e4c90df0fcdddf96b981c1`
**contract-gate**: skipped (packages/brain/src/lib/contract-gate.js 不在本 repo，第三方 repo 场景，仅执行 skill 内置规则审查)

---

## GP-Anchor

line11/knowledge_experience_qa#step1

---

## 已知约束

### [仓库实测] 本 sprint 起草前实测到的既有事实（决定合同形状，非猜测）

| # | 实测事实 | 对合同的约束 |
|---|---|---|
| C1 | `apps/api/src/middleware/staff.ts:22-47` `staffGuard` 只读 `X-User-Email` / `X-Feishu-User-Id` 明文头 + env 白名单比对，无会话校验 | 本 sprint **一行不改** staffGuard；知识面另起 `knowledgeAuthGuard` |
| C2 | `staffGuard` 之后端点实测 **11 个**（`routes/staff.ts:179` 后）+ **5 个**（`routes/skill-drafts.ts:242` 后）= **16 个**，与 GP 合同口径一致 | A31 前置断言按 16 计数，端点计数缩水即报红 |
| C3 | `apps/staff-hub/src/lib/adminFetch.ts:12-19` 由前端自填两个身份头；调用点分布在 `App.tsx` + 9 个 pages | 既有 16 端点调用点**继续携带**身份头；只有知识面新调用不拼头 |
| C4 | `apps/api/src/routes/staff.ts:130-177` `feishu-login` 只返回 user JSON，**无 Set-Cookie、无 session 行** | S1-g 必须新增服务端会话签发 |
| C5 | `apps/api/src/routes/staff.ts:59` `FEISHU_API_BASE = process.env.FEISHU_API_BASE ?? 'https://open.feishu.cn'` — **已可 env 覆盖** | smoke 可注入本地假飞书上游，无需改动即可真跑登录链路 |
| C6 | 本仓已有 `_smoke-fake-llm.ts` / `_smoke-fake-agent-burner.ts` 假上游先例，门禁写法 = `NODE_ENV=production` 一律 404，由 `app.ts` 条件挂载 | 假飞书上游沿用同一模式，不得在生产挂载 |
| C7 | cecelia 账本 `public.learnings` 实测**无** `org_id` / `author_member_id` / `visibility` 列（`information_schema` 查询返回 0 行）| 归属载体须用既有 `metadata` jsonb，见判定点 J-B |
| C8 | Brain `GET /api/brain/learnings` 返 200，`POST /api/brain/learnings` 返 **404**（无写端点）| 录入无法走 Brain HTTP，须直连账本库，见判定点 J-A |
| C9 | `apps/api/src/db/connection.ts` 连接串为 `DATABASE_HOST/PORT/NAME/USER/PASSWORD`（**不读 `DATABASE_URL`**），`DATABASE_NAME` 默认 `cecelia`，连接级 `options: '-c search_path=zenithjoy,public'` | zenithjoy API 与 cecelia 账本在同一 PG 实例上可达；但"同库"是环境假设，须由 ledger preflight 每次证明 |
| C10 | migration 真实目录是 `apps/api/db/migrations/`（124 个 .sql，`npm run migrate` 走 `run-migration.ts`，`zenithjoy.schema_migrations` 追踪）；PRD 写的 `apps/api/migrations/` **不存在** | 投影表 migration 落 `apps/api/db/migrations/`，命名 `YYYYMMDD_HHMMSS_*.sql`，DDL 幂等 |
| C11 | smoke 目录 `.github/workflows/scripts/smoke/` 被 `ci-smoke-glob-runner.yml` **for 循环全量发现**；成为闸门需登记进 `.github/workflows/scripts/smoke-baseline.txt`（现 109 行）| 新 smoke 必须同时落盘 + 进 baseline，否则只是"存量债 warning"不闸 |
| C12 | windows_cloud 通用壳 = `.github/workflows/e2e-windows.yml`（`workflow_dispatch`，入参 `task_id` / `sprint_dir` / `pr_branch`，执行 `$sprint_dir/e2e-verify.ps1`，文件不存在直接 exit 1）| E2E 产物必须是 `<SPRINT_DIR>/e2e-verify.ps1` |
| C13 | `apps/staff-hub/playwright.config.ts`：`testDir: './e2e'`、`baseURL: E2E_BASE_URL \|\| http://localhost:5175`、workers 1；CI 用 `--port 5175`；vite proxy `/api` → `STAFF_HUB_API_TARGET \|\| http://localhost:5200`，CI 设 3000 | UI E2E spec 落 `apps/staff-hub/e2e/`，端口沿用 5175 / API 3000 |
| C14 | `apps/api/src/index.ts:27` `PORT = process.env.PORT \|\| 3000` | E2E/smoke 起 API 用显式 PORT，避开既有 smoke 端口 52101/52108 |
| C15 | 既有 e2e workflow 已内置守卫：spec 里出现 `page.route(` 直接 FAIL | 本 sprint UI spec 同样禁 stub，所有请求打真后端 |

### [累积FR] 本 line 累积 FR 摘要

`GET localhost:5221/api/brain/line/da60cb26-5635-4f51-a1f3-a80013f6d69d/context-manifest` → **端点不存在（Cannot GET）**，记：`context-manifest: unavailable`。
改由 GP 合同 `fr_summary.statements`（5 条）+ PRD「累积 FR」段承接：line11 为新建 line，`GET /journeys/da60cb26/golden-paths` 返 0 条 ability，**无历史 FR 可回退**，本 sprint 是第一刀。

### [回归测试] 相关既有测试约束

- `apps/api/src/middleware/staff.test.ts` → staffGuard 现有行为断言（本 sprint 不得改动其语义，改动即回归红）
- `apps/api/src/routes/__tests__/staff.test.ts` → 含 `vi.stubEnv('CECELIA_BRAIN_URL', ...)`，feishu-login 现有响应形状断言
- `apps/api/src/middleware/cs-config-guard.test.ts` → 消费 `tenant-context.ts` 写入的 `req.tenantRole`（line04 现网客服配置闸）；本 sprint **不得改 tenant-context**
- `apps/staff-hub/src/lib/adminFetch.test.ts` → 身份头拼装行为断言（既有 16 端点调用点靠它，摘头即回归红）
- `.github/workflows/scripts/smoke/staff-hub-smoke.sh` / `staff-acceptance-smoke.sh` → 已在 `smoke-baseline.txt` 内，本 sprint 改动不得让它们转红

---

## Response Schema（推导来源: [NEW_PATTERN] + 本仓 `staffGuard` 错误体惯例）

PRD 无 `## Response Schema` 段，字段名按本仓既有错误体形状（`apps/api/src/middleware/staff.ts:32-37`）推导，新增业务字段标 `[NEW_PATTERN]`。

### Endpoint: POST /api/staff/knowledge/entries

请求体：`{ "trigger_condition": <string>, "conclusion": <string>, "evidence_url": <string> }`

**Success (HTTP 201)**:
```json
{"success": true, "data": {"entry_id": "<uuid>", "org_id": "<uuid>", "created_at": "<iso8601>"}}
```
- `success` (boolean, 必填): 来源——本仓既有响应惯例
- `data.entry_id` (string uuid, 必填): `[NEW_PATTERN]` 落库行 id
- `data.org_id` (string uuid, 必填): `[NEW_PATTERN]` 该员工在员工目录中**声明的**组织 id，来自会话，不来自请求体
- `data.created_at` (string, 必填): `[NEW_PATTERN]` 落库时间

**禁用字段名**（出现即视为语义漂移，反向断言钉住）: `tenant_id`（本路口径统一叫 `org_id`）、`learning_id`、`id`（顶层）、`user_email`、`feishu_user_id`（身份字段不得回流响应体）

**Error (HTTP 4xx/5xx)**:
```json
{"success": false, "data": null, "error": {"code": "<string>", "message": "<string>"}, "timestamp": "<iso8601>"}
```

错误码全集（本 sprint 封闭集合，多一个少一个都算漂移）:

| code | HTTP | 触发条件 | message（文案互不相同，PRD 步骤 2 硬要求） |
|---|---|---|---|
| `SESSION_REQUIRED` | 401 | 无有效服务端会话 | `登录已失效，请重新登录` |
| `NO_TENANT` | 403 | 有会话但 `tenant_members` 无成员行 | `没有权限` |
| `NO_ORG_CONTEXT` | 403 | 会话解析不出组织归属 / 归属为空 | `缺少组织上下文，已拒绝写入` |
| `DUPLICATE_ENTRY` | 409 | 唯一约束冲突 | `该条经验已存在` |
| `LEDGER_UNREACHABLE` | 503 | 账本身份 preflight 不通过或库不可达 | `账本暂时不可达，未写入` |

### Endpoint: GET /api/staff/knowledge/recent

**Success (HTTP 200)**:
```json
{"success": true, "data": {"items": [{"entry_id": "<uuid>", "trigger_condition": "<string>", "conclusion": "<string>", "evidence_url": "<string>", "author_member_id": "<uuid>", "org_id": "<uuid>", "created_at": "<iso8601>"}], "count": <number>}}
```
- `data.items[]` (array, 必填): `[NEW_PATTERN]` 仅含**本组织**条目；读实时源（`public.learnings`），不读投影表
- `data.count` (number, 必填): `[NEW_PATTERN]` items 长度

**顶层 keys 完整性**: `keys == ["data","success"]`（jq 排序后）
**data 层 keys 完整性**: `data | keys == ["count","items"]`

**Error**: 同上错误体形状，码取 `SESSION_REQUIRED` / `NO_TENANT` / `NO_ORG_CONTEXT` / `LEDGER_UNREACHABLE`。

### Endpoint: POST /api/staff/feishu-login（改造既有）

**Success (HTTP 200)**: 既有 `{"success": true, "user": {...}}` 形状**保持不变**（C3：既有前端依赖），**新增** `Set-Cookie` 响应头，属性含 `HttpOnly`、`Secure`、`SameSite=Lax`。
**Error (HTTP 403，新增分支)**:
```json
{"success": false, "data": null, "error": {"code": "NO_ORG_ASSIGNMENT", "message": "你的账号未在员工目录中声明企业归属"}, "timestamp": "<iso8601>"}
```

---

## 真实调用方请求 shape

本 sprint 有两类真实调用方，两者的请求形状**必须分叉且各自钉住**——这正是 GP 合同 lifeline#1 与 A31 的交点。

### 调用方 A：Staff Hub 既有 16 端点（`staffGuard` 保护）— 形状不得改

摘自生产调用方源码 `apps/staff-hub/src/lib/adminFetch.ts:12-19`：

```
Method: 各端点原样
Headers:
  X-User-Email:      <员工邮箱>        ← 明文头，staffGuard 唯一判据之一
  X-Feishu-User-Id:  <ou_ 开头 open_id> ← 明文头，staffGuard 唯一判据之一
  Content-Type:      application/json（有 body 时）
credentials: 'include'
```

**约束**：本 sprint 对这 16 个端点的调用点**逐字不动**——`adminFetch` 的两个头照拼。摘头 = 全体用户（含企业A 员工）对既有页面一律 403（GP 合同 blast_radius ⑧ 已实证该因果），属须立即回滚的一类。

### 调用方 B：Staff Hub 知识面新调用 — 只带 cookie，零身份头

```
Method: POST /api/staff/knowledge/entries | GET /api/staff/knowledge/recent
Headers:
  Content-Type: application/json（POST）
  （无 X-User-Email，无 X-Feishu-User-Id，无任何自定义身份头）
credentials: 'include'   ← 会话 cookie 唯一身份来源
```

**约束**：知识面**不得复用 `adminFetch`**（它会拼头）；须新增独立的 `knowledgeFetch`（只 `credentials: 'include'`）。`knowledgeAuthGuard` 与知识路由源码中出现 `x-user-email` / `x-feishu-user-id` / `X-User-Email` / `X-Feishu-User-Id` 任一字面量即 A27 报红。

---

## 禁 mock 边清单

本单命中「跨模块数据传递」「生命周期钩子（服务启动自检）」「DB 写路径」三类，以下边**禁 mock**，测试必须真 Postgres、真相邻模块：

- `feishu-login 路由` ↔ `员工目录解析模块`（本单新建"open_id/email → 声明组织"这条数据传递，测试必须真调目录解析，不得 stub 返回值）
- `feishu-login 路由` ↔ `会话签发模块`（本单新建会话签发，测试必须真拿到 `Set-Cookie` 并用它发下一个请求，不得伪造 cookie 字符串）
- `knowledgeAuthGuard` ↔ `会话解析`（本单新建鉴权判定，测试必须真解析真会话，不得 mock session 对象注入）
- `knowledgeAuthGuard` ↔ `tenant_members 查询`（本单新建"会话 → 成员行 → org_id"这一跳，测试必须真查 PG）
- `代码` ↔ `DB 表 public.learnings`（本单新增写路径，测试必须真 INSERT 并真 SELECT 验行落库与归属字段）
- `代码` ↔ `DB 表 zenithjoy.tenants` / `zenithjoy.tenant_members`（本单新增入驻写路径与 Personal-% 反向断言，测试必须真 PG 计数）
- `代码` ↔ `DB 表 zenithjoy.knowledge_entries_projection`（本单新建投影表 schema 与只读读端，测试必须真建表真查）
- `服务启动钩子` ↔ `员工目录一致性自检（A30）`（本单新建 startup 钩子，测试必须真起进程观察起/不起，不得直接单测自检函数当成"启动被拦住"）

允许 mock 的仅一处外部边界：**飞书 OAuth 上游**（见「未覆盖真实链路清单」），且必须走 `FEISHU_API_BASE` env 指向本地假上游（C5/C6 既有机制），不得在被测代码里加分支。

---

## 未覆盖真实链路清单（规则 C 显式登记）

| # | 被顶替的真实链路点 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|---|
| 1 | **飞书 OAuth 上游**（`open.feishu.cn` 的 `app_access_token/internal` 与 `authen/v1/access_token`）由本地假上游 `_smoke-fake-feishu` 顶替 | CI/windows_cloud runner 拿不到真实飞书授权 code（一次性、需真人点授权页），且真 `FEISHU_APP_SECRET` 不下发到 GHA | 主理人在 staging（`deploy-staff-hub-staging.yml` 推上后）用真飞书账号真登录一次，人工确认 Set-Cookie 三属性齐全 + `psql` 反查成员行挂声明组织；本 sprint 交付后、prod_hk 人工闸放行前完成 |
| 2 | **A31 企业B 双向断言**（企业B 真实会话调 16 个既有端点 403 命中率 100%）| PRD 范围限定明确排除：依赖两家企业真实测试账号，本 sprint 只保证既有调用点身份头不被摘除 | 后续 sprint（GP 合同 A31）；本 sprint 以「16 端点计数 + 调用点身份头未摘除」两条静态断言做**前置保护**，防实现期把头全局摘掉 |
| 3 | **生产环境 zenithjoy API 与 cecelia 账本同库假设**（C9）| 本地/CI 下 `DATABASE_NAME=cecelia` + `search_path=zenithjoy,public` 使 `public.learnings` 直连可达；生产 hk-vps 拓扑未在本 sprint 实测 | 由**运行时 ledger identity preflight**（判定点 J-A）在每次录入前真证明，preflight 不过即 503 拒写——即该假设在生产不成立时不会静默写错表，而是显性失败；生产实测由主理人在 staging/prod_hk 放行前完成 |
| 4 | **windows_cloud 段的 `public.learnings` 表可能由本 sprint fixture DDL 建**（该表属 cecelia repo，不在本仓 migrations；runner 上缺表时 `e2e-verify.ps1` 应用 `<SPRINT_DIR>/fixtures/learnings-ledger.sql`）| GHA runner 的库不保证有 cecelia 账本表，缺表则 UI 段无处可写、整段跑不到断言 | fixture DDL 必须由 generator 用 `pg_dump -s -t public.learnings` 从**真 cecelia 账本**导出后 commit（不得手写猜列）；列形状的真验由**第一段 bash 在真 cecelia 库上**兜底——两段合看即覆盖：第一段验列形状与写入语义，第二段验 UI 终态 |

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①`feishu-login` 签发 httpOnly/Secure/SameSite=Lax 会话并按员工目录**声明组织**写 `tenant_members` 成员行；②员工目录（`STAFF_EMAILS__<ORG>` / `STAFF_FEISHU_OPENIDS__<ORG>` / `STAFF_ORG_MAP`）+ 启动一致性自检（A30 四项）；③`knowledgeAuthGuard` 只信会话、零 header 回落；④经验录入 API 写 Cecelia 账本带归属；⑤「最近沉淀」页读实时源、只显本组织；⑥zenithjoy 只读投影表 schema + 只读读端；⑦A27 静态守卫；⑧smoke 落盘并进 baseline |
| **NFR（做得多好）** | 性能/可靠性 | 录入→「最近沉淀」可见 ≤ **30 秒**；会话 cookie 属性 `httpOnly; Secure; SameSite=Lax`；身份/组织/目录三处一律 fail-closed；录入失败必带原因码 |
| **Invariant（永不违反）** | 不变量 | 见下方「Invariant 覆盖」段（GP 合同 14 条 lifeline + 守卫非空，逐条映射 INV-N 或 N/A） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见「判定点登记表」 |
| **保质期（何时过期）** | 何时失效谁退役 | ①会话 cookie 有效期 **7 天**（`maxAge`），过期即回 401 `SESSION_REQUIRED`；②`metadata` 承载归属属**过渡形状**，cecelia Sprint A 落真列（`org_id` / `author_member_id` / `visibility`）后须迁移并退役，退役责任人 = cecelia Sprint A 派单方；③假飞书上游 `_smoke-fake-feishu` 随 `NODE_ENV=production` 永不挂载，无退役压力 |
| **死亡告警（停了谁知道）** | 停摆谁多久知道 | ①A30 自检失败 = **服务起不来**，`deploy-staff-hub-staging.yml` 部署即红，推送者立刻知道；②knowledge smoke 进 `smoke-baseline.txt` 后，每次 PR + 每日 19:00 cron 的 `Smoke Glob Gate` 报红；③录入链路静默失效的兜底 = ledger preflight 503（页面显性提示"账本暂时不可达"），不会静默 200 |
| **失败语义（挂了怎么办）** | 放行还是拦截 | 见「失败语义声明」表——**全部 fail-closed**，无一处 fail-open |
| **效果确认（已发≠已生效）** | 回执方式 | 录入的效果确认 = **「最近沉淀」页 30 秒内真读到该条**（不是 201 响应本身）；201 只代表"账本收下了"，E2E 以读端回读为准，读不到 = 未生效 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ J-A 录入写进的那张表是不是 Cecelia 账本本体 | A. Brain HTTP `POST /api/brain/learnings`；B. 直连 PG 写 `public.learnings` + 每次写前做账本身份 preflight；C. zenithjoy 侧建本地权威表 | **B** | A 实测 404（C8，Brain 无写端点），跨 repo 加端点不在本 sprint base_repo 范围；C 直接违反 GP lifeline#5「SSOT 单向」。B 写的是账本本体，且 preflight 让"同库假设"每次被真证明而非被默认 | SSOT 静默分裂：员工以为经验进了账本，实际写进一张同名的空表，问答/注入永远查不到，且**没有任何报错** |
| ⚠️ J-B 一条经验"属于哪家企业"记在哪 | A. `learnings.org_id` 真列；B. `learnings.metadata->>'org_id'` jsonb；C. zenithjoy 侧另建映射表 | **B（过渡）** | A 实测列不存在（C7），加列属 cecelia Sprint A 范围、跨 repo；C 会让归属与正文分家，一旦不同步即跨企业泄漏。B 与正文同行原子写入，且是 Sprint A 回填真列时的现成数据源 | 归属漏写 → 该条经验对**所有**组织可见或对**所有**组织不可见；前者是跨企业泄漏（破 lifeline#2），故写入路径必须"无 org 即拒写"而非"无 org 写 null" |
| ⚠️ J-C 一个员工"归属哪家企业"从哪判 | A. 扁平 `STAFF_EMAILS` 并集推断；B. 分组 env `STAFF_EMAILS__<ORG>` / `STAFF_FEISHU_OPENIDS__<ORG>` 显式声明 + `STAFF_ORG_MAP` 映射到 tenants uuid；C. 按邮箱域名后缀推断 | **B** | GP 合同 lifeline#1 明确要求"员工目录中显式声明的那一家企业"；A 无法表达两家；C 是 name 模糊匹配，GP 合同 NFR 明令禁止 | 员工被判进错误企业 → 他看到另一家的经验（破 lifeline#2）；或被判进两家 → 归属不唯一，隔离断言反而更绿（GP 合同 rollback_triggers 明列此风险），故 A30② 必须把"声明在两家"钉成启动失败 |
| J-D 会话是否有效 | A. 解析 better-auth session（`apps/api` 已依赖 better-auth ^1.6.9）；B. 自签 JWT；C. 读 `X-User-Email` 头 | **A** | C 正是本 GP 命门（改一个头即成 knowledge_admin），A27 静态守卫就是为堵它；B 等于自造一套认证，与 `tenant-context.ts:38-51` 既有 better-auth 解析先例分叉 | 身份可伪造 → 授权与跨企业隔离两条 lifeline 同时失效（GP 合同 rollback_triggers：整条 Capability 停止） |
| J-E 「最近沉淀」页读到的是不是"刚提交的那条" | A. 断言 items 非空；B. 断言 items 里存在 `entry_id` 等于本轮 201 返回的那个 id，且 `created_at` 在本轮脚本启动之后 | **B** | A 会被历史残留条目冒充通过（本 skill 反例 #8） | 误判为"闭环已通"，实际录入写进了别处或读端读的是历史数据 |

> `judgment-pending-user: J-A 录入落库通道`、`judgment-pending-user: J-B 归属载体`
> —— 二者误判后果均为"静默"级（SSOT 分裂 / 跨企业泄漏且无报错），PRD 的 `[ASSUMPTION]` 原文即写明"落库形状由 GAN 阶段与 cecelia 侧对齐"，本合同已按实测证据拍出 B/B 并配 fail-closed 兜底，但**建议主理人在 generator 开工前确认一次**（尤其生产 hk-vps 的 zenithjoy API 与 cecelia 账本是否同一 PG 实例）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 员工目录一致性自检（A30）任一项不成立 | **进程不启动**（非 0 退出 + stderr 打出违规项）| N/A（启动期）| **无降级**，fail-closed |
| 员工在白名单但员工目录无归属声明 | 403 `NO_ORG_ASSIGNMENT`，**不建 user、不签会话、不写成员行** | 是（无副作用）| 无降级，禁止默认组织兜底 |
| 员工被声明在两家企业 | 归属不唯一 → 启动自检 A30② 报红，**进程不启动** | N/A | 无降级 |
| `STAFF_ORG_MAP` 的 uuid 在 `tenants` 中不存在 | 启动自检 A30③ 报红，**进程不启动** | N/A | 无降级 |
| 知识端点无会话 | 401 `SESSION_REQUIRED` | 是 | 无降级，**禁止**回落读身份头 |
| 有会话但无 `tenant_members` 成员行 | 403 `NO_TENANT` | 是 | 无降级 |
| 录入时会话解析不出 org | 403 `NO_ORG_CONTEXT`，**拒写**（账本新增行数 = 0）| 是 | 无降级，禁止写无归属行 |
| 账本身份 preflight 不过 / PG 不可达 | 503 `LEDGER_UNREACHABLE`，拒写 | 是 | 无降级；页面显性提示，**禁止**静默当成"写回 0 条" |
| 唯一约束冲突 | 409 `DUPLICATE_ENTRY` | 是（同 body 重放仍 409）| 无降级 |
| 「最近沉淀」读端 PG 不可达 | 503 `LEDGER_UNREACHABLE` | 是 | **禁止**静默降级成"库里还没有"（GP lifeline#12 同源要求）|

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 员工在录入界面填写的 `trigger_condition` / `conclusion` / `evidence_url` | **半可信**（已通过会话鉴权的自有员工，但正文将来会进 S3 注入池）| 本 sprint S3 注入不存在，正文不进任何 prompt；正文按纯文本落库，读端不做 HTML 渲染（`evidence_url` 仅按 `https?://` 前缀白名单校验，非法即 400）| 请求体中的 `org_id` / `author_member_id` / 任何身份字段**一律忽略**，只从会话取；显式携带这些字段不报错但绝不采纳（不给攻击者试探信号）|
| 任何请求头（含 `X-User-Email` / `X-Feishu-User-Id`）| **不可信** | N/A | 知识端点判定完全不读请求头；伪造头不改变任何判定结果（A27 静态守卫 + 行为断言双钉）|

---

## Invariant 覆盖（GP 合同 lifelines 逐条映射）

| 铁律 | 本 sprint 处置 |
|---|---|
| lifeline#1 身份来自会话 | **INV-1**（DoD 有断言）|
| lifeline#2 跨企业硬隔离 | **INV-2**（DoD 有断言）|
| lifeline#3 信息卫生 fail-closed | N/A：卫生闸函数与 `learnings` BEFORE INSERT trigger 属 cecelia Sprint A，PRD 范围限定明确排除 |
| lifeline#4 注入池纯净 | N/A：S3 注入不在本 sprint（PRD 不做清单）|
| lifeline#5 SSOT 单向 | **INV-5**（DoD 有断言）|
| lifeline#6 不出网 | N/A：向量化与问答链路属 S2，本 sprint 无 embedding、无外部推理调用 |
| lifeline#7 标废时效 | N/A：标废与修订属 S2（PRD 不做清单）|
| lifeline#8 注入留痕 | N/A：S3 注入台账不在本 sprint |
| lifeline#9 可还原 | N/A：A18 导出还原演练属后续 sprint（PRD 不做清单）|
| lifeline#10 授权来自会话 | N/A：`knowledge_admin` 角色与标废/人审入口属 S2；本 sprint 无授权分级动作。**但其前提（身份来自会话）由 INV-1 提前钉住** |
| lifeline#11 kill switch 不静默 | N/A：`LEARNING_INJECT_ENABLED` 属 S3 |
| lifeline#12 不静默降级 | **INV-12**（DoD 有断言）：本 sprint 的同源要求 = 读端 PG 不可达时回 503 `LEDGER_UNREACHABLE`，不得静默返回空 items 冒充"库里还没有" |
| lifeline#13 成本 cap | N/A：无第三方支出（本 sprint 零外部 API 调用）|
| lifeline#14 覆盖率闸 | N/A：embedding 覆盖率属 S2 对外开放前置 |
| rollback_triggers 末条 守卫非空（A27/A30 proven-to-fire）| **INV-G**（DoD 有断言，A27 一条变异 + A30 四条变异）|

---

## Golden Path

[白名单员工在 Staff Hub 点飞书登录] → [服务端按员工目录声明组织签会话 + 入驻] → [知识面只凭会话取身份] → [录入一条经验落 Cecelia 账本带归属] → [「最近沉淀」页 30 秒内看到本人这条，带证据链接]

---

### Step 1: 服务启动跑员工目录一致性自检（A30 四项），任一不成立则服务不起

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 条 + 「边界情况」第 3 条（`STAFF_ORG_MAP` uuid 不存在 → 启动自检失败 fail-closed）

**可观测行为**: 员工目录四项一致性全部成立时 API 进程正常监听端口；任一项被破坏时进程非 0 退出、端口不监听，且 stderr 打出违规项名（`A30-1a` / `A30-1b` / `A30-2` / `A30-3`）。

四项口径（逐字取自 GP 合同 success_and_close「v6 由三项改四项」）：
- `A30-1a`：扁平 `STAFF_EMAILS` ∪ `STAFF_FEISHU_OPENIDS` **等于**分组 env 里企业A 那一组
- `A30-1b`：分组 env 并集 **⊇** 扁平名单
- `A30-2`：归属唯一 —— 无任何人同时出现在两个 `<ORG>` 分组
- `A30-3`：`STAFF_ORG_MAP` 中每个 uuid 在 `zenithjoy.tenants` 中真实存在

**验证命令**:
```bash
# 正向：四项成立 → 进程起得来
PORT=52201 STAFF_DIRECTORY_SELFCHECK=1 node -r dotenv/config apps/api/dist/index.js > /tmp/a30-ok.log 2>&1 &
A30_PID=$!
for i in $(seq 1 20); do curl -sf "localhost:52201/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "localhost:52201/api/health" >/dev/null || { echo "FAIL: A30 四项成立但服务未起"; kill $A30_PID 2>/dev/null; exit 1; }
kill $A30_PID 2>/dev/null

# 反向变异（四条各跑一次，此处示 A30-3）：uuid 改成库里不存在的值 → 进程必须起不来
STAFF_ORG_MAP='orgA:00000000-0000-4000-8000-000000000000' PORT=52202 \
  node -r dotenv/config apps/api/dist/index.js > /tmp/a30-mut3.log 2>&1
[ $? -ne 0 ] || { echo "FAIL: A30-3 变异未报红"; exit 1; }
grep -q 'A30-3' /tmp/a30-mut3.log || { echo "FAIL: A30-3 报红但未指明违规项"; exit 1; }
```

**硬阈值**: 正向 —— 20 秒内 `/api/health` 返 200；反向 —— 四条变异**各自**退出码 ≠ 0 且日志含对应违规项名（A30-1a/1b/2/3 全中，缺一条即不算 proven-to-fire）

---

### Step 2: 白名单员工飞书登录 → 签发会话 cookie + 按声明组织写成员行

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条 + 「NFR 约束」会话属性行

**可观测行为**: 登录响应带 `Set-Cookie`，属性含 `HttpOnly`、`Secure`、`SameSite=Lax`；同一事务内该员工在 `zenithjoy.tenant_members` 中出现一行，其 `tenant_id` **逐字等于** `STAFF_ORG_MAP` 里为他声明的那个 uuid；该 open_id 命中 `Personal-%` 租户计数 = 0；登录前后 `zenithjoy.tenants` 行数相等（登录不新建租户）。

**验证命令**:
```bash
TENANTS_BEFORE=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.tenants")
curl -sf -D /tmp/login-hdr.txt -X POST "http://localhost:$API_PORT/api/staff/feishu-login" \
  -H 'Content-Type: application/json' -d '{"code":"fake-code-orgA-member"}' \
  -c /tmp/staff-cookie.txt -o /tmp/login-body.json
grep -i '^set-cookie:' /tmp/login-hdr.txt | grep -qi 'HttpOnly' || { echo "FAIL: cookie 缺 HttpOnly"; exit 1; }
grep -i '^set-cookie:' /tmp/login-hdr.txt | grep -qi 'Secure' || { echo "FAIL: cookie 缺 Secure"; exit 1; }
grep -i '^set-cookie:' /tmp/login-hdr.txt | grep -qi 'SameSite=Lax' || { echo "FAIL: cookie 缺 SameSite=Lax"; exit 1; }
MEMBER_ORG=$(psql "$PGURL" -t -A -c "SELECT tm.tenant_id FROM zenithjoy.tenant_members tm WHERE tm.feishu_user_id='$ORGA_OPENID'")
[ "$MEMBER_ORG" = "$ORGA_TENANT_ID" ] || { echo "FAIL: 成员行挂错组织 got=$MEMBER_ORG want=$ORGA_TENANT_ID"; exit 1; }
PERSONAL=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_members tm JOIN zenithjoy.tenants t ON t.id=tm.tenant_id WHERE tm.feishu_user_id='$ORGA_OPENID' AND t.name LIKE 'Personal-%'")
[ "$PERSONAL" = "0" ] || { echo "FAIL: 命中 Personal-% 租户 count=$PERSONAL"; exit 1; }
TENANTS_AFTER=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.tenants")
[ "$TENANTS_BEFORE" = "$TENANTS_AFTER" ] || { echo "FAIL: 登录新建了租户 $TENANTS_BEFORE -> $TENANTS_AFTER"; exit 1; }
```

**硬阈值**: 三个 cookie 属性全中；`tenant_id` 字面相等；Personal-% 计数 = 0；`tenants` 行数差 = 0

---

### Step 3: 员工目录无归属声明的账号登录 → 403 NO_ORG_ASSIGNMENT，不建 user、不签会话

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条末句 + 「边界情况」第 1 条（禁止默认组织兜底）

**可观测行为**: 该账号在扁平白名单里、但 `STAFF_ORG_MAP` 无其归属声明 → HTTP 403，`error.code == "NO_ORG_ASSIGNMENT"`；响应**无** `Set-Cookie`；`zenithjoy.tenant_members` 中该 open_id 行数 = 0；`user` 表本轮新增行数 = 0。

**验证命令**:
```bash
CODE=$(curl -s -o /tmp/noorg.json -D /tmp/noorg-hdr.txt -w '%{http_code}' -X POST "http://localhost:$API_PORT/api/staff/feishu-login" \
  -H 'Content-Type: application/json' -d '{"code":"fake-code-noorg"}')
[ "$CODE" = "403" ] || { echo "FAIL: 期望 403 得到 $CODE"; exit 1; }
jq -e '.error.code == "NO_ORG_ASSIGNMENT"' /tmp/noorg.json || { echo "FAIL: 错误码不符"; exit 1; }
grep -qi '^set-cookie:' /tmp/noorg-hdr.txt && { echo "FAIL: 拒绝路径仍签了会话"; exit 1; }
MC=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_members WHERE feishu_user_id='$NOORG_OPENID'")
[ "$MC" = "0" ] || { echo "FAIL: 拒绝路径仍写了成员行 count=$MC"; exit 1; }
```

**硬阈值**: HTTP = 403；`error.code` 字面 `NO_ORG_ASSIGNMENT`；无 Set-Cookie；成员行 = 0

---

### Step 4: 知识端点身份只从会话解析，任何请求头都不影响判定

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条（三种文案各不相同）+ 「E2E 验收」期望验收点 6

**可观测行为**: ①无 cookie 调知识端点 → 401 `SESSION_REQUIRED`，message 为「登录已失效，请重新登录」；②无 cookie **但**伪造 `X-User-Email` + `X-Feishu-User-Id`（填企业A 真实白名单值）→ 判定不变，仍 401，且账本本轮新增行数 = 0；③有会话但 `tenant_members` 无成员行 → 403 `NO_TENANT`，message 为「没有权限」。三条 message 两两不同。

**验证命令**:
```bash
# ① 无会话
C1=$(curl -s -o /tmp/k401.json -w '%{http_code}' "http://localhost:$API_PORT/api/staff/knowledge/recent")
[ "$C1" = "401" ] || { echo "FAIL: 无会话期望 401 得到 $C1"; exit 1; }
jq -e '.error.code == "SESSION_REQUIRED" and .error.message == "登录已失效，请重新登录"' /tmp/k401.json || { echo "FAIL: 401 文案/码不符"; exit 1; }

# ② 伪造身份头（本 GP 命门）
LEDGER_BEFORE=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings")
C2=$(curl -s -o /tmp/kforge.json -w '%{http_code}' \
  -H "X-User-Email: $ORGA_EMAIL" -H "X-Feishu-User-Id: $ORGA_OPENID" \
  -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" \
  -H 'Content-Type: application/json' \
  -d '{"trigger_condition":"forged","conclusion":"forged","evidence_url":"https://example.com/forged"}')
[ "$C2" = "401" ] || { echo "FAIL: 伪造头改变了判定，得到 $C2"; exit 1; }
LEDGER_AFTER=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings")
[ "$LEDGER_BEFORE" = "$LEDGER_AFTER" ] || { echo "FAIL: 伪造头路径写进了账本 $LEDGER_BEFORE -> $LEDGER_AFTER"; exit 1; }
```

**硬阈值**: ①401 + 码/文案字面相等；②伪造头下仍 401 且账本行数差 = 0；③403 `NO_TENANT` + 文案「没有权限」

---

### Step 5: 员工提交经验 → 落 Cecelia 账本，带其 org_id 与 author_member_id；缺组织上下文即拒写

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条 + 「边界情况」第 5 条（失败带原因码）+ 「假设」第 1 条（org 不可用须 fail-closed 回 `NO_ORG_CONTEXT`）

**可观测行为**: 带会话 POST 录入 → 201，`data.entry_id` 为 uuid、`data.org_id` 等于该员工声明组织；`public.learnings` 中该 id 行的归属字段等于其声明组织，且 `created_at` 在本轮脚本启动之后；反向 —— 把会话组织上下文抹掉后再录入 → 403 `NO_ORG_CONTEXT` 且账本本轮新增行数 = 0（不写无归属行）。写入前的账本身份 preflight 不通过时 → 503 `LEDGER_UNREACHABLE`，同样零写入。

**验证命令**:
```bash
SCRIPT_START=$(psql "$PGURL" -t -A -c "SELECT now()")
RESP=$(curl -sf -b /tmp/staff-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" \
  -H 'Content-Type: application/json' \
  -d '{"trigger_condition":"合同起草前未读生产调用方源码","conclusion":"先读 adminFetch 再定请求 shape","evidence_url":"https://github.com/perfectuser21/zenithjoy-workspace/pull/1"}')
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: 录入未成功"; exit 1; }
ENTRY_ID=$(echo "$RESP" | jq -r '.data.entry_id')
echo "$RESP" | jq -e --arg o "$ORGA_TENANT_ID" '.data.org_id == $o' || { echo "FAIL: 响应 org_id 不等于声明组织"; exit 1; }
ROW=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings WHERE id='$ENTRY_ID' AND metadata->>'org_id'='$ORGA_TENANT_ID' AND metadata->>'author_member_id' IS NOT NULL AND created_at > '$SCRIPT_START'")
[ "$ROW" = "1" ] || { echo "FAIL: 账本无本轮带归属的行 count=$ROW"; exit 1; }
```

**硬阈值**: HTTP 201；`data.org_id` 字面等于声明组织；账本命中行数 = 1 且 `created_at > 脚本启动时刻`；反向路径 403 `NO_ORG_CONTEXT` 且账本新增 = 0

---

### Step 6: 「最近沉淀」页 30 秒内看到本人刚提交那条，带证据链接，且只显本组织

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 条 + 「NFR 约束」可见延迟 ≤ 30 秒

**可观测行为**: 提交后 30 秒内，`GET /api/staff/knowledge/recent` 的 `data.items[]` 中存在 `entry_id` 等于 Step 5 那个 id 的条目，且其 `evidence_url` 与提交值逐字相等；同时该列表中属于**另一家企业**的条目计数 = 0（用另一组织的 org_id 反查）。UI 侧：Staff Hub「最近沉淀」页真实浏览器打开后可见该条文案。

**验证命令**:
```bash
T0=$(date +%s)
FOUND=0
for i in $(seq 1 30); do
  LIST=$(curl -sf -b /tmp/staff-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/recent")
  if echo "$LIST" | jq -e --arg id "$ENTRY_ID" '.data.items[] | select(.entry_id == $id)' >/dev/null 2>&1; then FOUND=1; break; fi
  sleep 1
done
[ "$FOUND" = "1" ] || { echo "FAIL: 30 秒内未在最近沉淀读到 $ENTRY_ID"; exit 1; }
ELAPSED=$(( $(date +%s) - T0 ))
[ "$ELAPSED" -le 30 ] || { echo "FAIL: 可见耗时 ${ELAPSED}s 超过 30s"; exit 1; }
echo "$LIST" | jq -e --arg id "$ENTRY_ID" '.data.items[] | select(.entry_id == $id) | .evidence_url | startswith("https://")' || { echo "FAIL: 证据链接缺失"; exit 1; }
CROSS=$(echo "$LIST" | jq --arg o "$ORGA_TENANT_ID" '[.data.items[] | select(.org_id != $o)] | length')
[ "$CROSS" = "0" ] || { echo "FAIL: 列表混入非本组织条目 count=$CROSS"; exit 1; }
```

**硬阈值**: 30 秒内命中；`evidence_url` 非空且 https 前缀；跨组织条目计数 = 0

---

### Step 7: A27 静态守卫 —— 知识路由与 knowledgeAuthGuard 源码零身份头名，且报得了红

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入。理由：GP 合同把 A27 定为「唯一能防住实现期回退的机械闸——人可以忘记补负向测试，但源码里一旦出现那三个头名就会直接报红」，且 `release_and_blast_radius.stages` 明写「在 A27 与 A30 钉住之前，不允许合入任何知识端点」，故它是本 sprint 的合入前置，必须单列为 Golden Path 步骤而非附属检查。

**可观测行为**: 守卫脚本扫描知识面源码（`knowledgeAuthGuard` 中间件 + 知识路由 + 前端 `knowledgeFetch`），出现 `x-user-email` / `x-feishu-user-id`（大小写不敏感）任一字面量即退出码 ≠ 0。正向：当前实现下退出码 = 0。变异：临时往 `knowledgeAuthGuard` 里加回一行读头 → 守卫退出码 ≠ 0（proven-to-fire）。

**验证命令**:
```bash
bash .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh --a27-only || { echo "FAIL: A27 正向未通过"; exit 1; }
cp apps/api/src/middleware/knowledge-auth.ts /tmp/ka.bak
printf '\n// mutation\nconst _m = (req) => req.headers["x-user-email"];\n' >> apps/api/src/middleware/knowledge-auth.ts
bash .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh --a27-only && { echo "FAIL: A27 变异未报红"; cp /tmp/ka.bak apps/api/src/middleware/knowledge-auth.ts; exit 1; }
cp /tmp/ka.bak apps/api/src/middleware/knowledge-auth.ts
```

**硬阈值**: 正向退出 0；变异退出 ≠ 0；变异后源码已还原（`git diff --exit-code` 为空）

---

### Step 8: A31 前置保护 —— 既有 16 个 staffGuard 端点的调用点身份头未被摘除

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入。理由：PRD 范围限定把 A31 完整双向断言排除在本 sprint 外，但同时留下一条硬要求「本 sprint 只保证既有调用点身份头不被摘除」；GP 合同 blast_radius ⑧ 实证摘头 = 全体用户对 16 个既有端点一律 403、Staff Hub 整体不可用。没有机械断言看住，"全局摘头"是实现期最自然的偷懒方向（知识面要求不拼头），故必须补一条前置守卫。

**可观测行为**: ①`adminFetch.ts` 仍拼 `X-User-Email` 与 `X-Feishu-User-Id` 两个头；②`staffGuard` 之后注册的端点计数 = 16（`routes/staff.ts` 11 个 + `routes/skill-drafts.ts` 5 个），少于 16 即报红（防将来端点被误摘）；③`middleware/staff.ts` 内容与 base_sha 版本逐字节相等（staffGuard 一行不改）。

**验证命令**:
```bash
grep -q "X-User-Email" apps/staff-hub/src/lib/adminFetch.ts || { echo "FAIL: adminFetch 摘除了 X-User-Email"; exit 1; }
grep -q "X-Feishu-User-Id" apps/staff-hub/src/lib/adminFetch.ts || { echo "FAIL: adminFetch 摘除了 X-Feishu-User-Id"; exit 1; }
git diff --exit-code 2fb21d5fed95d9d154e4c90df0fcdddf96b981c1 -- apps/api/src/middleware/staff.ts || { echo "FAIL: staffGuard 被改动"; exit 1; }
N=$(node .github/workflows/scripts/count-staffguard-endpoints.mjs)
[ "$N" = "16" ] || { echo "FAIL: staffGuard 端点计数 $N != 16"; exit 1; }
```

**硬阈值**: 两个头名各命中 ≥1；`middleware/staff.ts` 相对 base_sha 零 diff；端点计数字面等于 16

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud

分两段执行：**第一段**（下方 bash 块，evaluator 直接跑）在本地/CI 用真 Postgres + 真 apps/api 进程走完 Step 1-8 的服务端全链路；**第二段**（`e2e-verify.ps1`，由 `.github/workflows/e2e-windows.yml` 在 windows-latest 上跑）用真实浏览器 Playwright 验「最近沉淀」页的用户可见终态。两段都必须绿，缺一不算通过。

```bash
#!/usr/bin/env bash
# knowledge-hub 路① 第一刀 — final-e2e 服务端全链路（真 PG + 真 apps/api，禁 mock 被改的边）
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PGURL="${E2E_DATABASE_URL:-postgresql://postgres@localhost:5432/cecelia}"
API_PORT="${KNOWLEDGE_E2E_PORT:-52210}"
SPRINT_DIR="sprints/08192114-员工知识中枢-路-经验沉淀与问答-ade79e4e"

# 固定测试身份（假飞书上游按 code 返回这些 open_id，见未覆盖真实链路清单 #1）
ORGA_OPENID="ou_e2e_orga_member"
ORGA_EMAIL="e2e-orga@zenithjoy.local"
ORGB_OPENID="ou_e2e_orgb_member"
NOORG_OPENID="ou_e2e_noorg"

echo "== 0. 建两家企业的 tenants 行 =="
ORGA_TENANT_ID=$(psql "$PGURL" -t -A -c "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('E2E-企业A-'||substr(md5(random()::text),1,8), 'free') RETURNING id")
ORGB_TENANT_ID=$(psql "$PGURL" -t -A -c "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('E2E-企业B-'||substr(md5(random()::text),1,8), 'free') RETURNING id")
[ -n "$ORGA_TENANT_ID" ] || { echo "FAIL: 企业A 租户行未建成"; exit 1; }
[ -n "$ORGB_TENANT_ID" ] || { echo "FAIL: 企业B 租户行未建成"; exit 1; }

export FEISHU_API_BASE="http://localhost:$API_PORT/api/_smoke/fake-feishu"
export FEISHU_APP_ID="e2e-app-id"
export FEISHU_APP_SECRET="e2e-app-secret"
export STAFF_EMAILS="$ORGA_EMAIL"
export STAFF_FEISHU_OPENIDS="$ORGA_OPENID"
export STAFF_EMAILS__ORGA="$ORGA_EMAIL"
export STAFF_FEISHU_OPENIDS__ORGA="$ORGA_OPENID"
export STAFF_FEISHU_OPENIDS__ORGB="$ORGB_OPENID"
# NOORG 单列一组：他必须被员工目录声明过（否则 A30-1b 报红），但 STAFF_ORG_MAP 不给他映射
# —— 这正是 Step 3 要的「是员工、无归属声明」。放进扁平名单会同时破 A30-1a 与 A30-1b，服务起不来。
export STAFF_FEISHU_OPENIDS__NOORG="$NOORG_OPENID"
export STAFF_ORG_MAP="ORGA:$ORGA_TENANT_ID,ORGB:$ORGB_TENANT_ID"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-e2e-knowledge-hub-secret-not-for-prod-32ch}"
export NODE_ENV=development

echo "== 1. 跑 migration + build =="
for f in apps/api/db/migrations/*.sql; do psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null; done
psql "$PGURL" -t -A -c "SELECT to_regclass('zenithjoy.knowledge_entries_projection')" | grep -q knowledge_entries_projection \
  || { echo "FAIL: 投影表未建"; exit 1; }
NULLABLE=$(psql "$PGURL" -t -A -c "SELECT is_nullable FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='knowledge_entries_projection' AND column_name='org_id'")
[ "$NULLABLE" = "NO" ] || { echo "FAIL: 投影表 org_id 未 NOT NULL got=$NULLABLE"; exit 1; }
( cd apps/api && npm run build >/dev/null 2>&1 )

echo "== 2. Step 1 — A30 自检正向起服务 =="
PORT="$API_PORT" node -r dotenv/config apps/api/dist/index.js > /tmp/kh-api.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
UP=0
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$API_PORT/api/health" >/dev/null 2>&1; then UP=1; break; fi
  sleep 1
done
[ "$UP" = "1" ] || { echo "FAIL: A30 四项成立但服务未起，日志:"; tail -30 /tmp/kh-api.log; exit 1; }
# 只验"服务起来了"是假绿——没实现自检时服务照样起，必须证明自检真跑过
grep -q "A30 staff-directory selfcheck passed" /tmp/kh-api.log \
  || { echo "FAIL: 启动日志无 A30 自检通过标记，自检根本没跑"; tail -30 /tmp/kh-api.log; exit 1; }
for k in A30-1a A30-1b A30-2 A30-3; do
  grep -q "$k" /tmp/kh-api.log || { echo "FAIL: 启动日志未列出检查项 $k"; exit 1; }
done

echo "== 3. Step 1 反向 — A30 四条变异各自报红 =="
run_mutation() {
  local name="$1"; shift
  local log="/tmp/kh-a30-$name.log"
  local rc=0
  env "$@" PORT=$((API_PORT+100)) timeout 40 node -r dotenv/config apps/api/dist/index.js > "$log" 2>&1 || rc=$?
  # rc=0 表示进程正常退出、rc=124 表示 timeout 杀掉一个跑着的服务 —— 两者都说明自检没拦住
  [ "$rc" -ne 0 ] || { echo "FAIL: A30 变异 $name 未报红（进程正常启动）"; exit 1; }
  [ "$rc" -ne 124 ] || { echo "FAIL: A30 变异 $name 未报红（服务起来了，被 timeout 杀掉）"; exit 1; }
  grep -q "$name" "$log" || { echo "FAIL: A30 变异 $name 报红但日志未指明违规项"; tail -20 "$log"; exit 1; }
  echo "  OK 变异 $name proven-to-fire"
}
# 1a: 企业A 分组里加一个不在扁平名单里的人
run_mutation "A30-1a" STAFF_FEISHU_OPENIDS__ORGA="$ORGA_OPENID,ou_e2e_ghost"
# 1b: 扁平名单里加一个不在任何分组里的人
run_mutation "A30-1b" STAFF_FEISHU_OPENIDS="$ORGA_OPENID,$NOORG_OPENID,ou_e2e_orphan"
# 2: 某人同时写进两家
run_mutation "A30-2" STAFF_FEISHU_OPENIDS__ORGB="$ORGB_OPENID,$ORGA_OPENID"
# 3: STAFF_ORG_MAP uuid 改成库里不存在的值
run_mutation "A30-3" STAFF_ORG_MAP="ORGA:00000000-0000-4000-8000-000000000000,ORGB:$ORGB_TENANT_ID"

echo "== 4. Step 2 — 登录签会话 + 按声明组织入驻 =="
TENANTS_BEFORE=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.tenants")
curl -sf -D /tmp/kh-login-hdr.txt -c /tmp/kh-cookie.txt \
  -X POST "http://localhost:$API_PORT/api/staff/feishu-login" \
  -H 'Content-Type: application/json' -d "{\"code\":\"e2e-code-orga\"}" -o /tmp/kh-login.json \
  || { echo "FAIL: 白名单员工登录失败"; cat /tmp/kh-login.json; exit 1; }
for attr in HttpOnly Secure "SameSite=Lax"; do
  grep -i '^set-cookie:' /tmp/kh-login-hdr.txt | grep -qi "$attr" \
    || { echo "FAIL: 会话 cookie 缺属性 $attr"; exit 1; }
done
MEMBER_ORG=$(psql "$PGURL" -t -A -c "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id='$ORGA_OPENID'")
[ "$MEMBER_ORG" = "$ORGA_TENANT_ID" ] || { echo "FAIL: 成员行挂错组织 got=$MEMBER_ORG want=$ORGA_TENANT_ID"; exit 1; }
PERSONAL=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_members tm JOIN zenithjoy.tenants t ON t.id=tm.tenant_id WHERE tm.feishu_user_id='$ORGA_OPENID' AND t.name LIKE 'Personal-%'")
[ "$PERSONAL" = "0" ] || { echo "FAIL: 命中 Personal-% 租户 count=$PERSONAL"; exit 1; }
TENANTS_AFTER=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.tenants")
[ "$TENANTS_BEFORE" = "$TENANTS_AFTER" ] || { echo "FAIL: 登录新建租户 $TENANTS_BEFORE -> $TENANTS_AFTER"; exit 1; }

echo "== 5. Step 3 — 无归属声明账号被拒 =="
CODE=$(curl -s -o /tmp/kh-noorg.json -D /tmp/kh-noorg-hdr.txt -w '%{http_code}' \
  -X POST "http://localhost:$API_PORT/api/staff/feishu-login" \
  -H 'Content-Type: application/json' -d '{"code":"e2e-code-noorg"}')
[ "$CODE" = "403" ] || { echo "FAIL: 无归属声明期望 403 得到 $CODE"; exit 1; }
jq -e '.error.code == "NO_ORG_ASSIGNMENT"' /tmp/kh-noorg.json >/dev/null || { echo "FAIL: 错误码不是 NO_ORG_ASSIGNMENT"; exit 1; }
if grep -qi '^set-cookie:' /tmp/kh-noorg-hdr.txt; then echo "FAIL: 拒绝路径仍签发会话"; exit 1; fi
MC=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_members WHERE feishu_user_id='$NOORG_OPENID'")
[ "$MC" = "0" ] || { echo "FAIL: 拒绝路径写了成员行 count=$MC"; exit 1; }

echo "== 6. Step 4 — 身份只来自会话，伪造头无效 =="
C401=$(curl -s -o /tmp/kh-401.json -w '%{http_code}' "http://localhost:$API_PORT/api/staff/knowledge/recent")
[ "$C401" = "401" ] || { echo "FAIL: 无会话期望 401 得到 $C401"; exit 1; }
jq -e '.error.code == "SESSION_REQUIRED"' /tmp/kh-401.json >/dev/null || { echo "FAIL: 401 错误码不符"; exit 1; }
MSG401=$(jq -r '.error.message' /tmp/kh-401.json)
[ "$MSG401" = "登录已失效，请重新登录" ] || { echo "FAIL: 401 文案不符 got=$MSG401"; exit 1; }
LEDGER_BEFORE=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings")
CFORGE=$(curl -s -o /tmp/kh-forge.json -w '%{http_code}' \
  -H "X-User-Email: $ORGA_EMAIL" -H "X-Feishu-User-Id: $ORGA_OPENID" \
  -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" \
  -H 'Content-Type: application/json' \
  -d '{"trigger_condition":"forged","conclusion":"forged","evidence_url":"https://example.com/forged"}')
[ "$CFORGE" = "401" ] || { echo "FAIL: 伪造身份头改变了判定，得到 $CFORGE"; exit 1; }
LEDGER_MID=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings")
[ "$LEDGER_BEFORE" = "$LEDGER_MID" ] || { echo "FAIL: 伪造头路径写进账本 $LEDGER_BEFORE -> $LEDGER_MID"; exit 1; }

echo "== 7. Step 5 — 录入落账本带归属 =="
SCRIPT_START=$(psql "$PGURL" -t -A -c "SELECT now()")
EVIDENCE="https://github.com/perfectuser21/zenithjoy-workspace/pull/e2e-$(date +%s)"
CONCLUSION="E2E 结论 $(date +%s)"
RESP=$(curl -sf -b /tmp/kh-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" \
  -H 'Content-Type: application/json' \
  -d "{\"trigger_condition\":\"E2E 触发条件\",\"conclusion\":\"$CONCLUSION\",\"evidence_url\":\"$EVIDENCE\"}") \
  || { echo "FAIL: 录入请求失败"; exit 1; }
echo "$RESP" | jq -e '.success == true' >/dev/null || { echo "FAIL: 录入 success 非 true: $RESP"; exit 1; }
ENTRY_ID=$(echo "$RESP" | jq -r '.data.entry_id')
echo "$RESP" | jq -e --arg o "$ORGA_TENANT_ID" '.data.org_id == $o' >/dev/null || { echo "FAIL: 响应 org_id 不等于声明组织"; exit 1; }
echo "$RESP" | jq -e 'has("tenant_id") | not' >/dev/null || { echo "FAIL: 出现禁用字段 tenant_id"; exit 1; }
ROW=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings WHERE id='$ENTRY_ID' AND metadata->>'org_id'='$ORGA_TENANT_ID' AND metadata->>'author_member_id' IS NOT NULL AND created_at > '$SCRIPT_START'")
[ "$ROW" = "1" ] || { echo "FAIL: 账本无本轮带归属行 count=$ROW"; exit 1; }

echo "== 8. Step 5 反向 — 缺组织上下文 fail-closed =="
LEDGER_B2=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings")
psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenant_members WHERE feishu_user_id='$ORGA_OPENID'"
CNOORG=$(curl -s -o /tmp/kh-noorgctx.json -w '%{http_code}' -b /tmp/kh-cookie.txt \
  -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" \
  -H 'Content-Type: application/json' \
  -d '{"trigger_condition":"no-org","conclusion":"no-org","evidence_url":"https://example.com/no-org"}')
case "$CNOORG" in
  403) : ;;
  *) echo "FAIL: 缺组织上下文期望 403 得到 $CNOORG"; exit 1 ;;
esac
ERRCODE=$(jq -r '.error.code' /tmp/kh-noorgctx.json)
case "$ERRCODE" in
  NO_ORG_CONTEXT|NO_TENANT) : ;;
  *) echo "FAIL: 缺组织上下文错误码非法 got=$ERRCODE"; exit 1 ;;
esac
LEDGER_A2=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings")
[ "$LEDGER_B2" = "$LEDGER_A2" ] || { echo "FAIL: 缺组织上下文仍写入账本 $LEDGER_B2 -> $LEDGER_A2"; exit 1; }
psql "$PGURL" -q -c "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$ORGA_TENANT_ID','$ORGA_OPENID','member') ON CONFLICT DO NOTHING"

echo "== 9. Step 6 — 30 秒内最近沉淀可见 + 跨组织隔离 =="
T0=$(date +%s)
FOUND=0
for i in $(seq 1 30); do
  LIST=$(curl -sf -b /tmp/kh-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/recent" || true)
  if [ -n "$LIST" ] && echo "$LIST" | jq -e --arg id "$ENTRY_ID" '[.data.items[] | select(.entry_id == $id)] | length == 1' >/dev/null 2>&1; then
    FOUND=1; break
  fi
  sleep 1
done
ELAPSED=$(( $(date +%s) - T0 ))
[ "$FOUND" = "1" ] || { echo "FAIL: 30 秒内最近沉淀未读到 $ENTRY_ID"; exit 1; }
[ "$ELAPSED" -le 30 ] || { echo "FAIL: 可见耗时 ${ELAPSED}s > 30s"; exit 1; }
echo "$LIST" | jq -e --arg id "$ENTRY_ID" --arg u "$EVIDENCE" '[.data.items[] | select(.entry_id == $id and .evidence_url == $u)] | length == 1' >/dev/null \
  || { echo "FAIL: 证据链接未逐字回读"; exit 1; }
echo "$LIST" | jq -e 'keys == ["data","success"]' >/dev/null || { echo "FAIL: 顶层 keys 不完整"; exit 1; }
echo "$LIST" | jq -e '.data | keys == ["count","items"]' >/dev/null || { echo "FAIL: data 层 keys 不完整"; exit 1; }
CROSS=$(echo "$LIST" | jq --arg o "$ORGA_TENANT_ID" '[.data.items[] | select(.org_id != $o)] | length')
[ "$CROSS" = "0" ] || { echo "FAIL: 列表混入非本组织条目 count=$CROSS"; exit 1; }

echo "== 10. Step 7 — A27 静态守卫 proven-to-fire =="
bash .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh --a27-only \
  || { echo "FAIL: A27 正向未通过"; exit 1; }
KA="apps/api/src/middleware/knowledge-auth.ts"
cp "$KA" /tmp/kh-ka.bak
printf '\n// A27 mutation probe\nexport const _a27Probe = (h: Record<string,string>) => h["x-user-email"];\n' >> "$KA"
if bash .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh --a27-only >/dev/null 2>&1; then
  cp /tmp/kh-ka.bak "$KA"
  echo "FAIL: A27 变异未报红（守卫是空的）"; exit 1
fi
cp /tmp/kh-ka.bak "$KA"
git diff --exit-code -- "$KA" >/dev/null || { echo "FAIL: A27 变异后源码未还原"; exit 1; }

echo "== 11. Step 8 — A31 前置保护 =="
grep -q "X-User-Email" apps/staff-hub/src/lib/adminFetch.ts || { echo "FAIL: adminFetch 摘除 X-User-Email"; exit 1; }
grep -q "X-Feishu-User-Id" apps/staff-hub/src/lib/adminFetch.ts || { echo "FAIL: adminFetch 摘除 X-Feishu-User-Id"; exit 1; }
git diff --exit-code 2fb21d5fed95d9d154e4c90df0fcdddf96b981c1 -- apps/api/src/middleware/staff.ts >/dev/null \
  || { echo "FAIL: staffGuard 被改动（GP 合同要求一行不改）"; exit 1; }
N=$(node .github/workflows/scripts/count-staffguard-endpoints.mjs)
[ "$N" = "16" ] || { echo "FAIL: staffGuard 端点计数 $N != 16"; exit 1; }

echo "== 12. INV-5 — 投影表只读读端存在、写端点不存在 =="
GPROJ=$(curl -s -o /tmp/kh-proj.json -w '%{http_code}' -b /tmp/kh-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/projection")
[ "$GPROJ" = "200" ] || { echo "FAIL: 投影表只读读端不存在 got=$GPROJ"; exit 1; }
jq -e '.success == true' /tmp/kh-proj.json >/dev/null || { echo "FAIL: 读端响应形状不符"; exit 1; }
WRITES=$(grep -rInE "(INSERT|UPDATE|DELETE)[[:space:]]+(INTO[[:space:]]+)?(zenithjoy\.)?knowledge_entries_projection" apps/api/src --include=*.ts | grep -v "__tests__" | wc -l | tr -d ' ')
[ "$WRITES" = "0" ] || { echo "FAIL: 投影表存在写入路径 count=$WRITES（违反 SSOT 单向）"; exit 1; }
PPROJ=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/kh-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/knowledge/projection" -H 'Content-Type: application/json' -d '{}')
case "$PPROJ" in
  404|405) : ;;
  *) echo "FAIL: 投影表疑似有写端点 got=$PPROJ"; exit 1 ;;
esac

echo "== 13. INV-12 — 读端不静默降级 =="
psql "$PGURL" -q -c "ALTER TABLE public.learnings RENAME TO learnings_e2e_hidden"
CDEG=$(curl -s -o /tmp/kh-degraded.json -w '%{http_code}' -b /tmp/kh-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/recent")
psql "$PGURL" -q -c "ALTER TABLE public.learnings_e2e_hidden RENAME TO learnings"
[ "$CDEG" = "503" ] || { echo "FAIL: 账本不可达时期望 503 得到 $CDEG（疑似静默降级成空列表）"; exit 1; }
jq -e '.error.code == "LEDGER_UNREACHABLE"' /tmp/kh-degraded.json >/dev/null || { echo "FAIL: 降级错误码不符"; exit 1; }

echo "== 14. 清理 =="
psql "$PGURL" -q -c "DELETE FROM public.learnings WHERE id='$ENTRY_ID'"
psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenant_members WHERE feishu_user_id IN ('$ORGA_OPENID','$ORGB_OPENID','$NOORG_OPENID')"
psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenants WHERE id IN ('$ORGA_TENANT_ID','$ORGB_TENANT_ID')"

echo "✅ 服务端全链路 E2E 通过（Step 1-8 + INV-5 + INV-12）"
echo "→ 第二段 UI E2E 由 e2e-windows.yml 跑 $SPRINT_DIR/e2e-verify.ps1"
```

### 第二段：windows_cloud UI E2E（`<SPRINT_DIR>/e2e-verify.ps1`）

由 `.github/workflows/e2e-windows.yml`（`workflow_dispatch`，入参 `task_id` / `sprint_dir=sprints/08192114-员工知识中枢-路-经验沉淀与问答-ade79e4e` / `pr_branch`）在 windows-latest 上执行。**禁止 `page.route()`**（既有 workflow 已内置该守卫），所有请求打真实 `apps/api`。

**本段前置由 `e2e-verify.ps1` 自建，与第一段 bash 对称**（r1 反馈问题 1 的根因是本段缺前置）：`DATABASE_*` 五个离散变量（`apps/api/src/db/connection.ts:7-11` 只读这五个、**不读 `DATABASE_URL`**，C9 实测）、两家企业 `tenants` 行、员工目录分组 env 全套。**本 sprint 不改 `e2e-windows.yml`**（跨 sprint 共用壳；且 GHA 的 `services:` 只支持 Linux runner，windows-latest 上加 postgres service 不成立），前置一律在 ps1 内自建，任一步不成立即 `throw`，绝无空跑。

**前端门禁与服务端会话如何共存**：`apps/staff-hub` 的 `isAuthenticated` 来自 `AuthContext`（客户端态，`App.tsx:47-53` 未登录时除 `/login/feishu` 外一律渲染 `LoginPage`）——它**只决定导航体验，不承担任何授权判定**；知识面的授权判定 100% 在服务端 `knowledgeAuthGuard`（只信会话 cookie）。因此 UI E2E 沿用本仓既有 staff-hub E2E 惯例 `VITE_SKIP_AUTH=true` 构建（见 `apps/staff-hub/playwright.config.ts` 头注释与 `sprints/07281207-*/e2e-verify.ps1`）把**前端门禁**这个变量固定掉，让**服务端会话**成为唯一变量：无服务端会话 → `knowledgeFetch` 收 401 → 页面渲染 `knowledge-session-expired`；有会话 → 列表可见。此举不改 `App.tsx` 的 `!isAuthenticated` 分支结构（与 r1 反馈问题 3 的结构冲突就此消除），`App.tsx` 的改动仅限**在已登录 shell 的 `Routes` 里注册 `/knowledge/new`、`/knowledge/recent` 两条路由 + 侧栏入口**，已列入「预期受影响文件」。

```powershell
# e2e-verify.ps1 — 知识中枢路① 第一刀 UI E2E（windows-latest，真后端 + 真 Postgres）
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5175
$ApiPort  = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$ScriptStart = Get-Date
$StartIso = $ScriptStart.ToUniversalTime().ToString("o")   # 供 psql 时间窗用，避免在双引号 SQL 串里再嵌双引号
$OrgA = $null; $OrgB = $null; $PgUrl = $null; $apiProc = $null; $viteProc = $null   # StrictMode 下 finally 要能安全读
$OrgaOpenId = "ou_e2e_orga_member"; $OrgaEmail = "e2e-orga@zenithjoy.local"; $OrgbOpenId = "ou_e2e_orgb_member"

# ── 0. 解析数据库连接 → DATABASE_* 五变量（apps/api 只认这五个）──
$PgUrl = $env:E2E_DATABASE_URL
if (-not $PgUrl) {
  # 退到 windows runner 预装的 PostgreSQL（镜像自带，服务默认停）；两条路都不成立即 throw，不空跑
  $svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $svc) { throw "FAIL: 既无 E2E_DATABASE_URL，runner 也无预装 PostgreSQL 服务 — 前置不成立" }
  Set-Service -Name $svc.Name -StartupType Manual
  Start-Service -Name $svc.Name
  $u = if ($env:PGUSER) { $env:PGUSER } else { "postgres" }
  $w = if ($env:PGPASSWORD) { $env:PGPASSWORD } else { "root" }
  $root = "postgresql://${u}:${w}@localhost:5432/postgres"
  $has = (& psql $root -t -A -c "SELECT 1 FROM pg_database WHERE datname='cecelia'" 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "FAIL: runner 本地 PostgreSQL 起了但连不上" }
  if ($has -ne "1") { & psql $root -c "CREATE DATABASE cecelia" | Out-Null }
  $PgUrl = "postgresql://${u}:${w}@localhost:5432/cecelia"
}
$uri = [System.Uri]$PgUrl
if (-not $uri.UserInfo) { throw "FAIL: 连接串缺用户名，无法推导 DATABASE_USER url=$($uri.Host)" }
$ui = $uri.UserInfo.Split(':')
$env:DATABASE_HOST = $uri.Host
$env:DATABASE_PORT = if ($uri.Port -gt 0) { "$($uri.Port)" } else { "5432" }
$env:DATABASE_NAME = $uri.AbsolutePath.TrimStart('/')
$env:DATABASE_USER = [System.Uri]::UnescapeDataString($ui[0])
$env:DATABASE_PASSWORD = if ($ui.Count -gt 1) { [System.Uri]::UnescapeDataString($ui[1]) } else { "" }
& psql $PgUrl -v ON_ERROR_STOP=1 -c "SELECT 1" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "FAIL: DATABASE_* 推导后仍连不上 host=$($env:DATABASE_HOST) db=$($env:DATABASE_NAME)" }
Write-Host "KH-E2E db-ready host=$($env:DATABASE_HOST) db=$($env:DATABASE_NAME)"

try {
  # ── 1. 依赖 ──
  $p = Start-Process cmd.exe -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }
  $p = Start-Process cmd.exe -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

  # ── 2. migration（含本 sprint 投影表）+ 账本表前置 ──
  $p = Start-Process cmd.exe -ArgumentList "/c npm.cmd run migrate" -WorkingDirectory "$repoRoot\apps\api" -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: migrate exit=$($p.ExitCode)" }
  $nullable = (& psql $PgUrl -t -A -c "SELECT is_nullable FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='knowledge_entries_projection' AND column_name='org_id'" | Out-String).Trim()
  if ($nullable -ne "NO") { throw "FAIL: 投影表 org_id 未 NOT NULL got=$nullable" }
  # public.learnings 属 cecelia repo，不在本仓 migrations；缺表时用本 sprint committed fixture 建（登记见「未覆盖真实链路清单」#4）
  $ledger = (& psql $PgUrl -t -A -c "SELECT to_regclass('public.learnings')" | Out-String).Trim()
  if (-not $ledger) {
    & psql $PgUrl -v ON_ERROR_STOP=1 -f "$scriptDir\fixtures\learnings-ledger.sql" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "FAIL: 账本 fixture DDL 应用失败" }
    $ledger = (& psql $PgUrl -t -A -c "SELECT to_regclass('public.learnings')" | Out-String).Trim()
  }
  if (-not $ledger) { throw "FAIL: public.learnings 不存在且 fixture 未建成 — 录入链路无处可写" }

  # ── 3. 两家 tenants 行 + 员工目录分组 env（A30 四项必须成立，否则下一步起不来）──
  $sfx = [guid]::NewGuid().ToString("N").Substring(0,8)
  $OrgA = (& psql $PgUrl -t -A -c "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('E2E-UI-A-$sfx','free') RETURNING id" | Out-String).Trim()
  $OrgB = (& psql $PgUrl -t -A -c "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('E2E-UI-B-$sfx','free') RETURNING id" | Out-String).Trim()
  if (-not $OrgA -or -not $OrgB) { throw "FAIL: tenants 行未建成 A=$OrgA B=$OrgB" }
  $env:STAFF_EMAILS = $OrgaEmail
  $env:STAFF_FEISHU_OPENIDS = $OrgaOpenId
  $env:STAFF_EMAILS__ORGA = $OrgaEmail
  $env:STAFF_FEISHU_OPENIDS__ORGA = $OrgaOpenId
  $env:STAFF_FEISHU_OPENIDS__ORGB = $OrgbOpenId
  $env:STAFF_ORG_MAP = "ORGA:$OrgA,ORGB:$OrgB"
  $env:FEISHU_API_BASE = "http://localhost:$ApiPort/api/_smoke/fake-feishu"
  $env:FEISHU_APP_ID = "e2e-app-id"
  $env:FEISHU_APP_SECRET = "e2e-app-secret"
  if (-not $env:BETTER_AUTH_SECRET) { $env:BETTER_AUTH_SECRET = "e2e-knowledge-hub-secret-not-for-prod-32ch" }
  $env:NODE_ENV = "development"
  $env:PORT = "$ApiPort"

  # ── 4. 起真实 apps/api，并证明 A30 自检真跑过（只验端口通是假绿）──
  $p = Start-Process cmd.exe -ArgumentList "/c npm.cmd run build --workspace=apps/api" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: apps/api build exit=$($p.ExitCode)" }
  $apiOut = "$scriptDir\api-stdout.log"; $apiErr = "$scriptDir\api-stderr.log"
  $apiProc = Start-Process cmd.exe -ArgumentList "/c node dist\index.js" -WorkingDirectory "$repoRoot\apps\api" `
    -PassThru -NoNewWindow -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr
  $waited = 0
  do { Start-Sleep -Seconds 1; $waited++
       $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
  } while (-not $conn.TcpTestSucceeded -and $waited -lt 40)
  if (-not $conn.TcpTestSucceeded) {
    Write-Host (Get-Content $apiOut,$apiErr -ErrorAction SilentlyContinue | Select-Object -Last 40 | Out-String)
    throw "FAIL: apps/api 未在 40s 内就绪（A30 自检拦住启动？见上方日志尾部）"
  }
  if (-not (Select-String -Path $apiOut,$apiErr -Pattern "A30 staff-directory selfcheck passed" -Quiet)) {
    throw "FAIL: 启动日志无 A30 自检通过标记 — 自检根本没跑"
  }

  # ── 5. build + vite preview（VITE_SKIP_AUTH 固定前端门禁，授权判定仍全在服务端）──
  $p = Start-Process cmd.exe -ArgumentList "/c npm.cmd run build" -WorkingDirectory "$repoRoot\apps\staff-hub" `
    -Wait -PassThru -NoNewWindow -Environment @{ VITE_SKIP_AUTH = "true"; VITE_MOCK_USER_EMAIL = $OrgaEmail }
  if ($p.ExitCode -ne 0) { throw "FAIL: staff-hub build exit=$($p.ExitCode)" }
  $viteProc = Start-Process cmd.exe -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
    -WorkingDirectory "$repoRoot\apps\staff-hub" -PassThru -NoNewWindow `
    -Environment @{ STAFF_HUB_API_TARGET = "http://localhost:$ApiPort" }
  $waited = 0
  do { Start-Sleep -Seconds 1; $waited++
       $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
  } while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
  if (-not $conn.TcpTestSucceeded) { throw "FAIL: vite preview 未在 30s 内就绪" }

  # ── 6. Playwright（真浏览器、真后端、禁 page.route）──
  $e2e = Start-Process cmd.exe -ArgumentList "/c npx.cmd playwright test e2e\knowledge-hub-path1.spec.ts --reporter=list" `
    -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow `
    -Environment @{ E2E_BASE_URL = "http://localhost:$VitePort"; E2E_LOGIN_CODE = "e2e-code-orga" }
  if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright E2E exit=$($e2e.ExitCode)" }

  # ── 7. 截图防造假：三张都必须是本轮写的 ──
  $shotDir = "$repoRoot\apps\staff-hub\screenshots"
  $fresh = 0
  foreach ($n in @("01-initial.png","02-action.png","03-result.png")) {
    $f = Join-Path $shotDir $n
    if (-not (Test-Path $f)) { throw "FAIL: 缺截图 $n" }
    $mtime = (Get-Item $f).LastWriteTime
    if ($mtime -lt $ScriptStart) { throw "FAIL: $n LastWriteTime=$mtime 早于脚本启动 $ScriptStart — 疑似历史截图冒充" }
    $fresh++
  }
  New-Item -ItemType Directory -Path "$scriptDir\screenshots" -Force | Out-Null
  Get-ChildItem "$shotDir\*.png" | Copy-Item -Destination "$scriptDir\screenshots"
  Write-Host "KH-E2E screenshots-fresh: $fresh"

  # ── 8. 交叉回读：UI 上看到的那条，必须在账本里是同一 entry_id 且带本组织归属 ──
  $idFile = "$repoRoot\apps\staff-hub\kh-e2e-entry-id.txt"
  if (-not (Test-Path $idFile)) { throw "FAIL: spec 未落下 UI 可见条目的 entry_id" }
  $entryId = (Get-Content $idFile -Raw).Trim()
  if (-not $entryId) { throw "FAIL: entry_id 为空" }
  $ledgerRows = (& psql $PgUrl -t -A -c "SELECT count(*) FROM public.learnings WHERE id='$entryId' AND metadata->>'org_id'='$OrgA' AND created_at > '$StartIso'" | Out-String).Trim()
  if ($ledgerRows -ne "1") { throw "FAIL: UI 可见的 entry_id=$entryId 在账本里查不到本轮带归属行 count=$ledgerRows" }
  Write-Host "KH-E2E ledger-verified entry_id=$entryId"
  Write-Host "✅ windows_cloud UI E2E 通过"
}
finally {
  if ($apiProc) { Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue }
  if ($viteProc) { Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue }
  if ($PgUrl -and $OrgA) {
    & psql $PgUrl -c "DELETE FROM public.learnings WHERE metadata->>'org_id' IN ('$OrgA','$OrgB')" | Out-Null
    & psql $PgUrl -c "DELETE FROM zenithjoy.tenant_members WHERE tenant_id IN ('$OrgA','$OrgB')" | Out-Null
    & psql $PgUrl -c "DELETE FROM zenithjoy.tenants WHERE id IN ('$OrgA','$OrgB')" | Out-Null
  }
}
exit 0
```

Playwright spec（`apps/staff-hub/e2e/knowledge-hub-path1.spec.ts`）必须含的显式断言（`VITE_SKIP_AUTH=true` 已固定前端门禁，故本 spec 唯一变量是**服务端会话**）：

```javascript
// 1. 有前端门禁但无服务端会话 → 知识页渲染出来，但内容区是会话失效提示
await page.goto('/knowledge/recent');
await expect(page.getByTestId('knowledge-session-expired')).toBeVisible({ timeout: 10000 });
await expect(page.getByTestId('knowledge-session-expired')).toHaveText('登录已失效，请重新登录');

// 2. 走真实 feishu-login 拿服务端会话（page.request 与页面共用同一 cookie jar，
//    经 vite preview 反代打到真 apps/api；不用 /login/feishu 路由——已登录 shell 下它被 Navigate 到 /）
const login = await page.request.post('/api/staff/feishu-login', { data: { code: process.env.E2E_LOGIN_CODE } });
expect(login.status()).toBe(200);

// 3. 录入页提交
await page.goto('/knowledge/new');
await page.getByTestId('knowledge-trigger-condition').fill('E2E 触发条件');
await page.getByTestId('knowledge-conclusion').fill(unique);
await page.getByTestId('knowledge-evidence-url').fill(evidenceUrl);
await page.screenshot({ path: shot('01-initial.png') });
await page.getByTestId('knowledge-submit').click();
await expect(page.getByTestId('knowledge-submit-result')).toBeVisible({ timeout: 10000 });
await page.screenshot({ path: shot('02-action.png') });

// 4. 「最近沉淀」页 30 秒内可见该条 + 证据链接可点
await page.goto('/knowledge/recent');
const row = page.locator('[data-testid^="knowledge-entry-"]').filter({ hasText: unique }).first();
await expect(row).toBeVisible({ timeout: 30000 });
await expect(row.getByRole('link')).toHaveAttribute('href', evidenceUrl);
await page.screenshot({ path: shot('03-result.png') });

// 5. 交叉验证后端 + 落下 entry_id 供 ps1 回读账本（防前端撒谎）
const api = await page.request.get('/api/staff/knowledge/recent');
const body = await api.json();
const hit = body.data.items.find(i => i.conclusion === unique);
if (!hit) { throw new Error('FAIL: 后端未见该条'); }
expect(await row.getAttribute('data-testid')).toBe('knowledge-entry-' + hit.entry_id);
fs.writeFileSync(path.resolve(process.cwd(), 'kh-e2e-entry-id.txt'), hit.entry_id);
console.log('KH-E2E ui-entry-id=' + hit.entry_id);
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 员工目录解析 + A30 四项自检 | `tests/staff-directory-selfcheck.test.ts` | `A30-1a 扁平等于企业A分组`｜`A30-1b 分组并集包含扁平`｜`A30-2 归属唯一`｜`A30-3 STAFF_ORG_MAP uuid 在 tenants 中存在` | 模块 `staff-directory.ts` 不存在 → 4 failures |
| knowledgeAuthGuard 只信会话 | `tests/knowledge-auth-guard.test.ts` | `无会话返回 401 SESSION_REQUIRED`｜`伪造身份头不改变判定`｜`有会话无成员行返回 403 NO_TENANT` | 中间件 `knowledge-auth.ts` 不存在 → 3 failures |
| 知识端点落库与读端 | `tests/knowledge-entries.test.ts`（integration，真 PG）| `录入返回 201 且 data.org_id 等于声明组织`｜`缺组织上下文返回 403 NO_ORG_CONTEXT 且零写入`｜`最近沉淀只返回本组织条目`｜`账本不可达返回 503 LEDGER_UNREACHABLE` | 路由未注册 → 4 failures |
| A31 前置保护 | `tests/staffguard-endpoints-invariant.test.ts` | `staffGuard 端点计数等于 16`｜`adminFetch 仍拼两个身份头` | 计数脚本不存在 → 2 failures |

> 需要真 Postgres 的用例按本仓约定放 integration 位置（`*.integration.test.ts`，`npm run test:integration` 走 `vitest.integration.config.ts`），CI 由带 postgres service 的 job 跑。

---

## 接缝清单（真目标验证要求）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 本 sprint 状态 |
|---|---|---|---|---|
| S-1 | 飞书 OAuth 上游 | 真飞书服务器发 code、换 token | 主理人在 staging 用真飞书账号真登录一次，人工确认 Set-Cookie 三属性 + psql 反查成员行 | **logic-done-pending**（CI 用假上游，见未覆盖清单 #1）|
| S-2 | 生产 zenithjoy API ↔ cecelia 账本是否同一 PG 实例 | hk-vps 生产拓扑 | 运行时 ledger identity preflight 每次录入前真证明；不过即 503 拒写 | **logic-done-pending**（本地/CI 已真验 preflight 行为，生产拓扑待 staging 实测）|
| S-3 | 真实浏览器上的「最近沉淀」页可见性 | windows-latest 真 Chromium 渲染 | `e2e-verify.ps1` + Playwright 真跑，截图带时间戳防伪 | **本 sprint 内真验**（windows_cloud 车道）|
| S-4 | 既有 16 端点在真前端下仍可用 | Staff Hub 真实页面调用 | 本 sprint 以静态断言（头未摘 + 计数=16 + staffGuard 零 diff）做前置保护；真双向断言属 A31 后续 sprint | **logic-done-pending**（见未覆盖清单 #2）|

**未真验项一律标 `logic-done-pending`，不得标 done。**

---

## 预期受影响文件（按仓库实测路径修正 PRD）

| 文件 | 动作 | 备注 |
|---|---|---|
| `apps/api/src/routes/staff.ts` | 改 | `feishu-login` 签发会话 + 按声明组织入驻；**`router.use(staffGuard)` 及其后 11 个端点一行不动** |
| `apps/api/src/routes/knowledge.ts` | 新增 | 录入 + 最近沉淀 + 投影表只读读端；挂 `knowledgeAuthGuard` |
| `apps/api/src/middleware/knowledge-auth.ts` | 新增 | 只信会话，零 header 回落（A27 扫描目标）|
| `apps/api/src/middleware/staff.ts` | **不动** | 相对 base_sha 零 diff（Step 8 断言）|
| `apps/api/src/middleware/tenant-context.ts` | **不动** | GP 合同 blast_radius ⑤：改错即 line04 现网客服配置闸失效 |
| `apps/api/src/staff-directory.ts` | 新增 | 分组 env 解析 + `STAFF_ORG_MAP` + A30 四项自检 |
| `apps/api/src/index.ts` | 改 | 启动时调 A30 自检，失败非 0 退出 |
| `apps/api/src/routes/_smoke-fake-feishu.ts` | 新增 | 假飞书上游，`NODE_ENV=production` 一律 404（沿用 C6 模式）|
| `apps/api/src/app.ts` | 改 | 挂载 knowledge 路由 + 条件挂载假飞书上游 |
| `apps/api/db/migrations/20260819_*_knowledge_entries_projection.sql` | 新增 | 投影表，`org_id NOT NULL`，DDL 幂等（**注意是 `apps/api/db/migrations/`，PRD 写的 `apps/api/migrations/` 不存在**）|
| `apps/staff-hub/src/lib/knowledgeFetch.ts` | 新增 | 只带 cookie，零身份头（不得复用 `adminFetch`）|
| `apps/staff-hub/src/lib/adminFetch.ts` | **不动** | 既有 16 端点靠它带头 |
| `apps/staff-hub/src/pages/KnowledgeNewPage.tsx` / `KnowledgeRecentPage.tsx` | 新增 | 录入界面 + 「最近沉淀」页，带 `data-testid` |
| `apps/staff-hub/src/App.tsx` | 改 | **只在已登录 shell 的 `Routes` 里加 `/knowledge/new`、`/knowledge/recent` 两条路由 + 侧栏入口**；`!isAuthenticated` 分支（`App.tsx:47-53`）与既有 16 端点相关结构**一行不动**。前端 `isAuthenticated`（`AuthContext` 客户端态）只管导航体验，知识面授权判定一律在服务端 `knowledgeAuthGuard`（见「第二段」段首说明）|
| `<SPRINT_DIR>/fixtures/learnings-ledger.sql` | 新增 | windows runner 缺 `public.learnings` 时的账本建表 fixture，**必须 `pg_dump -s -t public.learnings` 从真 cecelia 账本导出**，不得手写猜列（未覆盖清单 #4）|
| `.github/workflows/e2e-windows.yml` | **不动** | 跨 sprint 共用壳；且 GHA `services:` 只支持 Linux runner，windows 上不能挂 postgres service — 前置一律在 `e2e-verify.ps1` 内自建 |
| `apps/staff-hub/e2e/knowledge-hub-path1.spec.ts` | 新增 | UI E2E spec，禁 `page.route()` |
| `.github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh` | 新增 | 支持 `--a27-only` 子模式；核心断言 = A30 自检 |
| `.github/workflows/scripts/smoke-baseline.txt` | 改 | 追加上述 smoke 文件名（不加 = 只是 warning 不闸，C11）|
| `.github/workflows/scripts/count-staffguard-endpoints.mjs` | 新增 | staffGuard 端点计数器（Step 8 用）|
| `<SPRINT_DIR>/e2e-verify.ps1` | 新增 | windows_cloud 车道入口（C12）|
