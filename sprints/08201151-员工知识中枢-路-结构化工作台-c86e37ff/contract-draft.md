# Sprint Contract Draft (Round 1) — 员工知识中枢 路③ 结构化工作台 · Sprint A

**journey_type**: user_facing
**target_environment**: windows_cloud
**journey_id**: da60cb26-5635-4f51-a1f3-a80013f6d69d
**上位合同**: `.harness/gp3-contract-v3.json`（CONTRACT IS LAW，本合同断言全部为其 G0/G1/G2 + A1–A11 的执行化，不新增也不放宽任何一条）

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

## Golden Path

[员工登录 Staff Hub] → [Step1 工作台入口看到 ≥2 模板] → [Step2 新建表 + 8 类字段 + 可见性] → [Step3 本组织列表可见 · 刷新逐字还在 · 跨组织不可达] → [Step4 「仅自己」正反双向] → [Step5 二次确认删表 → 回收站还原逐字回归] → 底座三门 [Step6 G0 闸] / [Step7 G1 旧 fields 处置] / [Step8 G2 备份] → [Step9 单组织自检 fail-closed] → [Step10 A35①/A33 接线]

---

### Step 1: 员工打开结构化工作台，空工作台显示 ≥2 个开箱模板，一键建表结构与模板声明逐字一致

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 条 +「范围限定·在范围内」的「开箱模板」；对应上位合同断言 A7

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

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2、3 条 +「NFR 约束」的「JSONB 行存，不做运行时 DDL」；对应上位合同断言 A6（前半）与 A10

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
# 变异证明：把闸改回「有头则读头」，A1 必须转红
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A1-header-fallback
```

**硬阈值**: 4 个写端点 × 伪造头 → 全部返回码 ∈ {400,401,403,404,409} 或响应 `data` 为空集，**零 2xx**；A 企业行前后 `md5(row)` 全等；9 个读写端点在 A 会话下**全部 2xx**（哪怕一个 403 即 FAIL，因为那说明闸在"一律拒绝"）；变异 `A1-header-fallback` 必须让 A1 段报红（exit≠0 且日志点名 `A1`），未报红即守卫是空的。

---

### Step 4: 表级可见性「仅自己」是真访问控制 —— 反向他人 404 且与随机不存在 id 逐字节相同，正向表主本人同时刻 2xx 且内容逐字一致

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 条 +「边界情况」的「跨组织不可达与不存在统一返 404、同一文案、同一响应形状（反枚举）」；对应上位合同断言 A8

**可观测行为**: A 企业员工甲建「仅自己」表 T；同组织员工乙 `GET /tables` 列表不含 T、`GET /tables/T` 返 404；同一时刻甲 `GET /tables` 含 T、`GET /tables/T` 返 200 且表名/字段定义与建表时逐字一致。乙访问 T 的响应体与访问随机不存在 uuid 的响应体**逐字节相同**。

**验证命令**:
```bash
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a8-only
# 变异证明：把可见性判据改成「一律拒绝」，正向对照必须转红
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A8-deny-all
```

**硬阈值**: 乙侧 `GET /tables/T` 与 `GET /tables/<random-uuid>` 两个响应的 **HTTP 码相同（均 404）且响应体 `md5` 全等**；甲侧同时刻 200 且 `data` 与建表返回逐字一致；变异 `A8-deny-all` 必须让**正向段**报红（若正向段仍绿说明正向对照根本没跑）。

---

### Step 5: 删表二次确认输入表名，输错不执行；删后软删物理行仍在；30 天内回收站还原，表元数据与字段定义逐字回归

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 条 +「边界情况」的「二次确认输错表名 → 不执行删除」；对应上位合同断言 A9 / A30①

**可观测行为**: `DELETE /tables/:id` 带 `confirm_name` 与表名不符 → 400 `CONFIRM_MISMATCH` 且 `deleted_at` 仍为 NULL；名字对上 → 200，`deleted_at` 非空、**`db_tables` 与 `db_fields` 的物理行计数不减**；`GET /trash` 含该表且带 `restorable_until`；`POST /trash/:id/restore` 后 `deleted_at` 回 NULL，表元数据 + 全部字段定义逐字回归。

**验证命令**:
```bash
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a9-only
# 变异证明：把软删改成物理 DELETE，A9 必须转红
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A9-hard-delete
```

**硬阈值**: 输错名 → HTTP 400 且 `error.code == "CONFIRM_MISMATCH"` 且 `deleted_at IS NULL`；正确删 → `deleted_at IS NOT NULL` 且删前删后 `SELECT count(*) FROM zenithjoy.db_tables`（含软删行）**相等**；`restorable_until - deleted_at` = 30 天；还原后表名 + 字段元组集合与删除前 `md5` 全等；变异 `A9-hard-delete` 必须报红。

---

### Step 6: G0 闸落地 —— 路③ 全部路由与中间件源码七个禁用字面量零命中，任意插入其一守卫报红

**来源**: `[FROM_PRD]` — PRD「范围限定」的「G0 权限底座 … A2 静态守卫脚本（七个禁用字面量零命中）」+「E2E 验收」第 2 条；对应上位合同 **G0 机械闸**与断言 A2

**可观测行为**: 扫描路③ 全部交付源码，七个字面量 `X-Tenant-Id` / `X-User-Email` / `X-Feishu-User-Id` / `X-Bypass-Tenant` / `tenantContextOptional` / `selfHealOwnerMember` / `staffGuard` 零命中；同时 `app.ts` 中路③ 挂载路径不以 `/api/staff` 开头。

**扫描域（必须在守卫脚本里逐条写死，防止将来漏扫新文件）**：
`apps/api/src/middleware/workbench-auth.ts`、`apps/api/src/routes/knowledge-db.ts`（路③ 路由，实际文件名以交付为准但必须进扫描域）、`apps/api/src/knowledge/**/*.ts`、`apps/staff-hub/src/lib/workbenchFetch.ts`、`apps/staff-hub/src/pages/Workbench*.tsx`。
**扫描域之外（显式排除，否则守卫会扫到自己）**：守卫脚本 `structured-workbench-smoke.sh` 自身（它必须写出这七个字面量才能去查）、`sprints/**/tests/**`（负向测试必须真伪造头才有意义，见 `workbench-auth-guard.test.ts` 的伪造头用例）。排除项必须在脚本里显式列出并注明理由，不许用「反正 grep 不到」蒙混。

**验证命令**:
```bash
# 无需 DB/服务即可跑
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a2-only
# 变异证明：七个字面量逐个插入，每次守卫都必须报红（一次都不许漏）
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A2-inject-all
```

**硬阈值**: 七个字面量命中数 = 0；路③ 挂载路径以 `/api/knowledge/db` 开头；`--mutation A2-inject-all` 必须报告 **7/7 proven-to-fire**（少于 7 即守卫有漏网字面量）；同时既有 `count-staffguard-endpoints.mjs` 仍 = **16**（路③ 端点没被误挂 staffGuard）。

---

### Step 7: G1 旧 `/api/fields` 处置五段全绿 —— 挂鉴权 / 旧表加 `tenant_id` 隔离 / 两个 smoke 改身份头 / dashboard 真浏览器回归 / 处置结果落 decisions

**来源**: `[FROM_PRD]` — PRD「范围限定」的「G1 字段表隔离 … J7 四段」+「E2E 验收」第 4 条；对应上位合同 G1 与断言 A4（五段）

**可观测行为**:
1. 路③ 新字段元数据表 `db_fields.org_id` 为 `NOT NULL`；A 企业会话读/改 B 企业字段定义 → 4xx 或空集
2. 不带任何身份头、不带会话逐个调 `/api/fields` 四端点（GET / POST / PUT :id / DELETE :id）**均返 401**（`origin/main @ bdebf9e4` 返 2xx，此判据当前就是红的，转绿即段① 完成）
3. 持 A 企业身份读/改 B 企业的 `field_definitions` 行 → 4xx 或空集，且 B 的行前后 `SELECT` diff 为空
4. 真浏览器带真会话下 dashboard `/works/fields` 列表/新建/编辑/删除 与 `WorkDetailPage` 自定义字段编辑功能不变（`PUT /fields/reorder` 除外）
5. 处置结果（不下线端点 + `field_definitions` 加租户列的范围扩张，关联 issue `1ae57f1a` 与 PR#1675/#1676）落 `decisions` 表

**验证命令**:
```bash
# ①②③⑤ 段：真 API + 真 PG + decisions 查询
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a4-only
# ④ 段：真浏览器（在 windows job 内跑，本地由 workflow 断言代理，见 Step 10）
node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/fields-auth-regression.spec.ts','utf8');if(c.includes('page.route('))process.exit(1)"
# 两个 smoke 脚本已改带身份头（段③）——改完后它们自己必须还是绿的
bash .github/workflows/scripts/smoke/fields-smoke.sh
```

**硬阈值**: `db_fields.org_id` 的 `is_nullable == 'NO'`；`/api/fields` 四端点无身份 → **4×401**；A 持身份读 B 的 `field_definitions` → 行数 0 且 B 行 `md5` 前后全等；`fields-smoke.sh` 与 `zenithjoy-smoke-audit.sh` 改带会话身份后 exit 0；`decisions` 表存在 category 为 `rec` 或 `invariant` 且正文同时含 `1ae57f1a` 与 `field_definitions` 的行；dashboard 回归 spec 存在且**零 `page.route(`**。

---

### Step 8: G2 备份落地 —— `pg_dump` 定时 workflow 有 `schedule` 持久载体，且从备份还原到临时库后路③五表逐条比对全等

**来源**: `[FROM_PRD]` — PRD「范围限定」的「G2 备份：`pg_dump` 定时 workflow（`schedule` 持久载体）+ 恢复演练脚本与断言」+「E2E 验收」第 5 条；对应上位合同 G2 与断言 A5

**可观测行为**: `.github/workflows/db-backup.yml` 存在且 `on:` 含 `schedule`；同一次运行内 `pg_dump` → 还原到临时库 → 路③五张表（`db_tables`/`db_fields`/`db_rows`/`db_view_prefs`/`db_audit`）行数与关键字段逐条比对全等。

**验证命令**:
```bash
# workflow 有 schedule 持久载体（非一次性手跑）
node -e "const y=require('fs').readFileSync('.github/workflows/db-backup.yml','utf8');if(!/^\s{2}schedule:/m.test(y))process.exit(1)"
# 真 pg_dump + 真 pg_restore + 五表逐条全等（L2 真库真验）
bash .github/workflows/scripts/backup/restore-drill.sh
```

**硬阈值**: `db-backup.yml` 的 `on:` 块含 `schedule` 且**恢复演练与备份在同一 workflow 同一次运行内**（备份跑了但没还原 = 假绿）；五张表逐表 `count(*)` 全等，且逐表关键字段（`db_tables`: `id,org_id,name,visibility,deleted_at`；`db_fields`: `id,table_id,org_id,name,field_type,display_order`；其余表: `id,org_id`）排序后 `md5` 全等；`restore-drill.sh` exit 0 且**脚本内零 `|| true`、零无条件 `exit 0`**。

---

### Step 9: 单组织前置自检 fail-closed —— `tenant_members` 同一 `feishu_user_id` 出现多组织行时，进程在 listen 之前退出并输出明确错误码

**来源**: `[FROM_PRD]` — PRD「边界情况」第 1 条 +「E2E 验收」第 11 条；对应上位合同断言 A11

**可观测行为**: 正常（每人恰属一组织）时服务起得来，且启动日志出现 `A11 single-org selfcheck passed`；把某员工插入第二个组织的成员行后重启 → 进程**起不来**（在 `listen` 之前退出），日志点名 `A11-MULTI-ORG` 并打印冲突的 `feishu_user_id`；请求期同样情形返 409 `MULTI_ORG_MEMBER`，**不取第一条**。

**验证命令**:
```bash
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a11-only
# 变异证明：把自检改回「取第一条」，A11 必须转红
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A11-take-first
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
# A35①：五表名逐字命中
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a35-only
# 变异证明：删掉任一表名或删掉整个清单文件，守卫必须报红
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A35-drop-name
# A33 四段静态判据（YAML 真解析，不是 grep 字符串）
bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a33-only
```

**硬阈值**: 五个表名命中 5/5；删任一名 → 守卫报红（5/5 proven-to-fire）；A33 四段全绿（缺一段即 FAIL）；`smoke-baseline.txt` 含 `structured-workbench-smoke.sh`；本分支该 workflow 最近一次运行 `conclusion == success` 且其中 `runs-on: windows-latest` 的 job `conclusion == success`（`skipped` 视为 FAIL）。

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud

> 三段串行：段1 静态守卫（无需 DB/服务）→ 段2 真 `apps/api` + 真 Postgres 双企业种子全链 + 12 条变异 proven-to-fire → 段3 windows-latest 干净 VM 真浏览器（A33 判据 = job 真跑过）。
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

echo "== 段2/3 真 apps/api + 真 Postgres 双企业种子全链 + 12 条变异 =="
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
| G1 旧 fields 处置 | `tests/fields-legacy-isolation.test.ts` | `无身份调 /api/fields 四端点均返 401`、`A 企业身份读不到 B 企业 field_definitions`、`A 企业身份改不动 B 企业 field_definitions 且 B 行未变` | 四端点当前无鉴权返 2xx → 3 failures |

> 「BEHAVIOR 覆盖」列每个名字都是对应 `it()` 名的字面子串，`grep -F` 可命中。
> 这些 vitest 是 generator 的 TDD red-green 用；evaluator 的 verdict 只来自 `contract-dod.md` 的 `manual:` 命令。

---

## Contract Gate 备注

`contract-gate: skipped (packages/brain/src/lib/contract-gate.js not found, third-party repo=zenithjoy-workspace)` —— 本 repo 无代码层 Contract Gate，合规按本 skill 内置规则自审（惯用法速查表 + 自查 checklist + Step 2b-check 确定性脚本）。
