# Sprint Contract Draft (Round 2) — 员工知识中枢 路③ 结构化工作台 · Sprint A

**journey_type**: user_facing
**target_environment**: windows_cloud
**journey_id**: da60cb26-5635-4f51-a1f3-a80013f6d69d
**上位合同**: `.harness/gp3-contract-v3.json`（CONTRACT IS LAW）。本合同执行化的上位断言 = **G0/G1/G2 + A1–A5、A8–A10、A30①、A33、A34、A35①**，不新增也不放宽任何一条。
**本地标签 A6 / A7 / A11 上位合同无此编号**（其 A-id 集合为 A1–A5、A8–A10、A13–A16、A18–A19、A21–A25、A27–A28、A30–A36）——这三个是本合同为 **PRD**「Golden Path 第 2/3 条（8 类字段 · 逐字还在）」「范围限定·开箱模板 ≥2」「边界情况第 1 条（多组织 fail-closed）」自建的本地断言编号，范围不越界，溯源以 PRD 为准。

## GP-Anchor

GP-Anchor: line11/structured_workbench#step1

- 本 sprint 推进 Journey `da60cb26`（员工知识中枢）的路③ 结构化工作台，Sprint A（四刀 A/B/C/D 串行第一刀）
- 锚定步骤 = Golden Path 的 step1「员工建起第一张表并且删错能还原」；Sprint B/C/D 分别锚 step2/3/4，本刀一行不写它们的范围

---

## Response Schema（推导来源: PRD 无 `## Response Schema` 段 → api_registry 推导 + 路① 同族先例）

> `GET localhost:5221/api/brain/registry?type=api` 返回的是 cecelia repo 的端点，与 zenithjoy `apps/api` 不同源，**不作为字段命名依据**。
> 实际依据 = 同一条 GP 的路① 已合并实现 `apps/api/src/routes/knowledge.ts:124-131`（成功体）与 `apps/api/src/middleware/knowledge-auth.ts:39-41`（失败体）——路③ 与路① 同族、同闸、同前端解析器（`apps/staff-hub/src/lib/knowledgeFetch.ts` 的 `knowledgeJson` 逐字读 `success` / `data` / `error.code` / `error.message`），响应形状**必须逐字沿用**，否则前端解析器要分叉。

### 统一成功体（全部路③ 端点）

```json
{"success": true, "data": { }}
```
- `success` (boolean, 必填): 字面 `true`。来源——路① `knowledge.ts:125`
- `data` (object, 必填): 端点各自的载荷，见下。来源——路① `knowledge.ts:126`

### 统一失败体（全部路③ 端点）

```json
{"success": false, "data": null, "error": {"code": "<string>", "message": "<string>"}, "timestamp": "<ISO8601>"}
```
- `error.code` (string, 必填) / `error.message` (string, 必填) / `timestamp` (string, 必填)。来源——路① `knowledge-auth.ts:40`

**错误码字面量集合**（前端据此分文案，实现不得改名）：
`SESSION_REQUIRED`(401) / `NO_TENANT`(403) / `LEDGER_UNREACHABLE`(503) / `MULTI_ORG_MEMBER`(409) / `NOT_FOUND`(404) / `CONFIRM_MISMATCH`(400) / `VALIDATION_FAILED`(400)

### Endpoint: POST /api/knowledge/db/tables（建表，写）

**Success (HTTP 201)**:
```json
{"success": true, "data": {"table_id": "<uuid>", "org_id": "<uuid>", "name": "<string>", "visibility": "org|private", "fields": [{"field_id": "<uuid>", "name": "<string>", "field_type": "<string>", "options": [], "display_order": 0}], "created_at": "<ISO8601>"}}
```
- `table_id` (string uuid, 必填): 来源——NFR「表/行/字段 id 一律 UUID」
- `org_id` (string uuid, 必填): **只来自 `req.workbenchIdentity.orgId`**；请求体里同名字段必须被忽略（路① `knowledge.ts` 同款先例，A1 反向断言的判据）
- `visibility` (string, 必填): 枚举字面 `"org"` | `"private"`，对应 PRD「组织可见」/「仅自己」
- `fields[].field_type` (string, 必填): 枚举字面 **`text` / `long_text` / `number` / `date` / `single_select` / `multi_select` / `person` / `url`** 八类，逐字不可改名
- `fields[].display_order` (number, 必填): 从 0 起的整数，决定字段顺序（A6「顺序逐字相同」的载体）

**禁用字段名**（出现即视为漂移，A6 反向断言）: `tenant_id`（路③ 侧一律 `org_id`）、`id`（表/字段主键对外一律 `table_id`/`field_id`）、`type`（一律 `field_type`）、`order`（一律 `display_order`）、`is_private`（一律 `visibility`）

### Endpoint: GET /api/knowledge/db/tables（本组织可见表列表，读）

```json
{"success": true, "data": {"tables": [{"table_id": "<uuid>", "name": "<string>", "visibility": "org|private", "field_count": 0, "created_at": "<ISO8601>"}]}}
```

### Endpoint: GET /api/knowledge/db/tables/:id（表详情，读）

成功体同建表的 `data`（含 `fields` 全量）。**不可达与不存在统一返 404 + `NOT_FOUND`，响应体逐字节相同**（合同 lifeline「反枚举」/ A8① / A28 口径）。

### Endpoint: GET /api/knowledge/db/tables/:id/fields（字段定义，读） / POST 同路径（加字段，写）

```json
{"success": true, "data": {"fields": [{"field_id": "<uuid>", "name": "<string>", "field_type": "<string>", "options": [], "display_order": 0}]}}
```

### Endpoint: DELETE /api/knowledge/db/tables/:id（软删，写）

请求体 `{"confirm_name": "<string>"}`，与表名逐字不等 → **400 `CONFIRM_MISMATCH` 且不执行删除**。
**Success (HTTP 200)**: `{"success": true, "data": {"table_id": "<uuid>", "deleted_at": "<ISO8601>"}}`

### Endpoint: GET /api/knowledge/db/trash（回收站，读） / POST /api/knowledge/db/trash/:id/restore（还原，写）

```json
{"success": true, "data": {"tables": [{"table_id": "<uuid>", "name": "<string>", "deleted_at": "<ISO8601>", "restorable_until": "<ISO8601>"}]}}
```
还原成功体：`{"success": true, "data": {"table_id": "<uuid>", "restored_at": "<ISO8601>"}}`

### Endpoint: GET /api/knowledge/db/templates（开箱模板，读）

```json
{"success": true, "data": {"templates": [{"template_key": "<string>", "name": "<string>", "fields": [{"name": "<string>", "field_type": "<string>", "options": [], "display_order": 0}]}]}}
```
`templates` 长度 **≥ 2**（PRD 假设「取合同下限 ≥2」）。

**端点清单固定为 9 个**（4 写 + 5 读）：写 = `POST /tables`、`POST /tables/:id/fields`、`DELETE /tables/:id`、`POST /trash/:id/restore`；读 = `GET /tables`、`GET /tables/:id`、`GET /tables/:id/fields`、`GET /trash`、`GET /templates`。A1 遍历 4 个写端点，A3 遍历全部 9 个。

---

## 真实调用方请求 shape

> 路③ 的生产调用方 = Staff Hub 浏览器页面。摘自已合并的同族前端 `apps/staff-hub/src/lib/knowledgeFetch.ts:25-31`（路① 生产代码，不是推测）：

```ts
return fetch(url, {
  ...init,
  credentials: 'include',                                   // 认证唯一来源：同源会话 cookie
  headers: { ...(init?.headers ?? {}), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
});
```

**逐字段结论（DoD 断言构造请求时必须与此一致）**：

| 项 | 生产调用方实际值 | 合同要求 |
|---|---|---|
| 认证载体 | 会话 cookie（`credentials: 'include'`），**零身份头** | 断言一律用 `curl -b <cookiejar>`；禁止用 `X-User-Email` / `X-Feishu-User-Id` / `X-Internal-Token` 构造"成功路径" |
| Content-Type | 有 body 时 `application/json`，无 body 时不带 | 同 |
| 组织归属字段 | 前端**从不发送** org_id/tenant_id | 服务端从会话解析；请求体带 org_id 时必须被忽略（A1 判据） |

路③ 前端必须新建 `apps/staff-hub/src/lib/workbenchFetch.ts` 或直接复用 `knowledgeFetch`——**绝不复用 `adminFetch.ts`**（它拼两个明文身份头，是既有 16 个 staffGuard 端点的凭据，两条路各走各的，谁都别动谁）。

---

## 已知约束

### [回归测试] 来源：`apps/staff-hub/e2e/knowledge-hub-path1.spec.ts`、`apps/dashboard/e2e/crm-aggrid.spec.ts`、`apps/api/src/middleware/*.test.ts`、`.github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh`

- [knowledge-hub-path1-smoke.sh:§9] → `adminFetch.ts` 必须仍含 `X-User-Email` 与 `X-Feishu-User-Id`；`count-staffguard-endpoints.mjs` 计数必须 **= 16**。本刀新增端点若误挂 staffGuard，该计数会变 17 → 路① smoke 报红。
- [knowledge-hub-path1-smoke.sh:§8] → `apps/api/src` 内对 `knowledge_entries_projection` 的 INSERT/UPDATE/DELETE 必须为 0（SSOT 单向）。本刀不得触碰该表。
- [knowledge-hub-path1-smoke.sh:A27] → `knowledge-auth.ts` / `routes/knowledge.ts` / `knowledgeFetch.ts` 三文件零身份头名。本刀泛化守卫时不得削弱这三个扫描目标。
- [knowledge-hub-path1-smoke.sh:§1-2] → 启动自检必须打印 `A30 staff-directory selfcheck passed` 与四个检查项名，且四条变异 proven-to-fire。本刀新增的 A11 自检**并入同一启动闸**，不得让原四项消失。
- [fields-smoke.sh 全篇] → 当前用 `X-Internal-Token` 调 `/api/fields` 四端点并断言 2xx。J7 段① 挂鉴权后**该脚本必然被打成 401**，属必须同刀改的既有约束，不是回归。
- [zenithjoy-smoke-audit.sh] → 同上，含 `/api/fields` 探测，同刀改。
- [apps/dashboard `/works/fields` + `WorkDetailPage`] → dashboard 业务代码零改动前提下功能必须不变（防重演 PR#1675→#1676 的往返）。`PUT /fields/reorder` 除外（main 上本就无对应后端路由，不作基线）。
- [`apps/api/src/routes/_smoke-fake-feishu.ts`] → 路① 既有资产，本刀**必须扩展**（见下「假上游按成员寻址扩展」）。扩展为纯 fallback，`code-<ORGKEY>` 既有语义一字不改；`knowledge-hub-path1-smoke.sh` 的会话签发段改后仍须全绿（回归断言见 DoD ARTIFACT + INV 段）。

### 假上游按成员寻址扩展（路① 资产改动登记 — 本刀必做，形态定死）

**为什么必须改**：`resolveFakeFeishuIdentity`（`:67-72`）正则 `/code-([A-Za-z0-9_]+)$/` 要求 code **以 `code-<KEY>` 结尾且 KEY 内无 `-`**；`pickGroupMembers`（`:40-49`）只返分组里**第一个**非邮箱成员。① `wb-code-alice-<sfx>` 中间夹 `-` → 解析 NULL → 假上游回 `20021 invalid code` → 拿不到 `set-cookie`，实现写得再对也全部 401（**永久红，不是 TDD red**）；② 甲乙拿不到两个不同身份，A8「同组织他人 404 / 表主本人 200」这条本刀唯一的「可见性是真访问控制」判据没有第二个人可用。

**扩展形态（generator 照此实现，不许现场发挥）**：分组名查不到时回退到「按成员 `open_id` 精确寻址」——

```ts
if (key.toLowerCase() === 'noorg') return pickNoOrgMember();
return pickGroupMembers(key) ?? pickDeclaredMember(key);   // ← 新增的 fallback，既有分支一字不改
// pickDeclaredMember(openId): 遍历 parseOrgGroups(process.env)，某组 members.has(openId) 即返
//   { open_id: openId, name: `Fake ${orgKey} Member`, email: '' }；全组未命中返 null
```

**fixture 里 code 的确切字面形态** = `wb-code-<open_id>`，其中 `open_id` 形如 `ou_wb_alice_<sfx>`（`sfx` 为纯数字，全串仅含 `[A-Za-z0-9_]`，正则可整段捕获）。三个身份逐字为：`wb-code-ou_wb_alice_<sfx>` / `wb-code-ou_wb_bob_<sfx>` / `wb-code-ou_wb_carol_<sfx>`。

**同刀必补**：fixture 显式设 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（`routes/staff.ts:139-142` 两者缺一即返 500）。

**为什么不选方案 (b)**（不走 `/api/staff/feishu-login` 签发第二、三个会话）：那与本合同「禁 mock 边清单」第 1 条（必须真 `auth.api.getSession` + 真签发 cookie）直接冲突；且 Sprint B/C/D 三刀都要用「同组织多人」场景，改假上游一次摊薄四刀。

### [累积FR] 来源：`GET localhost:5221/api/brain/line/da60cb26-.../context-manifest`

`context-manifest: 返回空（HTTP 200 空体）`——本 journey 尚无 done/working ability 落库，累积 FR 取 PRD 已载明的一条：

- 路①知识沉淀（合同 G0 承接现状）: 员工会话经 `knowledgeAuthGuard` 鉴权 → 身份/组织归属只来自服务端会话 → 知识条目按组织隔离落库。**本刀复用/泛化该闸，只许更严不许更松**（原三态 401/403/503 文案与错误码不得改）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 员工在 Staff Hub 建起一张带 8 类自定义字段的表，选表级可见性；表按组织隔离；删表二次确认后软删进 30 天回收站，还原后逐字回归。同刀补齐 G0 会话鉴权闸、G1 旧 `/api/fields` 加鉴权+租户隔离、G2 `pg_dump` 定时备份与恢复演练 |
| **NFR（做得多好）** | 性能/可靠/阈值 | JSONB 行存**零运行时 DDL**（A10 机械闸）；表/行/字段 id 一律 UUID；命名空间固定 `/api/knowledge/db/*`；字段类型创建后不可变；单表行数上限 5000 与 AG Grid `32.2.1`、dnd-kit 三项**本刀只记账不引入**（Sprint B/C 执行） |
| **Invariant（永不违反）** | 不变量 | ① 身份与组织归属只来自服务端会话（G0 命门）② 五张新表 `org_id NOT NULL` ③ 跨组织不可达与不存在**逐字节同形 404** ④ 删除一律软删可还原 ⑤ 用户输入永不进标识符位、渲染后为文本节点 ⑥ 路③ 端点不得挂 staffGuard（16 端点计数不变） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表（6 条，其中 ⚠️ 3 条） |
| **保质期（何时过期）** | 何时失效、谁退役 | ① 回收站 30 天窗口——`restorable_until = deleted_at + 30 days`，过期清理任务**本刀不做**（Sprint D 记账，本刀只保证窗口内可还原）② G2 备份保留期 = 14 天（GHA artifact 上限口径），异地存储到期升级见「未覆盖真实链路清单」#2 ③ `field_definitions` 与 `db_fields` 两表并存是**合同裁决的长期形态**（J7 REC，不合并），无到期日；一旦将来合并须新开 decision |
| **死亡告警（停了谁知道）** | 停了谁在多久内知道 | ① 路③ smoke 进 `smoke-baseline.txt` → nightly 红即当日可见 ② `e2e-knowledge-hub-path3.yml` 挂 `on: pull_request` → 任何触碰路③ 源码的 PR 当场红 ③ G2 备份 workflow 挂 `schedule` → 失败即 GHA 通知，且恢复演练断言与备份**同一 workflow 同一次运行**（备份跑了但还不原 = 假绿，A5 判据） |
| **失败语义（挂了怎么办）** | 放行/拦截/重试/降级 | 见下方失败语义声明表。总原则：**一律 fail-closed**，任何"查不动/说不清"的情形都不得降级成"没权限"或"空列表" |
| **效果确认（已发≠已生效）** | 回执方式/时限 | ① 建表 → 回执 = `POST` 返 201 带 `table_id` **且** `psql` 在 `zenithjoy.db_tables` 查到该 id 且 `org_id` = 会话组织；只看 HTTP 201 不算 ② 删表 → 回执 = `deleted_at` 非空 **且物理行仍在**（`count(*)` 不减）③ 备份 → 回执 = 还原到临时库后五表逐条比对全等，不是 `pg_dump` exit 0 ④ 真浏览器 → 回执 = `e2e-knowledge-hub-path3.yml` 的 windows-latest job `conclusion == success`，不是 workflow 文件存在 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 一个员工到底属于哪个组织 | A. `tenant_members` 按 `created_at` 取第一条（路① `knowledge-auth.ts:64` 现状）; B. 查全部行，多于一行则**启动自检 fail-closed + 请求期 409 `MULTI_ORG_MEMBER`** | B | PRD 边界情况逐字要求「不静默取第一条」；A11 要求启动自检 fail-closed 并输出明确错误码。取第一条 = 用 `created_at` 的偶然顺序决定一条经营数据归谁，错了没有任何信号 | 员工的表被建进另一家企业，两家数据互穿且无告警——这是整条 GP 的命门级误判 |
| ⚠️ 「仅自己」的表对他人应该长什么样 | A. 403「没有权限」; B. **404 且响应体与随机不存在 id 逐字节相同** | B | 合同 lifeline「跨组织不可达与不存在统一返 404、同一文案、同一响应形状」；403 等于承认「这张表存在」，可被逐个 id 枚举出他人表清单 | 反枚举失效，攻击者用 403/404 差异枚举出他企业/他人的全部表 id |
| ⚠️ 备份到底能不能用 | A. `pg_dump` 退出码 0 + 产物文件非空; B. **还原到临时库后路③五表行数与关键字段逐条比对全等** | B | A5 逐字要求「从备份还原到临时库…逐条比对全等」。`pg_dump` 成功但备份内容缺 schema/缺表是真实存在的失败形态，退出码看不出来 | 真出事时才发现备份是空的——G2 的全部意义就在这一刻，误判即数据永久丢失 |
| 删表是不是真的删了 | A. 物理 `DELETE`; B. `deleted_at` 打时间戳、物理行保留、读路径过滤 | B | A9/A30① 逐字要求「删后 `deleted_at` 非空且物理行仍在」，且变异证明要求「改成物理 DELETE 必须转红」 | 员工删错表无法挽回，PRD Golden Path 第 5 步直接不成立 |
| windows 真浏览器到底跑没跑 | A. workflow 文件存在且含 `runs-on: windows-latest`; B. **该 job 的 `conclusion == success`（真执行过，不是被 job 级 if 门跳过）** | B | A33 在 v3 已把判据从 `on:` 块修正到 job 级 `if:`——现场 `e2e-staff-acceptance-windows.yml:124` 的 `if: github.event_name == 'workflow_dispatch'` 让按 v2 字面写的守卫恒绿而 spec 是孤儿 | spec 写了但从不运行，UI 面的 A6/A7/A8/A9 全部假绿 |
| 旧 `field_definitions` 隔离用哪个列 | A. 加 `org_id`（与路③ 对齐）; B. 加 `tenant_id`（与 works 家族对齐） | B | 合同 G1 逐字：旧表走 works 家族的 `tenant_id` 口径，两表并存不合并；段② 明确「照抄 `20260428_132000_unify_tenant_isolation.sql:64-83`」 | 列名与 works 家族分叉 → `tenantContext`/`tenantBypass` 中间件挂上去也过滤不到，隔离形同虚设 |

> `judgment-pending-user:` 无。上表三条 ⚠️ 判定点的取舍**均已由上位合同 `.harness/gp3-contract-v3.json` 逐字裁定**（分别对应 A11 / lifeline 反枚举条 / A5 与 A33），不是本合同自创，故不需再上呈拍板。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 无有效会话调路③ 任一端点 | 401 `SESSION_REQUIRED` | 是（无副作用） | 无降级，前端提示「登录已失效，请重新登录」 |
| 有会话但 `tenant_members` 无成员行 | 403 `NO_TENANT` | 是 | 无降级，前端提示「没有权限」 |
| `tenant_members` 查询本身失败（DB 不可达） | **503 `LEDGER_UNREACHABLE`，绝不吞成 403** | 是 | 无降级。吞成 403 会把网络/配置故障当成权限问题，排查方向直接跑偏（路① `knowledge-auth.ts:68-73` 已有先例） |
| 同一 `feishu_user_id` 多组织行 | **启动期：自检 fail-closed，进程在 listen 之前退出，日志点名 `A11-MULTI-ORG`；请求期：409 `MULTI_ORG_MEMBER`** | 是 | 无降级、无「取第一条」兜底 |
| 建表事务中途失败 | 整事务回滚，`db_tables` 与 `db_fields` 零残留，返 503 | 是（客户端重试产生新 `table_id`，不复用） | 无部分成功态 |
| 删表二次确认名不匹配 | 400 `CONFIRM_MISMATCH`，**不执行删除**，`deleted_at` 保持 NULL | 是 | 无 |
| 跨组织/不存在的 `table_id` | 404 `NOT_FOUND`，两种情形响应体逐字节相同 | 是 | 无。绝不用 403 区分「存在但没权限」 |
| G2 备份或恢复演练失败 | workflow job 红，**不 `continue-on-error`、不 `|| true`** | 否（下一次 schedule 重跑） | 无降级——静默的备份失败等于没有备份 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| Staff Hub 已鉴权员工提交的**表名 / 字段名 / 字段选项值** | 半可信（身份可信，内容不可信） | N/A —— 本刀无 LLM 消费路径；A35① 的排除清单正是为了让路③ 数据**将来也不进**问答检索域，从源头断掉这条注入面 | ① 一律作为**数据值走绑定参数**，永不进入 SQL 标识符位（零运行时 DDL 由 A10 机械钉死）② 渲染后必须是文本节点（本刀交付 8 类字段编辑器，XSS 面由 A18 在 Sprint B 全量覆盖，本刀先在字段名一处立断言）③ 组织归属永远取会话，请求体里的 `org_id`/`tenant_id` 一律忽略 |
| 外部匿名请求 | 不可信 | N/A | 无会话 = 401，九个端点无一例外 |

---

## 未覆盖真实链路清单

1. **备份的「异地」那一半** —— G2 要求「`pg_dump` 定时备份 + **异地存储** + 恢复演练」。本刀交付的 `db-backup.yml` 把备份落 GHA artifact（14 天保留）并在**同一次运行内**还原到临时库做全等比对；真正的异地对象存储（腾讯云 COS）需要 `COS_SECRET_ID`/`COS_SECRET_KEY` 两个仓库 secret，当前 repo 未配置且本 agent 无权 `gh secret set`（PAT scope 不足，见全局凭据规则）。**真验证补位计划**：主理人在 GitHub UI 配置两个 secret 后，由 Sprint B 的第一刀补 upload step 并把 A5 断言扩展到「从 COS 拉回的备份还原全等」；在此之前 G2 标 `logic-done-pending-offsite`，**备份与恢复演练两件本身是真跑真验的，不是 mock**。
2. **prod-hk 生产库的备份接线** —— 本刀的 schedule workflow 备份的是 CI 的 Postgres（`E2E_DATABASE_URL`）。生产 `hk-vps` 的 zenithjoy 库备份需要生产连接串，属主理人放行范围（AI 只部署 staging）。**补位计划**：主理人放行 staging→prod 时同步配置 `PROD_DATABASE_URL` secret，本刀的 workflow 已把库连接串参数化，届时改一个 input 即可，不需要改逻辑。
3. **NFR「3 名非技术员工 20 分钟内独立建表，2/3 达标」** —— 人工可用性测试，合同已标 `best_effort` 且明写「不阻塞发布」。本刀不设机械闸，记账到 sprint 目录。
4. **飞书 OAuth 上游（唯一被顶替的第三方 API）** —— 测试与 smoke 里签发会话走 `FEISHU_API_BASE` 指向本地假上游（`apps/api/src/routes/_smoke-fake-feishu.ts`），不打真飞书。**为什么**：真打飞书需要真 `code`（一次性、由用户浏览器授权产生），CI 里拿不到；路① 已合并实现用的就是这条路（`knowledge-hub-path1-smoke.sh:154`），本刀沿用同一先例保持一致。**这是端点重定向不是代码分支**——被测的 `/api/staff/feishu-login` 与整条会话签发路径一行不变。**真验证补位计划**：飞书登录这一跳属路① 已交付范围，其真上游验证由主理人在 staging 手动登录一次覆盖；本刀的九个路③ 端点全部**在会话已存在之后**才开始，不依赖飞书。
5. **Sprint B/C 记账三项（AG Grid `32.2.1` / dnd-kit / 5000 行上限）** —— PRD 明确「本刀只记账，引入与拦截在 Sprint B/C」。本刀**不引入依赖、不写拦截**，仅在 `sprints/.../accounting.md` 留一行；这不是 mock，是刀与刀的边界。

> 除以上四条外，本合同的全部断言均为真执行：真 Postgres、真起 `apps/api` 进程、真会话 cookie、真浏览器（windows-latest）、真 `pg_dump`/`pg_restore`。**无任何 `force_*` / stub / 假数据。**

---

## 禁 mock 边清单

- `workbenchAuthGuard` ↔ **better-auth 会话解析**（本单新建该闸，会话→身份这一跳是命门）：测试必须用真 `auth.api.getSession` + 真签发的会话 cookie，禁 `vi.mock('better-auth/node')`
- `workbenchAuthGuard` ↔ **`zenithjoy.tenant_members` 表**（本单改了归属判定：从"取第一条"改为"多行即 fail-closed"）：必须真 Postgres 真插真查，禁 stub DB 层
- 路③ service ↔ **`zenithjoy.db_tables` / `db_fields` / `db_rows` / `db_view_prefs` / `db_audit` 五张表**（本单是这五张表的 DB 写路径首发）：必须真 Postgres 验行落库、验 `org_id` 值、验 `deleted_at` 软删语义
- `apps/api/src/app.ts` **启动钩子** ↔ **A11 单组织自检**（生命周期钩子）：必须真起进程验「拦在 listen 之前」，禁只单测自检函数——自检函数返回 false 但没人调它，单测照样绿
- `fields.service.ts` ↔ **`zenithjoy.field_definitions` 表**（本单段② 改写路径，五处 SQL 补 `tenant_id` 条件）：必须真 Postgres 双租户种子验互不串
- `apps/staff-hub` 页面 ↔ **路③ API**（跨模块数据传递，且是 windows_cloud 变体C 死规则）：Playwright spec **禁 `page.route()`**，全部请求打真实 `apps/api`
- `apps/dashboard` `/works/fields` ↔ **`/api/fields` 端点**（本单给该端点挂鉴权，改的正是这条边）：A4④ 必须真浏览器带真会话跑，禁只跑单测

> 本清单是下游执法依据：generator 的测试中出现 `vi.mock` / `jest.mock` / 手写 stub 命中上述任一条边即违约（CONTRACT IS LAW），evaluator 机械 grep 核查。
> **允许 mock 的边（仅此一条）**：飞书 OAuth 上游——沿用路① 先例，走 `FEISHU_API_BASE` 指向本地假上游（`_smoke-fake-feishu.ts`），这是**环境端点重定向而非代码分支**，被测代码路径一行不变。

---

## 接缝清单（碰真实世界的点，必须在真目标验证）

| # | 接缝 | 碰真实世界在哪 | 真目标验证方式 | 未真验时的状态 |
|---|---|---|---|---|
| S1 | 会话 → 组织归属 | better-auth 真会话 + `tenant_members` 真表 | `structured-workbench-smoke.sh` 真起 `apps/api` + 真 PG 双企业种子；A1/A3 成对执行 | `logic-done-pending` |
| S2 | 五张新表的 DDL 与软删语义 | 真 Postgres migration 重放（CI for 循环会重放全部 migration，非幂等语句第二次必炸） | smoke 段2 真跑 migration + `information_schema` 比对（A10） | `logic-done-pending` |
| S3 | 员工在真浏览器里建表/删表/还原 | windows-latest 干净 VM 的 Chromium + 真 `apps/api` + 真 PG | `e2e-knowledge-hub-path3.yml` 的 windows job `conclusion == success`（A33 判据 = job 真跑过，不是文件存在） | `logic-done-pending` |
| S4 | 给 `/api/fields` 挂鉴权后 dashboard 是否被打断腿 | 真浏览器带真会话操作 `/works/fields` 与 `WorkDetailPage` | 同一 workflow 内 `apps/dashboard/e2e/fields-auth-regression.spec.ts`（A4④），业务代码零改动 | `logic-done-pending`；**这是 PR#1675→#1676 往返的唯一防线，未真验绝不许标 done** |
| S5 | 备份产物能不能还原 | 真 `pg_dump` + 真 `pg_restore` 到临时库 | `db-backup.yml` 同一次运行内还原并逐条全等比对（A5） | `logic-done-pending-offsite`（异地那一半见未覆盖清单 #1） |

**禁写死环境假设值自查**：本合同不写死任何端口/UUID/连接串——API 端口取 `WORKBENCH_SMOKE_PORT`（默认 52320，可覆盖）、DB 取 `E2E_DATABASE_URL` → `DATABASE_URL` → 显式打印来源、租户 id 与员工 open_id 全部由 smoke 运行时 `INSERT ... RETURNING` 现生成并带 `$SFX` 后缀。INV-7 用机械命令钉住这一条。

---

## 夹具供给协议（让 DoD 断言不依赖脚本自述）

**问题**：DoD 里 22/28 条形如「跑 `structured-workbench-smoke.sh --aN-only`，输出含 `A7 通过`」——脚本是 generator 自己写的，`echo "A7 通过"; exit 0` 就能满分（作弊反例清单第 10 条「grep 自己 echo 的串」）。**修法**：脚本只负责**供给环境**（起真 `apps/api`、种双企业、签发三个真会话），**判定一律写在 DoD 命令里**由 evaluator 直接执行。

```bash
bash "$SMOKE" --fixture-up      # 起真 apps/api + 真 PG 双企业种子 + 三个真会话；把变量写进 ./.wb-fixture.env；不做任何判定
. ./.wb-fixture.env             # 供给的变量（全部运行时生成，零写死）：
                                #   API_PORT / SFX / ORGA_TENANT_ID / ORGB_TENANT_ID
                                #   COOKIE_A（A企业·甲/表主） COOKIE_A2（A企业·乙/同组织他人） COOKIE_B（B企业·丙）
                                #   EIGHT_FIELDS（八类字段各一的 JSON 数组，建表请求载荷；DoD 用前先自检 unique 长度 == 8）
bash "$SMOKE" --fixture-down    # 停服务 + 清种子
```

`--fixture-up` / `--fixture-down` **禁止内含任何 pass/fail 判定与「通过」字样**。DB 侧断言的 `PGURL` **一律直接取 `${E2E_DATABASE_URL:-$DATABASE_URL}`，不从 `.wb-fixture.env` 取**——这样 psql 那一半完全绕开脚本，脚本无从代答。三个 cookie 是真签发的会话（假 cookie 打真 API 只会拿 401，断言当场红）。

SQL 字符串字面量在 DoD 命令里一律用 **PostgreSQL 美元引用 `$$...$$`**（在 `bash -c '...'` 里写作 `\$\$`），避免与外层单引号打架；时间窗用 `NOW() - make_interval(mins => 5)`（等价 5 分钟窗口，同样免单引号）。

---

## 变异证明执行协议（判据外置 — 守卫说自己红了不算数）

**问题**：`--mutation X` 里「施加变异 + 判定是否转红 + 打印 `proven-to-fire`」由同一个脚本自述，空实现 `echo "X proven-to-fire"` 就能满分。**本合同一律改为三步外置**，判据落在「被守卫的那条断言自己真的 exit≠0」：

```bash
bash "$SMOKE" --mutation-apply <NAME>      # 只改代码/数据，不做任何判定，exit 0 表示"变异已施加"
bash "$SMOKE" --<aN>-only                  # 判据在这里：必须 exit ≠ 0，等于 0 即守卫是空的
bash "$SMOKE" --mutation-revert <NAME>     # 还原，exit 0；无论上一步结果如何都必须执行
```

`--mutation-apply` 与 `--mutation-revert` **禁止内含任何 pass/fail 判定与 `proven-to-fire` 字样**；`--mutation-list` 每行打印 `<变异名><空白><注入次数>`，行数 = 本合同登记的 9 个。`--mutation-apply` 还必须把**本次被注入的目标文件路径**写进 `./.wb-mutation-target`（供 INV-4/INV-7 断言「扫描器输出点名了这个文件与行号」，脚本无从代答）。DoD 每条变异断言均写成上面三步的一行 `bash -c`，中间那步 exit≠0 才算通过。

**本刀变异登记（9 个开关 / 19 次注入）**：段1 静态 14 次 = `A2-inject-all`(7) + `A35-drop-name`(5) + `INV4-inject-secret`(1) + `INV7-inject-hardcoded-env`(1)；段2 真库 4 次 = `A1-header-fallback` / `A8-deny-all` / `A9-hard-delete` / `A11-take-first` 各 1；段2b 备份 1 次 = `A5-schema-only`。**这 19 是本刀可核对的确切计数**（上位合同「12 条变异」是整条 GP 四刀的口径，含 A13/A16/A25/A30②③/A34/A36 等 Sprint B/C/D 项，不是本刀数字）。

---

## Golden Path

[员工登录 Staff Hub] → [Step1 工作台入口看到 ≥2 模板] → [Step2 新建表 + 8 类字段 + 可见性] → [Step3 本组织列表可见 · 刷新逐字还在 · 跨组织不可达] → [Step4 「仅自己」正反双向] → [Step5 二次确认删表 → 回收站还原逐字回归] → 底座三门 [Step6 G0 闸] / [Step7 G1 旧 fields 处置] / [Step8 G2 备份] → [Step9 单组织自检 fail-closed] → [Step10 A35①/A33 接线]

---

### Step 1: 员工打开结构化工作台，空工作台显示 ≥2 个开箱模板，一键建表结构与模板声明逐字一致

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 条 +「范围限定·在范围内」的「开箱模板」+「假设」第 3 条（模板数取下限 ≥2）。**本地标签 A7，上位合同无此编号**，要求实体来自 PRD。

**可观测行为**: 新组织员工首次进 `/workbench`，页面出现 ≥2 张模板卡片；点其中一张一键建表后，新表的字段集（名/类型/选项/顺序）与该模板声明逐字一致。

**验证命令**:
```bash
# 模板端点返回 ≥2 个模板（真 API + 真会话 cookie）
curl -sf -b "$COOKIE_A" "http://localhost:$API_PORT/api/knowledge/db/templates" \
  | jq -e '.success == true and (.data.templates | length) >= 2' || exit 1
# 一键建表后，落库字段集与模板声明逐字一致（真 PG 比对，非只看 HTTP 201）
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a7-only
```

**硬阈值**: `templates` 长度 ≥ 2；一键建表后 `db_fields` 中该表的 `(name, field_type, options, display_order)` 有序元组集合与模板声明**完全相等**（差一个字即 FAIL）；`--a7-only` exit 0。

---

### Step 2: 员工新建表，逐个添加 8 类自定义字段并选可见性，提交后建表成功且不产生任何运行时 DDL

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2、3 条（八类字段 · 逐字还在）+「NFR 约束」的「JSONB 行存，不做运行时 DDL」。A10 对应上位合同断言；**本地标签 A6 上位合同无此编号**，要求实体来自 PRD 上述两条。

**可观测行为**: 提交后返回 201 带 `table_id`；`zenithjoy.db_tables` 出现该行且 `org_id` = 会话组织；`db_fields` 出现 8 行覆盖 `text/long_text/number/date/single_select/multi_select/person/url` 八类各一；`information_schema.tables` 的 zenithjoy 表清单**一张都没多**。

**验证命令**:
```bash
# 建表：请求体故意塞 org_id 指向他企业，服务端必须忽略它
TID=$(curl -sf -b "$COOKIE_A" -X POST "http://localhost:$API_PORT/api/knowledge/db/tables" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"WB-$SFX\",\"visibility\":\"org\",\"org_id\":\"$ORGB_TENANT_ID\",\"fields\":$EIGHT_FIELDS}" \
  | jq -r '.data.table_id')
# 落库归属取会话，不取请求体（时间窗防历史行冒充）
psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.db_tables WHERE id='$TID' AND org_id='$ORGA_TENANT_ID' AND created_at > NOW() - interval '5 minutes'" | grep -qx 1 || exit 1
# 八类字段各一，且顺序列存在
psql "$PGURL" -t -A -c "SELECT count(DISTINCT field_type) FROM zenithjoy.db_fields WHERE table_id='$TID'" | grep -qx 8 || exit 1
# A10：零运行时 DDL —— 建表前后 zenithjoy 表清单快照必须全等
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a10-only
```

**硬阈值**: HTTP 201；`db_tables` 命中 1 行且 `org_id` = **会话组织**（请求体里的 `ORGB` 被忽略）；`db_fields` 的 `field_type` 去重计数 = 8；建表前后 `information_schema.tables WHERE table_schema='zenithjoy'` 集合 diff 为空且与 migration 声明集合相等；`--a10-only` exit 0。

---

### Step 3: 刷新页面后字段定义逐字还在；该表出现在本组织列表、不出现在他组织列表；持 B 企业会话伪造头指向 A 企业写路③ 端点被拒且 A 企业行逐字未变

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3、4 条 +「E2E 验收」第 1、3 条；对应上位合同 **G0 命门**与断言 A1（反向）/ A3（正向对照）/ A6（后半）

**可观测行为**:
- 重新 `GET /tables/:id`，`fields` 的 `(name, field_type, options, display_order)` 与建表时逐字相同
- A 企业员工 `GET /tables` 含该表；B 企业员工 `GET /tables` 不含
- 持 **B 企业真实会话** + 伪造 `X-Tenant-Id: <A>` / `body.tenant_id: <A>` 逐个打 4 个写端点 → 全部 4xx 或空集，且 A 企业对应行前后 `SELECT` diff 为空
- **正向对照**：A 企业真实会话打全部 9 个端点逐个 2xx 且返回的是 A 自己的数据（防「一律 403」假绿）

**验证命令**:
```bash
# A1 反向 + A3 正向，同一套种子、同一次运行内成对执行（分开跑等于没对照）
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a1-a3-only
# 变异证明（判据外置）：把闸改回「有头则读头」，A1 段自己必须 exit≠0
S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh
bash "$S" --mutation-apply A1-header-fallback
bash "$S" --a1-a3-only; RC=$?; bash "$S" --mutation-revert A1-header-fallback; [ "$RC" -ne 0 ] || exit 1
```

**硬阈值**: 4 个写端点 × 伪造头 → 全部返回码 ∈ {400,401,403,404,409} 或响应 `data` 为空集，**零 2xx**；A 企业行前后 `md5(row)` 全等；9 个读写端点在 A 会话下**全部 2xx**（哪怕一个 403 即 FAIL，因为那说明闸在"一律拒绝"）；变异 `A1-header-fallback` 必须让 A1 段报红（exit≠0 且日志点名 `A1`），未报红即守卫是空的。

---

### Step 4: 表级可见性「仅自己」是真访问控制 —— 反向他人 404 且与随机不存在 id 逐字节相同，正向表主本人同时刻 2xx 且内容逐字一致

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 条 +「边界情况」的「跨组织不可达与不存在统一返 404、同一文案、同一响应形状（反枚举）」；对应上位合同断言 A8

**可观测行为**: A 企业员工甲建「仅自己」表 T；同组织员工乙 `GET /tables` 列表不含 T、`GET /tables/T` 返 404；同一时刻甲 `GET /tables` 含 T、`GET /tables/T` 返 200 且表名/字段定义与建表时逐字一致。乙访问 T 的响应体与访问随机不存在 uuid 的响应体**逐字节相同**。

**验证命令**:
```bash
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a8-only
# 变异证明（判据外置）：可见性判据改成「一律拒绝」，A8 正向对照段必须 exit≠0
S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh
bash "$S" --mutation-apply A8-deny-all
bash "$S" --a8-only; RC=$?; bash "$S" --mutation-revert A8-deny-all; [ "$RC" -ne 0 ] || exit 1
```

**硬阈值**: 乙侧 `GET /tables/T` 与 `GET /tables/<random-uuid>` 两个响应的 **HTTP 码相同（均 404）且响应体 `md5` 全等**；甲侧同时刻 200 且 `data` 与建表返回逐字一致；变异 `A8-deny-all` 必须让**正向段**报红（若正向段仍绿说明正向对照根本没跑）。

---

### Step 5: 删表二次确认输入表名，输错不执行；删后软删物理行仍在；30 天内回收站还原，表元数据与字段定义逐字回归

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 条 +「边界情况」的「二次确认输错表名 → 不执行删除」；对应上位合同断言 A9 / A30①

**可观测行为**: `DELETE /tables/:id` 带 `confirm_name` 与表名不符 → 400 `CONFIRM_MISMATCH` 且 `deleted_at` 仍为 NULL；名字对上 → 200，`deleted_at` 非空、**`db_tables` 与 `db_fields` 的物理行计数不减**；`GET /trash` 含该表且带 `restorable_until`；`POST /trash/:id/restore` 后 `deleted_at` 回 NULL，表元数据 + 全部字段定义逐字回归。

**验证命令**:
```bash
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a9-only
# 变异证明（判据外置）：软删改成物理 DELETE，A9 段必须 exit≠0
S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh
bash "$S" --mutation-apply A9-hard-delete
bash "$S" --a9-only; RC=$?; bash "$S" --mutation-revert A9-hard-delete; [ "$RC" -ne 0 ] || exit 1
```

**硬阈值**: 输错名 → HTTP 400 且 `error.code == "CONFIRM_MISMATCH"` 且 `deleted_at IS NULL`；正确删 → `deleted_at IS NOT NULL` 且删前删后 `SELECT count(*) FROM zenithjoy.db_tables`（含软删行）**相等**；`restorable_until - deleted_at` = 30 天；还原后表名 + 字段元组集合与删除前 `md5` 全等；变异 `A9-hard-delete` 必须报红。

---

### Step 6: G0 闸落地 —— 路③ 全部路由与中间件源码七个禁用字面量零命中，任意插入其一守卫报红

**来源**: `[FROM_PRD]` — PRD「范围限定」的「G0 权限底座 … A2 静态守卫脚本（七个禁用字面量零命中）」+「E2E 验收」第 2 条；对应上位合同 **G0 机械闸**与断言 A2

**可观测行为**: 扫描路③ 全部交付源码，七个字面量 `X-Tenant-Id` / `X-User-Email` / `X-Feishu-User-Id` / `X-Bypass-Tenant` / `tenantContextOptional` / `selfHealOwnerMember` / `staffGuard` 零命中；同时 `app.ts` 中路③ 挂载路径不以 `/api/staff` 开头。

**扫描域必须从挂载事实推导，禁止写死文件名清单**——路③ 路由一旦落成 `routes/workbench.ts` 或拆成两个文件而漏同步清单，守卫扫的全是登记过的旧文件、`A2-inject-all` 注入的也是登记过的文件，真正的路③ 路由从头到尾没被扫过（上位合同 A35 在 v3 被整条改形，理由逐字就是「扫描域为空集 = 零命中恒真 = 假绿」，A2 不许再踩）。守卫按**可发现规则**现算：① 解析 `app.ts` 中 `app.use('/api/knowledge/db', <router>)` 的 router 标识符 → 回溯其 `import` 得路③ 路由源文件；② 从该文件做**一层相对 import 闭包**（`./`/`../` 的 `.ts`），中间件与 service 自动进域；③ 并入 `git diff --name-only origin/main...HEAD` 里含 `/api/knowledge/db` 或 `workbench` 字面量的 `apps/api/src/**`、`apps/staff-hub/src/**` 新增文件。

**兜底断言（缺则整条 A2 作废）**：① 扫描域 ≥3 项且**逐项 `test -f` 命中真实文件**（任一项解析为空 → FAIL，堵空集假绿）；② ③ 算出的路③ 新增文件集合**必须是**扫描域子集（漏一个即 FAIL 并打印文件名）。

**扫描域之外（显式排除，否则守卫会扫到自己）**：守卫脚本 `structured-workbench-smoke.sh` 自身（它必须写出这七个字面量才能去查）、`sprints/**/tests/**`（负向测试必须真伪造头才有意义，见 `workbench-auth-guard.test.ts` 的伪造头用例）。排除项必须在脚本里显式列出并注明理由，不许用「反正 grep 不到」蒙混。

**验证命令**:
```bash
S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh
# 无需 DB/服务即可跑；--a2-print-scope 打印现算出的扫描域供人工核对
bash "$S" --a2-only
# 变异证明（判据外置）：七个字面量逐个插入到**现算扫描域里的真实文件**，每次 A2 必须 exit≠0
bash "$S" --mutation-apply A2-inject-all
bash "$S" --a2-only; RC=$?; bash "$S" --mutation-revert A2-inject-all; [ "$RC" -ne 0 ] || exit 1
```

**硬阈值**: 七个字面量命中数 = 0；路③ 挂载路径以 `/api/knowledge/db` 开头；扫描域 ≥3 项且逐项 `test -f` 通过、路③ 新增文件全在域内；`A2-inject-all` 施加后 `--a2-only` **exit≠0**，且 `--mutation-list` 报告该开关注入次数 = 7（少于 7 即有漏网字面量）；同时既有 `count-staffguard-endpoints.mjs` 仍 = **16**（路③ 端点没被误挂 staffGuard）。

---

### Step 7: G1 旧 `/api/fields` 处置五段全绿 —— 挂鉴权 / 旧表加 `tenant_id` 隔离 / 两个 smoke 改身份头 / dashboard 真浏览器回归 / 处置结果落 decisions

**来源**: `[FROM_PRD]` — PRD「范围限定」的「G1 字段表隔离 … J7 四段」+「E2E 验收」第 4 条；对应上位合同 G1 与断言 A4（五段）

**可观测行为**:
1. 路③ 新字段元数据表 `db_fields.org_id` 为 `NOT NULL`；A 企业会话读/改 B 企业字段定义 → 4xx 或空集
2. 不带任何身份头、不带会话逐个调 `/api/fields` 四端点（GET / POST / PUT :id / DELETE :id）**均返 401**（`origin/main @ bdebf9e4` 返 2xx，此判据当前就是红的，转绿即段① 完成）
3. **反向**：持 A 企业身份读/改 B 企业的 `field_definitions` 行 → 4xx 或空集，且 B 的行前后 `SELECT` diff 为空
   **正向对照（同段内必须自带，不许只靠 ④ 的 windows job）**：A 持身份 `GET /api/fields` 必须**命中 A 自己那一行**（不只是"不含 B 的"）；`PUT /api/fields/<A 自己的行>` 返 2xx 且 `psql` 复查该行 `field_name` 真的变成了新值（**用 `field_name` 不用 `label`**：`field_definitions` 无 `label` 列——`\d zenithjoy.field_definitions` 实测、`20260210_000000_create_works_tables.sql:66-75` 建表段、`models/schemas.ts:30-38` 的 `createFieldSchema` 三层皆无，且 PRD J7 段② 只要求加 `tenant_id`；拿 `label` 当对照只会永远红，或逼 generator 造一个 PRD 没要求的列）。**理由**：只写反向串会被「一律返空数组 / 一律 403」的实现完全骗过——那三条全绿而 dashboard `/works/fields` 当场瘫痪，正是 PR#1675→#1676 那次往返的形状
4. 真浏览器带真会话下 dashboard `/works/fields` 列表/新建/编辑/删除 与 `WorkDetailPage` 自定义字段编辑功能不变（`PUT /fields/reorder` 除外）
5. 处置结果（不下线端点 + `field_definitions` 加租户列的范围扩张，关联 issue `1ae57f1a` 与 PR#1675/#1676）落 `decisions` 表。**该表在 Brain（cecelia）库 `public.decisions`，zenithjoy / zenithjoy_test 两库都没有它**（`\dt *.decisions` 实测皆 `Did not find any relation`）——`--a4-only` 段⑤ 与 INV-10 的 oracle 一律走 `$BRAIN_DATABASE_URL`（psql）或 `GET localhost:5221/api/brain/decisions`（jq），两者皆不可用即报错退出；拿 `$E2E_DATABASE_URL` 查它会得空串再撞 `[ "" -ge 1 ]` 的 `integer expression expected`，恒 FAIL

**验证命令**:
```bash
# ①②③ 段：真 API + 真 PG；⑤ 段查 decisions（在 Brain/cecelia 库，脚本内走 $BRAIN_DATABASE_URL 或 Brain API，不碰 zenithjoy 库）
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a4-only
# ④ 段：真浏览器（在 windows job 内跑，本地由 workflow 断言代理，见 Step 10）
node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/fields-auth-regression.spec.ts','utf8');if(c.includes('page.route('))process.exit(1)"
# 两个 smoke 脚本已改带身份头（段③）——改完后它们自己必须还是绿的
bash .github/workflows/scripts/smoke/fields-smoke.sh
```

**硬阈值**: `db_fields.org_id` 的 `is_nullable == 'NO'`；`/api/fields` 四端点无身份 → **4×401**；A 持身份读 B 的 `field_definitions` → 行数 0 且 B 行 `md5` 前后全等；**正向对照**：A 持身份 `GET /api/fields` 返 200 且 `ids` 含 A 自己那行的 id、`PUT` A 自己那行返 2xx 且 `psql` 查回的 `field_name` == 新值（三者缺一即 FAIL——这一条专门堵「一律返空/一律 403」）；`fields-smoke.sh` 与 `zenithjoy-smoke-audit.sh` 改带会话身份后 exit 0；**Brain（cecelia）库** `public.decisions` 存在 category 为 `rec` 或 `invariant` 且正文同时含 `1ae57f1a` 与 `field_definitions` 的行（**该表不在 zenithjoy/zenithjoy_test 库**，`\dt *.decisions` 实测两库皆无；oracle 走 `$BRAIN_DATABASE_URL` psql 或 `GET localhost:5221/api/brain/decisions`，两者皆不可用即 FAIL，禁止拿 `$E2E_DATABASE_URL` 兜）；dashboard 回归 spec 存在且**零 `page.route(`**。

---

### Step 8: G2 备份落地 —— `pg_dump` 定时 workflow 有 `schedule` 持久载体，且从备份还原到临时库后路③五表逐条比对全等

**来源**: `[FROM_PRD]` — PRD「范围限定」的「G2 备份：`pg_dump` 定时 workflow（`schedule` 持久载体）+ 恢复演练脚本与断言」+「E2E 验收」第 5 条；对应上位合同 G2 与断言 A5

**可观测行为**: `.github/workflows/db-backup.yml` 存在且 `on:` 含 `schedule`；同一次运行内 **先种可判别数据** → `pg_dump` → 还原到临时库 → 路③五张表（`db_tables`/`db_fields`/`db_rows`/`db_view_prefs`/`db_audit`）行数、**逐行字段值**与源库比对全等。

**演练前必须种数据（P0-2 修复 — 空表上「`0 == 0` 且空集 md5 相等」让 `pg_dump --schema-only` 也全绿）**：`db_rows`/`db_view_prefs`/`db_audit` **本刀根本没有写入路径**（Sprint B/C 才写），演练那一刻必然是空表；`db_tables`/`db_fields` 也可能被 smoke 清了种子。所以 `restore-drill.sh` **必须在 `pg_dump` 之前**用直接 SQL 向五表各插 ≥1 行带本轮标记 `WB-DRILL-$DRILL_RUN_ID`（运行时随机串，不写死）的可判别数据——不必等 Sprint B 的端点。判定三层，缺一层即 A5 作废：① **有得可比**：源库五表逐表 `count(*) > 0`；② **比得相等**：逐表 `count(*)` 全等 + 关键字段排序后 `md5` 全等；③ **逐行可查**：还原库按标记逐表查到那行，**字段值与源库逐字相同**（只比行数漏掉「行在但内容烂」，正是判定点登记表里「`pg_dump` 退出码看不出缺 schema/缺表」的同类洞）。

**验证命令**:
```bash
# workflow 有 schedule 持久载体（非一次性手跑）
node -e "const y=require('fs').readFileSync('.github/workflows/db-backup.yml','utf8');if(!/^\s{2}schedule:/m.test(y))process.exit(1)"
# 真种数据 + 真 pg_dump + 真 pg_restore + 五表逐行全等（L2 真库真验）
bash .github/workflows/scripts/backup/restore-drill.sh
# 变异证明（判据外置，本刀 G2 唯一的守卫证明）：把 pg_dump 换成 --schema-only，演练必须 exit≠0
S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh
bash "$S" --mutation-apply A5-schema-only
bash .github/workflows/scripts/backup/restore-drill.sh; RC=$?; bash "$S" --mutation-revert A5-schema-only; [ "$RC" -ne 0 ] || exit 1
```

**硬阈值**: `db-backup.yml` 的 `on:` 块含 `schedule` 且**恢复演练与备份在同一 workflow 同一次运行内**（备份跑了但没还原 = 假绿）；源库五表逐表 `count(*) ≥ 1`（**任一表为 0 即 FAIL**）；五张表逐表 `count(*)` 全等，且逐表关键字段（`db_tables`: `id,org_id,name,visibility,deleted_at`；`db_fields`: `id,table_id,org_id,name,field_type,display_order`；其余表: `id,org_id,<标记列>`）排序后 `md5` 全等；还原库五表各查到 1 条 `WB-DRILL-$DRILL_RUN_ID` 标记行且字段值与源库逐字相同；`restore-drill.sh` exit 0 且**脚本内零 `|| true`、零无条件 `exit 0`**；变异 `A5-schema-only` 施加后演练 **exit≠0**。

---

### Step 9: 单组织前置自检 fail-closed —— `tenant_members` 同一 `feishu_user_id` 出现多组织行时，进程在 listen 之前退出并输出明确错误码

**来源**: `[FROM_PRD]` — PRD「边界情况」第 1 条（多组织行 → 启动自检 fail-closed，不静默取第一条）+「E2E 验收」第 11 条。**本地标签 A11 上位合同无此编号**（`A11`/`多组织`/`feishu_user_id` 三词在 `gp3-contract-v3.json` 均零命中），要求实体来自 PRD。

**可观测行为**: 正常（每人恰属一组织）时服务起得来，且启动日志出现 `A11 single-org selfcheck passed`；把某员工插入第二个组织的成员行后重启 → 进程**起不来**（在 `listen` 之前退出），日志点名 `A11-MULTI-ORG` 并打印冲突的 `feishu_user_id`；请求期同样情形返 409 `MULTI_ORG_MEMBER`，**不取第一条**。

**验证命令**:
```bash
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a11-only
# 变异证明（判据外置）：自检改回「取第一条」，A11 段必须 exit≠0
S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh
bash "$S" --mutation-apply A11-take-first
bash "$S" --a11-only; RC=$?; bash "$S" --mutation-revert A11-take-first; [ "$RC" -ne 0 ] || exit 1
```

**硬阈值**: 正常态 → 服务起得来且日志含 `A11 single-org selfcheck passed`（只验端口通是假绿：没实现自检时服务照样起）；多组织态 → 进程 exit code **∉ {0, 124}**（124 = 被 timeout 杀掉 = 它 listen 住了 = 没拦住）且日志含 `A11-MULTI-ORG`；请求期 → HTTP 409 且 `error.code == "MULTI_ORG_MEMBER"`；变异 `A11-take-first` 必须报红。

---

### Step 10: A35① 前向兼容锚 + A33 独立 workflow 四段 —— 排除清单五表名逐字命中，windows-latest job 真跑过而非被 job 级门跳过

**来源**: `[FROM_PRD]` — PRD「范围限定」的「A35 前向兼容锚」与「独立 E2E workflow」+「E2E 验收」第 12 条；对应上位合同断言 A35① 与 A33（四段判据）
**补充标注**: `[AI_ADDED]` — 「windows job 的 `conclusion == success`」这一层判据由本合同加入。理由：上位合同 A33 只说「无 job 级事件条件门」（YAML 静态形状），而静态形状为真、job 却因 `paths` 未命中而从未运行，spec 照样是孤儿；补一条运行时判据才堵死这个口子。

**可观测行为**:
- `apps/api/src/knowledge/retrieval-exclusions.ts` 存在、可被 Node 解析、导出常量数组逐字含 `db_tables` / `db_fields` / `db_rows` / `db_view_prefs` / `db_audit` 五个物理表名
- `.github/workflows/e2e-knowledge-hub-path3.yml`：(a) `on:` 含 `pull_request`；(b) 内有 `runs-on: windows-latest` 的 job 且它就是跑路③ 真浏览器全链的那个；(c) 该 windows job 顶层**无 job 级 if:**，或其 `if:` 不含 `github.event_name` / `workflow_dispatch` 之类触发事件限定；(d) `paths` 含路③ spec 与源码
- 路③ smoke 已进 `smoke-baseline.txt`
- 本分支上该 workflow 的 windows job 真的跑过且 `conclusion == success`

**验证命令**:
```bash
S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh
# A35①：五表名逐字命中
bash "$S" --a35-only
# 变异证明（判据外置）：逐个删掉表名，每次 A35 段必须 exit≠0
bash "$S" --mutation-apply A35-drop-name
bash "$S" --a35-only; RC=$?; bash "$S" --mutation-revert A35-drop-name; [ "$RC" -ne 0 ] || exit 1
# A33 四段静态判据（YAML 真解析，不是 grep 字符串）
bash "$S" --a33-only
```

**硬阈值**: 五个表名命中 5/5；`A35-drop-name` 施加后 `--a35-only` **exit≠0**，且 `--mutation-list` 报告该开关注入次数 = 5（五个表名逐个删一遍）；A33 四段全绿（缺一段即 FAIL）；`smoke-baseline.txt` 含 `structured-workbench-smoke.sh`；本分支该 workflow 最近一次运行 `conclusion == success` 且其中 `runs-on: windows-latest` 的 job `conclusion == success`（`skipped` 视为 FAIL）。

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud

> 三段串行：段1 静态守卫（无需 DB/服务，含 14 次静态变异注入）→ 段2 真 `apps/api` + 真 Postgres 双企业种子全链（4 次真库变异注入）+ 段2b 备份演练（1 次）→ 段3 windows-latest 干净 VM 真浏览器（A33 判据 = job 真跑过）。**本刀变异合计 9 个开关 / 19 次注入**，逐个登记在上方「变异证明执行协议」，判据一律外置（施加变异后跑被守卫的那一段，断言其 exit≠0）。
> 段2 的库来源：`E2E_DATABASE_URL` → `DATABASE_URL` → 报错退出（**不静默落 localhost 默认值**——那会让整轮 E2E 测在一个没人看的库上，跑绿了但根本没测到目标）。

```bash
#!/usr/bin/env bash
# 路③ Sprint A final-e2e —— 员工建起第一张表并且删错能还原
# 不用 set -e：本脚本靠显式 exit 传播失败，set -e 会让 `[ ... ] && break` 这类惯用法在
# 条件为假时直接把脚本打死，反而丢掉后面的诊断输出。
set -uo pipefail

SMOKE=".github/workflows/scripts/smoke/structured-workbench-smoke.sh"
DRILL=".github/workflows/scripts/backup/restore-drill.sh"
WF="e2e-knowledge-hub-path3.yml"

for f in "$SMOKE" "$DRILL" ".github/workflows/$WF"; do
  if [ ! -f "$f" ]; then
    echo "FAIL: 交付物缺失 $f"
    exit 1
  fi
done

echo "== 段1/3 静态守卫（A2 七字面量 / A35 五表名 / A33 workflow 四段 / INV 机械项）=="
if ! bash "$SMOKE" --static-only; then
  echo "FAIL: 段1 静态守卫未过"
  exit 1
fi

echo "== 段2/3 真 apps/api + 真 Postgres 双企业种子全链 + 4 次真库变异 =="
if [ -z "${E2E_DATABASE_URL:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "FAIL: 未设 E2E_DATABASE_URL / DATABASE_URL —— 拒绝落默认库跑成假绿"
  exit 1
fi
if ! bash "$SMOKE"; then
  echo "FAIL: 段2 真库真验未过（A1/A3/A4/A6/A7/A8/A9/A10/A11 + 变异）"
  exit 1
fi

echo "== 段2b/3 G2 备份恢复演练（真 pg_dump + 真还原 + 五表逐条全等）=="
if ! bash "$DRILL"; then
  echo "FAIL: A5 恢复演练未过"
  exit 1
fi

echo "== 段3/3 windows-latest 干净 VM 真浏览器（A33 判据：job 真跑过）=="
BRANCH=$(git rev-parse --abbrev-ref HEAD)
RUNS=$(gh run list --workflow "$WF" --branch "$BRANCH" --limit 1 --json databaseId,status,conclusion,url)
if ! echo "$RUNS" | jq -e 'length > 0' >/dev/null; then
  echo "FAIL: 分支 $BRANCH 上查不到 $WF 的任何运行记录 —— A33 接线未成（on: pull_request 缺失或 paths 未命中路③源码）"
  exit 1
fi
RUN_ID=$(echo "$RUNS" | jq -r '.[0].databaseId')
RUN_URL=$(echo "$RUNS" | jq -r '.[0].url')
echo "  run=$RUN_ID url=$RUN_URL"

DONE=0
for _ in $(seq 1 90); do
  ST=$(gh run view "$RUN_ID" --json status | jq -r '.status')
  if [ "$ST" = "completed" ]; then
    DONE=1
    break
  fi
  sleep 20
done
if [ "$DONE" != "1" ]; then
  echo "FAIL: $WF run $RUN_ID 30 分钟内未完成"
  exit 1
fi

CONC=$(gh run view "$RUN_ID" --json conclusion | jq -r '.conclusion')
if [ "$CONC" != "success" ]; then
  echo "FAIL: $WF run $RUN_ID 结论=$CONC（详情 $RUN_URL）"
  exit 1
fi

# 只看 workflow 总结论是假绿：windows job 被 job 级门跳过时，总结论照样是 success。
JOBS=$(gh run view "$RUN_ID" --json jobs)
if ! echo "$JOBS" | jq -e '[.jobs[] | select(.name | test("windows"))] | length > 0' >/dev/null; then
  echo "FAIL: run $RUN_ID 内无 windows job —— A33(b) 不成立"
  exit 1
fi
if ! echo "$JOBS" | jq -e '[.jobs[] | select(.name | test("windows")) | select(.conclusion == "success")] | length > 0' >/dev/null; then
  echo "FAIL: windows job 未成功执行（skipped 也算 FAIL，正是 A33(c) 要堵的孤儿 spec 形态）"
  echo "$JOBS" | jq -r '.jobs[] | "  job=\(.name) conclusion=\(.conclusion)"'
  exit 1
fi

echo "✅ 路③ Sprint A Golden Path 三段全绿：静态守卫 + 真库真验 + windows 真浏览器"
```

## E2E 脚本载体（windows job 内跑的 e2e-verify.ps1 模板）

> 由 `e2e-knowledge-hub-path3.yml` 的 windows-latest job 调用。**变体C 死规则**：起真实 `apps/api`，Playwright spec 禁 `page.route()`，全部请求打真后端。

```powershell
# sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/e2e-verify.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ApiPort   = 3000
$HubPort   = 5175       # 与 apps/staff-hub/playwright.config.ts 的 baseURL 一致
$DashPort  = 5174       # apps/dashboard，A4④ 回归对照用
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$ScriptStart = Get-Date

if (-not $env:E2E_DATABASE_URL) { throw "FAIL: 未注入 E2E_DATABASE_URL，拒绝跑成假绿" }

# 1. 依赖 + 浏览器
$p = Start-Process cmd.exe -ArgumentList "/c npm.cmd ci" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci" }
$p = Start-Process cmd.exe -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install" }

# 2. migration + 双企业种子（真 PG，禁 mock）
$p = Start-Process cmd.exe -ArgumentList "/c npm.cmd run migrate" -WorkingDirectory "$repoRoot\apps\api" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: migration" }

# 3. 起真实 apps/api（禁 stub）
$api = Start-Process cmd.exe -ArgumentList "/c npm.cmd start" -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow
$waited = 0
do { Start-Sleep -Seconds 1; $waited++
     $c = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $c.TcpTestSucceeded -and $waited -lt 60)
if (-not $c.TcpTestSucceeded) { throw "FAIL: apps/api 未在 60s 内就绪（A11 自检可能把它拦在 listen 之前，看日志）" }

# 4. staff-hub 真浏览器全链（建表→8类字段→列表→可见性→删表→回收站还原）
$p = Start-Process cmd.exe -ArgumentList "/c npx.cmd playwright test e2e\structured-workbench.spec.ts --reporter=list" `
     -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue; throw "FAIL: staff-hub 路③ E2E" }

# 5. A4④ dashboard 回归对照（给 /api/fields 挂鉴权后，dashboard 功能必须不变）
$p = Start-Process cmd.exe -ArgumentList "/c npx.cmd playwright test e2e\fields-auth-regression.spec.ts --reporter=list" `
     -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { throw "FAIL: A4④ dashboard 回归（重演 PR#1675 的形状）" }

# 6. 防历史产物冒充：本轮截图必须晚于脚本启动
Get-ChildItem "$repoRoot\apps\staff-hub\screenshots\*.png" | ForEach-Object {
  if ($_.LastWriteTime -lt $ScriptStart.AddMinutes(-1)) { throw "FAIL: $($_.Name) 是历史遗留产物" }
}
Write-Host "✅ windows_cloud 路③ Sprint A E2E 通过"
exit 0
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| G0 会话鉴权闸 | `tests/workbench-auth-guard.test.ts` | `无会话返 401 SESSION_REQUIRED`、`伪造身份头不改变判定且不写库`、`成员行查询失败返 503 LEDGER_UNREACHABLE`、`多组织行返 409 MULTI_ORG_MEMBER 不取第一条` | 中间件与路由不存在 → 6 failures |
| S1 建表与字段元数据 | `tests/workbench-tables.test.ts` | `建表返 201 且 org_id 取自会话忽略请求体`、`八类字段各一落 db_fields`、`建表不产生运行时 DDL`、`跨组织 GET 返 404 且与随机 id 逐字节相同` | 端点族不存在 → 4 failures |
| 可见性与回收站 | `tests/workbench-visibility-trash.test.ts` | `仅自己表对同组织他人不出现在列表`、`表主本人同时刻仍返 2xx 且内容逐字一致`、`确认名不匹配返 400 CONFIRM_MISMATCH 且不删`、`软删后物理行仍在且还原逐字回归` | 同上 → 4 failures |
| G1 旧 fields 处置（反向 + 正向对照） | `tests/fields-legacy-isolation.test.ts` | `无身份调 /api/fields 四端点均返 401`、`A 企业身份读不到 B 企业 field_definitions`、`A 企业身份能改自己那一行且 field_name 真落库`、`A 企业身份改不动 B 企业 field_definitions 且 B 行未变` | 四端点当前无鉴权返 2xx + `tenant_id` 列不存在 → 5 failures |

> 「BEHAVIOR 覆盖」列每个名字都是对应 `it()` 名的字面子串，`grep -F` 可命中。
> 这些 vitest 是 generator 的 TDD red-green 用；evaluator 的 verdict 只来自 `contract-dod.md` 的 `manual:` 命令。

---

## Contract Gate 备注

`contract-gate: skipped (packages/brain/src/lib/contract-gate.js not found, third-party repo=zenithjoy-workspace)` —— 本 repo 无代码层 Contract Gate，合规按本 skill 内置规则自审（惯用法速查表 + 自查 checklist + Step 2b-check 确定性脚本）。

---

## R1 逐条回应（Reviewer 反馈 `.harness/feedback-gp3a-r1.md`）

**P0-1 测试夹具永不转绿 —— 已修，选方案 (a)**
按你的倾向扩 `_smoke-fake-feishu.ts`：`resolveFakeFeishuIdentity` 加**纯 fallback** `pickGroupMembers(key) ?? pickDeclaredMember(key)`，`code-<ORGKEY>` 既有分支一字不改，所以路① 会话签发段不会被打断腿。合同「已知约束 → 假上游按成员寻址扩展」写死了实现形态与 **code 的确切字面形态 `wb-code-<open_id>`**（`ou_wb_alice_<数字>` 全串只含 `[A-Za-z0-9_]`，`/code-([A-Za-z0-9_]+)$/` 可整段捕获），不留现场发挥空间。夹具改用 `codeFor(openId)` 唯一出口、显式设 `FEISHU_APP_ID/SECRET`，并给 `loginAs` 加"拿不到 cookie 就地抛错并打印 status/body"——把夹具故障与实现缺失区分开，不再让三个 `"undefined"` cookie 把 401 伪装成"实现没写"。该改动已登记进：合同「已知约束」回归条目、DoD ARTIFACT（`pickDeclaredMember` + fallback 表达式 + 正则原样保留三项机检）、DoD `INV-回归`（路① smoke 仍绿 + staffGuard 计数仍 16）、`task-plan.json` 的 dod/files。**方案 (b) 已明确否决**并在合同里写了理由（与禁 mock 边第 1 条冲突 + Sprint B/C/D 三刀都要用多人同组织场景）。

**P0-2 G2 恢复演练空表恒真 —— 已修**
`restore-drill.sh` 必须在 `pg_dump` **之前**向五表各插 ≥1 行带 `WB-DRILL-$DRILL_RUN_ID` 标记的可判别数据（`db_rows`/`db_view_prefs`/`db_audit` 直接 SQL 种，不等 Sprint B）。判定改三层：① 源库逐表 `count(*) > 0`（先证"有得可比"）② 逐表 count 全等 + 关键字段 md5 全等 ③ 还原库按标记逐表查到那行且**字段值与源库逐字相同**。新增变异开关 `A5-schema-only`（把 `pg_dump` 换 `--schema-only`）→ 演练必须 `exit≠0`。G2 从"零变异 lifeline"变成有守卫证明。

**P1-1 22/28 条 grep 自 echo —— 已修，判定与供给分家**
新增「夹具供给协议」：`--fixture-up` 只负责起真 `apps/api` + 种双企业 + 签三个真会话并写 `.wb-fixture.env`（含 `COOKIE_A`/`COOKIE_A2`/`COOKIE_B`/`EIGHT_FIELDS`），**禁含任何 pass/fail 判定**；判定全写在 DoD 命令里由 evaluator 直接跑。你点名的五组已从 `--aN-only` 换成内联真命令：**A1 反向+A3 正向**（伪造头建表 → psql 断 A 企业零新增行 + A 会话读得到自己列表）、**A6**（`jq -e .data.org_id == ORGA` + psql 时间窗 + 八类去重=8）、**A8**（两个 404 响应体 md5 全等 + 列表不泄漏 + 表主同时刻 `.data.name` 逐字）、**A9**（400 CONFIRM_MISMATCH → deleted_at 仍 NULL → 正确删 → deleted_at 非空且组织内行数不减 → 还原回 NULL）、**A5**（见 P0-2）。DB 断言的 `PGURL` 一律直接取 `${E2E_DATABASE_URL:-$DATABASE_URL}`，**不经脚本**，脚本无从代答。变异判据全部外置为 `--mutation-apply → 跑被守卫段断言 exit≠0 → --mutation-revert`，`--mutation-apply/revert` 禁含判定与 `proven-to-fire` 字样。34 条命令已逐条过 `bash -n`（外层 34/34、内层 22/22 全过）。

**P1-2 两个扫描器零变异 —— 已修**
`scan-hardcoded-secrets.mjs` / `scan-hardcoded-env.mjs` 进 ARTIFACT 清单（并进 `task-plan.json` 的 files），各配 1 条 proven-to-fire 变异（`INV4-inject-secret` / `INV7-inject-hardcoded-env`）。判据不只看 `exit≠0`：`--mutation-apply` 必须把被注入文件路径写进 `./.wb-mutation-target`，DoD 断言扫描器输出**点名该路径且带 `:<行号>`**——空实现连行号都印不出来。

**P1-3 A2 扫描域硬编码 —— 已修**
写死清单整条删除，改为从挂载事实现算：解析 `app.ts` 里挂到 `/api/knowledge/db` 的 router → 回溯 import → 一层相对 import 闭包 → 并入 `git diff origin/main...HEAD` 中含 `/api/knowledge/db`/`workbench` 字面量的新增源文件。补两条兜底断言：扫描域 ≥3 项且**逐项 `test -f` 命中真实文件**、路③ 新增文件集合**必须是**扫描域子集（漏一个即 FAIL 并打印文件名）。另加 `--mutation-list` 断言 `A2-inject-all` 注入次数 = 7，防"少注入几个字面量假装全过"。

**P1-4 G1 只有反向没有正向 —— 已修（含恒真断言删除）**
`--a4-only` 段③ 补正向：DoD 新增一条内联命令——psql 种 A 企业一行 → `GET /api/fields` 断言 `map(.id) | index($FID) != null` → `PUT` 该行 → psql 复查 `field_name` 真变成新值（r3 改：原写 `label`，该列真库/migration/zod/service 四层皆无）。三条缺一即 FAIL，"一律返空数组 / 一律 403"当场红。`fields-legacy-isolation.test.ts:68-71` 的 `GET /api/fields/${orgBFieldId}` 期望 `[403,404]` **已删除**（核对 `routes/fields.ts` 全文确无 `GET /:id`，Express 未知路由恒 404，与隔离无关），原地换成两条正向对照用例，并把 beforeAll 改为**两家各种一行**（只种 B 的话正向无从对照）。

**溯源错账 —— 已修**
「12 条变异」改为本刀可核对的确切计数：**9 个开关 / 19 次注入**（段1 静态 14 = A2×7 + A35×5 + INV4×1 + INV7×1；段2 真库 4 = A1/A8/A9/A11；段2b 备份 1 = A5），并注明 12 是上位合同整条 GP 四刀口径、A2/A35 属段1 静态而非段2。A6/A7/A11 三处「对应上位合同断言」全部改为「**本地标签，上位合同无此编号**（A-id 集合已逐个列出），要求实体来自 PRD 的哪一条」；合同抬头那句也改成 `G0/G1/G2 + A1–A5、A8–A10、A30①、A33、A34、A35①`。

**你标注"不要动"的部分一字未动**：真实调用方 shape（`knowledgeFetch.ts:25-31`）、A33 四段 + `conclusion == success`、判定点登记表 6 条、G2 异地 `logic-done-pending-offsite`、禁 mock 边清单 7 条与飞书唯一豁免。

**行数如实交代（未达"持平或略降"）**：contract-draft 合同正文 606 → 682（+76，本「R1 逐条回应」附录另占 29 行，文件总长 711），contract-dod 193 → 224（+31）。逐项去向：假上游扩展登记 +14（P0-1 要求"合同必须写出确切字面形态"）、夹具供给协议 +14（P1-1 把真 oracle 搬进 DoD 的执行前提）、变异证明协议 +12（P1-1 判据外置）、G2 种数据三层判定 +7（P0-2）、A2 可发现扫描域 +6（P1-3）、G1 正向对照 +3（P1-4）、溯源修正 +3、各 Step 变异命令由 1 行摊成 3 行 +17。已反向压缩假上游/扫描域/G2 三段共 −8。**零新增 scope**：没有加任何 PRD 之外的端点、字段或场景，PRD 覆盖边界与 R1 完全相同。

---

## R2 逐条回应（Round 3 定点修 —— 三处，合计 11 行改动，零新增 scope）

Reviewer 判定「三条改动加起来不到十行；改完这一轮就该 APPROVED」。三条我全部先在真库/真代码上复核了
reviewer 给的事实，再改，并对每一条做了**修前必炸 / 修后能过**的双向实证（全部在 `zenithjoy_test`
上以 `BEGIN … ROLLBACK` 跑，零污染）。

### A（P0，`test_is_red`）夹具 `tenants` 漏 `license_key` —— 已修

`\d zenithjoy.tenants` 复核确认 reviewer 无误：`license_key | text | not null`，**无 DEFAULT**，
且带唯一约束 `tenants_license_key_key`（所以两家企业必须用不同串，reviewer 提示的这一点也照做了）。

`_workbench-fixture.ts` 两条 INSERT 照抄 repo 既有种子写法（`apps/api/tests/integration/helpers.ts:29`、
`apps/api/src/routes/tenants.ts:20`、`.github/workflows/scripts/smoke/credits-smoke.sh:40` 三处一致）：

```ts
"INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id",
[`${prefix}-A-${sfx}`, `wb-lk-a-${sfx}`]   // B 家为 wb-lk-b-${sfx}
```

**双向实证**（`zenithjoy_test`，事务回滚）：

| 写法 | 真库结果 |
|---|---|
| 修前 `(name, plan)` | `ERROR: null value in column "license_key" of relation "tenants" violates not-null constraint` |
| 修后 `(name, license_key, plan)` | `INSERT 0 1`，返回 uuid |

**顺带做完 reviewer 要求的那条自检**——「夹具依赖的每一张既有表，其 NOT NULL 无默认列是否都给了值」，
逐表查 `information_schema.columns` 过了一遍，这是本刀 INSERT 触达的全部三张既有表：

| 表 | NOT NULL 且无默认的列 | 夹具/判据是否都给了 |
|---|---|---|
| `zenithjoy.tenants` | `name`、`license_key` | ✅ 本轮补齐 `license_key` 后齐全 |
| `zenithjoy.tenant_members`（`workbench-auth-guard.test.ts:87`）| `tenant_id`、`feishu_user_id` | ✅ 两列都给（`role`/`created_at` 有默认） |
| `zenithjoy.field_definitions`（`fields-legacy-isolation.test.ts` `mk()`、DoD:121）| `field_name`、`field_type` | ✅ 两列都给（`display_order`/`is_visible`/时间戳均有默认）；`tenant_id` 是本刀段② 新增列，现在缺列报错**属预期必红** |

### B（P0，`test_is_red` / `verification_oracle_completeness`）`label` 列四层皆无 —— 已修，改用 `field_name`

三层事实我逐层复核，与 reviewer 一致：真库列集 `id/field_name/field_type/options/display_order/is_visible/created_at/updated_at`
无 `label`；`models/schemas.ts:30-38` 的 `createFieldSchema` 亦无（`.partial()` 后 zod strip，`{label:x}` 会被剥成 `{}`，
PUT 返 2xx 却什么都没改——这条比"永远红"更阴，会**假绿**）；`fields.service.ts` 五处 SQL 不碰它。
而 PRD J7 段② 逐字只要求加 `tenant_id`，我自己判定点登记表选的也是 B(`tenant_id`)——**这条正向对照确属自伤**。

改用既有可更新列 **`field_name`**：`VARCHAR(100) NOT NULL`，在 `createFieldSchema` 内（`.partial()` 后可单独 PUT），
`fields.service.ts:73` 的动态 `UPDATE ... SET` 认它，无唯一约束不会撞车。同步改到位的**六处**：

1. `tests/fields-legacy-isolation.test.ts` —— `mk()` 签名去掉 label 参数、正向对照用例改断 `field_name`、
   越权用例的 `md5(row(...))` 列集改为真实存在的 `(field_name, field_type, display_order, is_visible, tenant_id)`、
   401 那条的 POST/PUT body 里的 `label` 一并清掉，文件头加一段说明为什么不用 `label`
2. `contract-dod.md:120/121` —— 条目文字 + 内联命令的 INSERT 列、PUT body、psql 复查列、失败文案全改；
   `NEW` 值从中文 `A企业字段-改后-$SFX` 换成 ASCII 的 `fwd_a_renamed_$SFX`
3. `contract-draft.md:429`（可观测行为③）、`:443`（硬阈值）、`:673`（Test Contract 表 it() 名）、`:704`（附录）
4. `red-evidence.md` 必红原因表 + 合计说明 —— reviewer 指出「现在写的是 tenant_id 列不存在，没提 label，
   说明这条没被核过」，这条批评成立，本轮把 R3 修正原委写进去了
5. `task-plan.json` 的 DoD 串
6. Test Contract 表的「BEHAVIOR 覆盖」名与 `it()` 名保持字面子串一致（改后为
   `A 企业身份能改自己那一行且 field_name 真落库`，`grep -F` 可命中）

**双向实证**（`zenithjoy_test`，事务回滚）：

| 写法 | 真库结果 |
|---|---|
| 修前 `(field_name, field_type, label)` | `ERROR: column "label" of relation "field_definitions" does not exist` |
| 修后 `(field_name, field_type)` | `INSERT 0 1`，返回 uuid |

必红性不变：该正向对照现在仍红（四端点无鉴权 → 无身份 PUT 也能过；`tenant_id` 列不存在 → 种子先炸）。

### C（P1，`verification_oracle_completeness`）`decisions` 打错库 —— 已修，改走 Brain 库/Brain API

复核确认：`psql -d zenithjoy -c "\dt *.decisions"` 与 `zenithjoy_test` 同样返回
`Did not find any relation`；`psql -d cecelia -c "\d decisions"` → `Table "public.decisions"` ✓。
原写法拿 `$PG`（zenithjoy E2E 库）查它，两条 psql 都失败 → `C` 为空串 → `[ "" -ge 1 ]` 报
`integer expression expected` → 恒 FAIL，reviewer 说的「该 PRD 条目无有效 oracle」成立。

采用 reviewer 的两个选项**合并写死**（优先 ①，②做兜底，两者皆不可用即报错退出——沿用本合同对
`E2E_DATABASE_URL` 的同一口径，绝不静默落默认库）：

```bash
if [ -n "${BRAIN_DATABASE_URL:-}" ]; then
  C=$(psql "$BRAIN_DATABASE_URL" -t -A -c "$Q") || fail "BRAIN_DATABASE_URL 连不上 Brain 库"
else
  C=$(curl -sf "http://localhost:5221/api/brain/decisions?limit=1000" | jq "[...]| length") \
    || fail "未设 BRAIN_DATABASE_URL 且 Brain API localhost:5221 不可达——decisions 在 Brain(cecelia) 库，
             不在 zenithjoy 库，不许拿 E2E_DATABASE_URL 兜"
fi
```

**双向实证**（两条通道各跑两次）：

| 通道 | 查本刀记录（尚未写入） | 把关键词换成库里已存在的组合 |
|---|---|---|
| `BRAIN_DATABASE_URL` psql | `FAIL: decisions 无该处置记录` exit 1 | `OK` exit 0 |
| Brain API + jq | 同上 exit 1 | `OK` exit 0 |

即：这条判据现在**红在业务缺失上**（该 decision 尚未写），不是红在语法或连错库上，且证明它可判别、非恒 FAIL。

reviewer 要求的「把『decisions 在 Brain 库不在 zenithjoy 库』写进合同免得下一刀再踩」也照办，写进了**三处**：
`contract-dod.md` 顶部环境前置段（新增「两个库别混」一行）、INV-10 条目正文、`contract-draft.md`
Step 7 可观测行为⑤ 与硬阈值。

### 本轮自查复跑

- Step 2b-check 确定性自查：`BEHAVIOR=34 / manual=34 / e2e_blocks=1 / real_exec=34 / grep_only=0` → ✅ 通过
- `bash -n`：外层 **34/34**、内层 **22/22** 全过（与 r2 同）
- 五个测试文件 esbuild TS 语法 **5/5** 通过
- 行数：contract-draft 正文 682 → 682（本附录另计），contract-dod 224 → 225（+1 = 新增的「两个库别混」口径行；INV-10 的库归属说明是行内追加，不增行）。
  **零新增 scope**：没有新增任何端点、字段或场景，PRD 覆盖边界与 R1/R2 完全相同；三条全是把已有判据从「指向不存在的东西」改成「指向真实存在的东西」。

### 未动的部分

reviewer 列的「已核验通过、不要动」清单**一字未动**：P0-2 的 G2 三层判定 + `A5-schema-only` 变异、
P1-① 的判据外置协议与 `PGURL` 取法、P1-② 的扫描器行号断言、P1-③ 的 A2 三路推导扫描域、
恒真断言删除、溯源 9 开关/19 次注入拆账、P0-1 已修的三条（`wb-code-<open_id>` 形态 / `pickDeclaredMember`
纯 fallback / `loginAs` 就地抛错）、判定点登记表 6 条、G2 异地 `logic-done-pending-offsite`、
禁 mock 边清单 7 条与飞书唯一豁免、`## 真实调用方请求 shape`、A33 四段。GP-Anchor 保留
（`line11/structured_workbench#step1`）。
