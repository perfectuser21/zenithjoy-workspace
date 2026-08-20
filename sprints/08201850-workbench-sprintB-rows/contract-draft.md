# Sprint Contract Draft (Round 2) — 路③ 结构化工作台 · Sprint B「数据进得来」

**上位合同**：GP `c86e37ff-3307-4b1a-80d9-3b00b8450554`（line11 员工知识中枢 · 路③ 结构化工作台，v3 已批准）。
本刀 = **S2 段**，门禁断言 **A12–A19**（上位合同 §8 Sprint B），外加 A1/A3 范式在「行」这一层复跑。
CONTRACT IS LAW：上位合同的判定点 J1/J2/J5/J9/J10/J11/J12 是本刀的法律，本合同不得与之冲突，也不得替它做新裁定。

**基线**：`origin/main` @ `42889f83`（Sprint A PR#1680 已合并）。本合同全部现状陈述取自该 commit 的实读，非记忆。

## GP-Anchor

GP-Anchor: line11/structured_workbench#step2

> **本刀唯一对外锚 = `#step2`**（r2 修订：合同、`contract-dod.md` frontmatter、generator 建 PR 时 body 里的锚，三处逐字同一个值，不再一份文件一个值）。
> 本刀推进的是 GP 合同 S2 段；锚写成 `#step1` 会让棘轮认为在推进已完成的 S1，S2 的 smoke 新增段不计入「多过一关」。
> `anchor-payload-mismatch`：controller 注入的 payload 里 `gp_anchor` 仍是 A 刀留下的 `#step1`（PRD 假设第 3 条登记的既有事实）。**这一处不由 generator 消化**——请 controller 侧把 payload 改成 `#step2`；在改之前，以本行声明的 `#step2` 为准。

---

## 已知约束

### [回归测试] Sprint A 已验收行为（`sprints/08201151-.../tests/`，本刀不得回退）

- `workbench-auth-guard.test.ts` → 401 `SESSION_REQUIRED` / 403 `NO_TENANT` / 409 `MULTI_ORG_MEMBER` / 503 `LEDGER_UNREACHABLE` 四态；身份零请求头
- `workbench-tables.test.ts` → 建表返 201 且 `org_id` 取自会话忽略请求体；八类字段落 `db_fields`；建表零运行时 DDL；反枚举统一 404
- `workbench-visibility-trash.test.ts` → 「仅自己」是真访问控制；删表二次确认；软删物理行仍在；回收站还原后字段逐字回归
- `fields-legacy-isolation.test.ts` → 旧 `/api/fields` 四端点已挂鉴权 + `field_definitions.tenant_id` 隔离
- `apps/api/src/routes/workbench.test.ts` → ⚠️ **钉死「路③ 端点恰好 9 个」**，本刀新增 8 个端点必须同刀把该断言改成 17（改断言值，不删断言）

### [累积FR] Sprint A 已交付、本刀直接站在上面

- `workbenchAuthGuard`（`apps/api/src/middleware/workbench-auth.ts:71`）挂在 `routes/workbench.ts:37` 的 router 顶层，覆盖全部端点，新增行端点自动继承
- `req.workbenchIdentity = { memberId, orgId }`（`workbench-auth.ts:104`）是组织归属的**唯一**来源
- `notFoundBody()`（`workbench-auth.ts:56`）**不带 timestamp**，反枚举逐字节同形 404 的载体
- `zenithjoy.db_rows` 已建（`20260820_120000_structured_workbench.sql:72-85`）：`id / table_id / org_id / data JSONB / row_order / deleted_at / created_at / updated_at`，**无 `version`、无 `created_by`**
- `.github/workflows/e2e-knowledge-hub-path3.yml` 独立 workflow 已在，`windows-real-browser` job **无 job 级事件条件门**（A33(c)）——本刀只往它的 steps 里加，**绝不加 job 级 `if:`**
- `.github/workflows/scripts/smoke/structured-workbench-smoke.sh` 的夹具供给协议（`--fixture-up` 起真 api + 种双企业 + 签三个真会话）与变异协议（`--mutation-apply` 只改代码，判据外置）

### [端点] context-manifest: unavailable

`GET localhost:5221/api/brain/line/da60cb26-.../context-manifest` 返 `Cannot GET`（端点在本 Brain 版本不存在）。累积 FR 改由上面「Sprint A 实际合并产物」逐条补齐，不静默跳过。

---

## Response Schema（推导来源：Sprint A 已合并端点族的字面约定 + PRD 范围限定；registry 为 cecelia 域，对本 repo 无参考价值）

**统一成功体**（`routes/workbench.ts:39` `ok()`）：`{"success": true, "data": <下表 data>}`
**统一失败体**（`workbench-auth.ts:45` `workbenchErrorBody()`）：`{"success": false, "data": null, "error": {"code": <string>, "message": <string>}, "timestamp": <ISO>}`
**404 专用体**（`workbench-auth.ts:56` `notFoundBody()`，**无 timestamp**）：`{"success": false, "data": null, "error": {"code": "NOT_FOUND", "message": "表不存在或无权访问"}}`

> **死规则**：本刀新增端点一律复用上面三种体，**不得**为 409 冲突或超限另开响应形状（形状分叉 = 前端 `knowledgeFetch` 解析器要分叉 = A2 家族口径破裂）。冲突后前端要拿对方的值，走**重新 GET 该行**，不靠错误体夹带。

### 行对象（Row，全端点共用）

```json
{"row_id": "<uuid>", "data": {"<field_id>": <值>}, "version": 1, "row_order": 0, "created_at": "<ISO>", "updated_at": "<ISO>"}
```

- `row_id` (string, 必填)：来源——Sprint A `table_id` / `field_id` 同族命名，**禁用 `id`**
- `data` (object, 必填)：key **一律是 `db_fields.id`（稳定 field_id）**，绝不是字段名，绝不是列序号（PRD 范围限定：无 colId 特例）
- `version` (number, 必填)：行级乐观锁基线，建行时 = 1，每次成功 PATCH +1
- `row_order` (number, 必填) / `created_at` / `updated_at` (string ISO, 必填)
- **禁用字段名**：`id`、`rowId`、`rev`、`etag`、`updatedAt`、`fields`（本刀 response key 一律 snake_case，与 Sprint A 逐字同族）
- **keys 完整性**：Row 的顶层 keys **恰好等于** `["created_at","data","row_id","row_order","updated_at","version"]`（多一个少一个都算漂移）。该约束已 codify 成 DoD Step1/Step2 那条里的 `jq -e '(.data | keys) == [...]'` 与 6 个禁用名的反向 `has()` 断言

### 三条实现约束（r2 新增 — 原先只活在测试里，合同没写）

1. **`row_limit` 每请求从 env 解析**：服务端每次处理请求时读 `process.env.WORKBENCH_ROW_LIMIT`（缺省 `5000`），**禁止**在模块加载期固化成常量。判据：同一进程内改 env 后 `GET rows` 的 `row_limit` 必须跟随（DoD Step6 超限条内联断言 `row_limit == 3`；`tests/rows-paste-limit.test.ts` 在 `it()` 内改 env 也依赖此约束）
2. **错误判定顺序固定为 `404` → `400` → `409`**：不可达/不存在（行不存在、跨组织、行已软删、表已软删）**先于**任何校验与版本比较返回 404 `notFoundBody()`；通过存在性与权限后才做类型校验（400），最后才比对 `version`（409）。判据：对已软删表的行发 `{"version":1,"data":{}}` 必须 404 而不是 400
3. **空 `data: {}` 合法**：`PATCH` 的 `data` 为空对象时只做存在性 + 权限校验，不返 400；不改任何格，`version` 也不递增（无副作用的空写）

### Endpoint: GET /api/knowledge/db/tables/:id/rows

**Success (200)**：`{"success": true, "data": {"rows": [<Row>], "total": <number>, "row_limit": 5000}}`
- `rows`：该表全部**未软删**行，按 `row_order ASC, created_at ASC`
- `total` (number)：同上集合的行数（前端「已有行数」提示与硬拦的依据）
- `row_limit` (number)：服务端当前上限，**前端不得自己写 5000**（写死即违反 INV「禁写死环境假设值」）
- 表不存在 / 跨组织 / 他人 private 表 / 表已软删 → 404 `notFoundBody()`

### Endpoint: POST /api/knowledge/db/tables/:id/rows

**Success (201)**：`{"success": true, "data": <Row>}`（`data` = `{}`，`version` = 1）
**Error**：`total >= row_limit` → 400 `{"code": "ROW_LIMIT_EXCEEDED", "message": "已有 <n> 行，超过单表上限 <limit> 行，未新增"}`

### Endpoint: PATCH /api/knowledge/db/rows/:id

**Request**：`{"version": <number>, "data": {"<field_id>": <值>}}`（`data` 是**增量补丁**，只含被改的格）
**Success (200)**：`{"success": true, "data": <Row>}`（`data` 是合并后的整行，`version` 已 +1）
**Error**：
- 基线 `version` ≠ 库中当前值 → **409** `{"code": "ROW_VERSION_CONFLICT", "message": "该行已被他人修改，你的改动未保存"}`，且**库中该格逐字未变**
- 值与字段类型不符 / `field_id` 不属于该表 / `version` 缺失或非数字 → 400 `{"code": "VALIDATION_FAILED", "message": <具体原因>}`，库中逐字未变
- 行不存在 / 跨组织 / 行已软删 / 表已软删 → 404 `notFoundBody()`

> ⚠️ 409 在本路有两个持有者：闸层的 `MULTI_ORG_MEMBER`（`workbench-auth.ts:100`）与本端点的 `ROW_VERSION_CONFLICT`。断言一律查 `error.code` 而非裸状态码。

**字段类型校验表**（`field_type` → 合法值；`null` 一律合法 = 清空该格）

| field_type | 合法值 | 典型非法值（必须 400） |
|---|---|---|
| `text` / `long_text` | JSON string（含空串） | 数字、对象、数组 |
| `number` | JSON number（有限） | `"12"`（字符串数字）、`NaN` |
| `date` | `YYYY-MM-DD` 字面 string | `"2026/08/20"`、`"今天"` |
| `single_select` | string 且 ∈ 该字段 `options` | 不在 options 里的串 |
| `multi_select` | string[] 且 ⊆ `options` | 裸 string、含 options 外元素 |
| `person` | 非空 string（成员 open_id） | 空串、数组 |
| `url` | string 且以 `http://` / `https://` 开头 | `javascript:alert(1)`、`ftp://x` |

### Endpoint: DELETE /api/knowledge/db/rows/:id

**Success (200)**：`{"success": true, "data": {"row_id": "<uuid>", "deleted_at": "<ISO>"}}`（**软删**：只打 `deleted_at`，物理行一条不少）

### Endpoint: GET /api/knowledge/db/tables/:id/rows/trash

**Success (200)**：`{"success": true, "data": {"rows": [{"row_id": "<uuid>", "deleted_at": "<ISO>", "restorable_until": "<ISO>"}]}}`
（`restorable_until` = `deleted_at + 30 天`，复用 `workbench.service.ts:34` 的 `TRASH_RETENTION_DAYS`，**不新造常量**）

### Endpoint: POST /api/knowledge/db/rows/:id/restore

**Success (200)**：`{"success": true, "data": <Row>}`（`deleted_at` 回 NULL，`data` 逐字回归，`version` 不变）

### Endpoint: POST /api/knowledge/db/tables/:id/rows/paste

**Request**：`{"header": ["列1", "列2"], "rows": [["a", "b"], ["c", "d"]]}`
**Success (201)**：`{"success": true, "data": {"inserted": <number>, "created_fields": [{"field_id": "<uuid>", "name": "列2", "field_type": "text"}], "row_ids": ["<uuid>"]}}`
- `header` 中与现有 `db_fields.name` 逐字相等的列 → 复用该字段；**未匹配的列一律新建 `field_type: "text"`**（上位合同 J9，不做类型推断）
- 落库行数 `inserted` **恰等于** `rows.length`
**Error**：`total + rows.length > row_limit` → 400 `{"code": "ROW_LIMIT_EXCEEDED", "message": "已有 <n> 行，本次粘贴 <m> 行，超过单表上限 <limit> 行，整批未导入"}`，**库中零新增、零新建字段**（整批原子拒绝，禁部分落地）

### Endpoint: GET /api/knowledge/db/tables/:id/export

**Success (200)**：`{"success": true, "data": {"table_id": "<uuid>", "name": "<表名>", "fields": [<Sprint A FieldOut>], "rows": [<Row>], "exported_at": "<ISO>"}}`
- `rows` = 该表全部未软删行，行数与 `db_rows` 中该表未软删行数**相等**
- 导出体内**零他组织数据**（判据：grep 不到他组织的 `org_id` / 表名 / 单元格值）

---

## 真实调用方请求 shape

本刀唯一的真实调用方是**员工的浏览器**（`apps/staff-hub`，Vite 同源 proxy 打 `apps/api`）。逐字段摘录自已合并的 `apps/staff-hub/src/lib/workbenchFetch.ts:78` → `knowledgeFetch.ts`：

| 项 | 真实形态 | 依据 |
|---|---|---|
| 认证 | **仅 Cookie**（better-auth session），`credentials: 'include'` | `workbench-auth.ts:63` 只读 `req.headers` 给 better-auth 解 cookie，**零自定义身份头** |
| Content-Type | `application/json` | `knowledgeFetch` 统一拼 |
| 身份头 | **一个都没有**（禁 `X-Feishu-User-Id` 等七个字面量） | `workbenchFetch.ts:9` 注释明令不复用 adminFetch |
| 组织归属 | **不在请求里**，服务端从会话解析 | 上位合同 J10 |
| 基址 | `/api/knowledge/db`（同源） | `workbenchFetch.ts:13` `WORKBENCH_BASE` |

**死规则**：本合同全部 DoD 断言构造的请求必须与该 shape 逐字段一致——用 `-b "$COOKIE_A"` 带真 cookie，**不许**为了省事拼身份头。拼了不但测不到真路径，还会被 A2 静态守卫在源码层抓住。

---

## 禁 mock 边清单

本单命中「DB 写路径」「跨模块数据传递」「状态机（行 version 迁移）」三类，以下边一律禁 mock：

- 代码 ↔ `zenithjoy.db_rows`（本刀新增全部写路径：INSERT / 带 version 条件的 UPDATE / 软删 UPDATE / 还原 UPDATE）→ 测试必须真 Postgres 验行落库，禁 stub `pg`
- 代码 ↔ `zenithjoy.db_fields`（粘贴自动建列会写这张表）→ 真 INSERT 真 SELECT
- 代码 ↔ `zenithjoy.db_audit`（行写入/删除/还原的审计行）→ 真查
- `workbenchAuthGuard` ↔ 行路由（会话 → `orgId` → 行归属这一跳）→ 走真 `/api/staff/feishu-login` 签真会话，禁伪造 cookie 字符串
- 行 `version` 状态机（读基线 → 带条件 UPDATE → 冲突分支）→ **两个真并发请求**打真库，禁用「手工把 version 改掉再单发一个请求」的伪并发

唯一允许 mock 的边：飞书 OAuth 上游（`FEISHU_API_BASE` 指向本地假上游，属**环境端点重定向**，被测代码路径一行不变）——沿用 Sprint A / 路① 先例。

---

## 未覆盖真实链路清单

| 真实链路点 | 被什么顶替 | 为什么 | 真验证补位计划 |
|---|---|---|---|
| 剪贴板系统级读写 | Playwright `page.evaluate` 构造 `ClipboardEvent` + `DataTransfer` 派发到 grid | GHA windows runner 无桌面剪贴板权限模型，`navigator.clipboard.readText()` 在无头 Chromium 上需要用户手势且不可靠 | **被测代码路径未被顶替**：粘贴处理器（解析 TSV → 调 paste 端点）全程真跑，只有「字节怎么进浏览器」这一段用事件派发。真桌面剪贴板留给 S3 手验，记 P2 |
| 5000 这个具体阈值 | CI 内用 `WORKBENCH_ROW_LIMIT` 覆写成小值证明闸真的在 | 真插 5000 行会把 windows job 预算烧光（Sprint A 教训：12 分钟预算被 logcat 烧掉 10 分钟） | 默认值 5000 由 ARTIFACT + 纯逻辑单测双钉（不设 env 时 `ROW_LIMIT === 5000`）；闸的存在性由小阈值真跑证明。**两层都在，缺一即假绿** |

本刀无 `force_*`、无 stub、无假响应体。

---

## 接缝清单

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 状态 |
|---|---|---|---|---|
| **接缝1** ⚠️ | 行级 `version` 乐观锁的并发语义 | Postgres 的 `UPDATE ... WHERE version = $n` 原子性 + 两个真会话真并发 | windows job / linux job 内两个真 HTTP 请求打真库，断言恰一个 200 一个 409、库值 = 先提交者 | 未真验 → 交付前标 `logic-done-pending` |
| **接缝2** ⚠️ | 写回失败时前端保留用户输入 | 真浏览器的网络失败（`context.setOffline(true)`）+ React 状态 | Playwright 真断网 → 断言单元格错误态可见且 `input` 的 DOM 取值 == 用户所打内容 → 恢复网络就地重试成功 | 未真验 → 交付前标 `logic-done-pending` |
| **接缝3** | AG Grid 32.2.1 在 staff-hub 的渲染/编辑 | 真浏览器 DOM + 真 CSS 主题 | windows-latest 真浏览器跑完整 grid 交互链 | 未真验 → 交付前标 `logic-done-pending` |

三条全部只能在 `windows_cloud` 真浏览器 job 里转绿；linux job 的 CI 绿 **≠** done。

---

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| **FR（做什么）** | 员工在表格视图建行/改格/删行/还原行、粘贴批量导入、展开行详情、导出整表 JSON；数据落 `db_rows.data` JSONB，key 为稳定 `field_id` |
| **NFR（做得多好）** | 单表 ≤5000 行（UI 硬拦 + API 整批拒绝）；并发同格走行级 `version` 乐观锁返 409；跨组织不可达统一 404 同形；AG Grid 钉死 32.2.1；行写入/删除/还原全部落 `db_audit` |
| **Invariant（永不违反）** | 组织归属只来自 `req.workbenchIdentity.orgId`；七个明文身份头字面量零命中；禁静默覆盖；禁静默吞写回失败；软删可还原；零运行时 DDL；用户输入永不进 SQL 标识符位 |
| **判定点（怎么知道）** | 见下方登记表（4 条，其中 2 条 ⚠️） |
| **保质期（何时过期）** | 行回收站 30 天（复用 `TRASH_RETENTION_DAYS`）；5000 行上限是 thin 期口径，上服务端行模型时由 S4 后续刀退役；会话有效期沿用 better-auth 现设，本刀不改 |
| **死亡告警（停了谁知道）** | 行端点族进 `structured-workbench-smoke.sh`，该脚本已在 `smoke-baseline.txt` 的 nightly 棘轮里；`e2e-knowledge-hub-path3.yml` 在每个命中 paths 的 PR 上跑，windows job 红 = PR 合不进去 |
| **失败语义（挂了怎么办）** | 见下方失败语义声明表 |
| **效果确认（已发≠已生效）** | 每次单元格写回以**服务端返回的整行 + 递增后的 version** 为准回填（不是前端本地乐观值）；粘贴以 `inserted` 与真库计数双向核对；删行/还原以 `deleted_at` 真值确认 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 同一格是否发生并发冲突 | A. 行级 `version` 乐观锁（带条件 UPDATE 的 `rowCount`）; B. 比较 `updated_at` 时间戳; C. 悲观行锁 | **A. 行级 `version`** | 上位合同 J2 已裁定；`updated_at` 在同秒内的两次提交分辨不出，悲观锁会把一个人的编辑框变成另一个人的等待 | 静默覆盖：员工发现自己刚打的内容凭空消失，且无任何痕迹可查 |
| ⚠️ 写回到底成没成功 | A. 只看 HTTP 状态码; B. 以服务端返回的整行 + 新 `version` 回填; C. 保存后整表重拉 | **B. 以返回的整行与新 version 回填** | C 是现状 `CustomerListPage` 的病根（PRD 边界情况明令不得继承）：整表重拉会把失败的那一格用旧值盖回去，看起来像"保存成功后又被改回来了" | 失败被掩盖成成功，用户以为存上了，实际数据从未落库 |
| 粘贴时某一列算不算「表里已有的列」 | A. 按列名逐字相等; B. 按列名模糊/去空白匹配; C. 按列序号位置对齐 | **A. 列名逐字相等** | 逐字相等是唯一无歧义的判据；模糊匹配会把「金额」并进「金额(元)」造成数据错列，且不可逆 | 数据落进错误字段，且因字段类型创建后不可变，只能删列重来 |
| 一次粘贴是否超出行数上限 | A. `已有未删行数 + 本批行数 > limit` 整批拒绝; B. 截断到上限; C. 落到哪算哪 | **A. 整批拒绝** | 上位合同 J12 已裁定；B/C 都是静默丢行 | 用户以为导入成功实则丢行——最难发现的一类数据事故 |

> `judgment-pending-user`: 无。两条 ⚠️ 判定点均由上位合同 J2 / S2 承诺原文已拍板，非本刀新增裁定。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 基线 `version` 不匹配 | 409 `ROW_VERSION_CONFLICT`，**库中该格一个字节不改** | 是（重读该行拿新 version 再提交即可） | 前端单元格进冲突态 + 只重拉该行，**不整表 reload、不覆盖用户输入** |
| 写回 5xx / 断网 | 单元格进可见错误态，**原输入留在编辑器内** | 是（同一 `version` + 同一补丁重发；成功则 version 前进一次） | 就地重试，禁乐观回滚静默、禁全量重拉掩盖 |
| 粘贴超上限 | 400 `ROW_LIMIT_EXCEEDED`，整批拒绝，**零新增行、零新建字段** | 是（无副作用） | 提示含当前上限与已有行数，用户自行删行或分批 |
| 值与字段类型不符 | 400 `VALIDATION_FAILED`，库中逐字未变 | 是 | 单元格保持编辑态并显示原因 |
| 行详情面板打开时该行被他人删除 | 后续 PATCH 返 404 | 是 | 面板显示「该行已被删除」可见提示，**不白屏、不静默关闭** |
| 查不动库 | 503 `LEDGER_UNREACHABLE`（沿用 Sprint A `serverError()`） | 是 | 明确"未写入"，绝不吞成 403/200 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| 员工在单元格 / 粘贴区录入的任意文本（含表头列名） | **不可信**（但身份可信：会话已鉴权） | 本刀不把单元格值送进任何 LLM，N/A；`retrieval-exclusions.ts` 已把五张表挡在问答检索域外（A35） | 值一律作为**数据值**走绑定参数进 JSONB；列名只作为 `db_fields.name` 的数据值；`__proto__` / `constructor` 作为 JSONB key 时不得污染 JS 原型链；渲染一律走 React 文本节点，禁 `dangerouslySetInnerHTML` |

---

## 变异证明执行协议

沿用 Sprint A 协议（`structured-workbench-smoke.sh:9`）：`--mutation-apply <名>` **只改代码/数据**，内部一个 pass/fail 判定都没有、也不打印 `proven-to-fire`；判据外置为「施加变异后跑**被守卫的那一段**，断言它自己 `exit ≠ 0`」。行为类变异同时改源码与 `apps/api/dist` 编译产物（源码是证据，dist 是载体）。

本刀新增 **4 个变异开关**，逐个登记：

| 变异名 | 改什么 | 被守卫的段 | 期望 |
|---|---|---|---|
| `A13-version-nocheck` | 从行 UPDATE 的 WHERE 里摘掉 `AND version = $n`（即"注掉 version 检查"） | `--a13-only` | exit ≠ 0（第二个 PATCH 变成 200 且把先提交者的值盖掉） |
| `A16-row-hard-delete` | 删行由 `UPDATE ... SET deleted_at` 改成物理 `DELETE FROM zenithjoy.db_rows` | `--a16-only` | exit ≠ 0（物理行计数下降 + 还原拿不回来） |
| `A1R-row-org-bypass` | 行读写 SQL 去掉 `AND org_id = $orgId` 条件 | `--a1-a3-rows-only` | exit ≠ 0（B 企业会话读得到 A 企业的行） |
| `A15-limit-off` | 粘贴/建行前的上限判定改成恒放行 | `--a15-only` | exit ≠ 0（超限批次落了库） |

---

## Golden Path

[员工在工作台点开自己组织的一张表] → [表格视图列出全部未删行] → [新增行落库] → [行内改格失焦即存·8 类字段各一] → [同事同时改同一格 → 看到冲突提示而非静默覆盖] → [写回失败 → 单元格可见错误且输入还在] → [粘贴一片表格批量导入·超限整批拒绝] → [行详情面板改动即存] → [删行进回收站 → 30 天内还原逐字回归] → [导出整表 JSON 拿走，零他组织数据]

---

### Step 1: 打开表格视图，按序列出该表全部未删行

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条「进入表格视图，按序展示该表全部未删行（空表显示零行 + 「新增行」入口）」

**可观测行为**: 员工在工作台点表名进入 `/workbench/tables/:tableId`，看到 AG Grid 表格：列 = 该表 8 类字段，行 = 该表未删行按 `row_order` 排；空表显示零行且「新增行」按钮可点；页面上能看到「已有 N 行 / 上限 M 行」。

**验证命令**:
```bash
# 前置：bash structured-workbench-smoke.sh --fixture-up && . ./.wb-fixture.env
API="http://localhost:$API_PORT/api/knowledge/db"
TID=$(curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X POST "$API/tables" \
  -d "{\"name\":\"WB-S1-$SFX\",\"visibility\":\"org\",\"fields\":$EIGHT_FIELDS}" | jq -r '.data.table_id')
curl -sf -b "$COOKIE_A" "$API/tables/$TID/rows" \
  | jq -e '.success == true and (.data.rows | length) == 0 and .data.total == 0 and (.data.row_limit | type) == "number"'
```

**硬阈值**: 空表返 200、`rows` 长度 0、`total` = 0、`row_limit` 是数字（前端据此硬拦，不自己写 5000）

---

### Step 2: 新增行落库，刷新后仍在

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条「点「新增行」→ 表格出现一行空白行并落库，刷新后仍在」

**可观测行为**: 点「新增行」→ 表格立刻多一行；`db_rows` 里真多一条 `org_id` = 本组织、`version` = 1 的行；刷新页面这行还在。

**验证命令**:
```bash
RID=$(curl -sf -b "$COOKIE_A" -X POST "$API/tables/$TID/rows" | jq -r '.data.row_id')
psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.id = '$RID' AND r.table_id = '$TID' AND r.org_id = '$ORGA_TENANT_ID' AND r.version = 1 AND r.deleted_at IS NULL AND r.created_at > NOW() - make_interval(mins => 5)"
# 期望：1
```

**硬阈值**: 建行返 201 且 `version` = 1；库中该行存在、归属本组织、5 分钟时间窗内新建（防历史行冒充）

---

### Step 3: 行内改格失焦即存，8 类字段各验一次，刷新逐字不变（上位合同 A12）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + 上位合同 A12

**可观测行为**: 双击单元格 → 按字段类型出对应编辑器（长文本多行、单选下拉、多选多值、日期选择器…）→ 改值失焦 → 值落 `db_rows.data`（key = `field_id`）→ 刷新页面逐字不变。类型不符的值返 400 且库中逐字未变。

**验证命令**:
```bash
# 8 类各写一次，逐字回读（示例取 text 与 number 两类，DoD 里八类全跑）
FID_TEXT=$(curl -sf -b "$COOKIE_A" "$API/tables/$TID/fields" | jq -r '.data.fields[] | select(.field_type=="text") | .field_id')
V=$(curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X PATCH "$API/rows/$RID" \
  -d "{\"version\":1,\"data\":{\"$FID_TEXT\":\"甲的值\"}}" | jq -r '.data.version')
[ "$V" = "2" ] || { echo "FAIL: version 未递增"; exit 1; }
psql "$PG" -t -A -q -c "SELECT r.data ->> '$FID_TEXT' FROM zenithjoy.db_rows r WHERE r.id = '$RID'"
# 期望：甲的值
```

**硬阈值**: 八类字段各一次 PATCH 全部 200；库中 `data ->> field_id` 与所打内容**逐字相等**；每次成功 PATCH `version` 恰 +1；类型不符返 400 `VALIDATION_FAILED` 且该格逐字未变

---

### Step 4: 并发同格 → 第二个 409 + 库值 = 第一个 + UI 可见冲突提示（上位合同 A13，⚠️ 接缝1）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条 + NFR「并发冲突走行级 version 乐观锁，不匹配返 409」

**可观测行为**: 甲乙两个会话同时读到 `version = N`，各自改同一格并提交：先到的返 200（`version` → N+1），后到的返 **409 `ROW_VERSION_CONFLICT`**；库中该格 = **先提交者**的值；乙的界面出现「该行已被他人修改，你的改动未保存」的可见提示，且乙打的内容仍在编辑器里。

**验证命令**:
```bash
# 两个真会话、同一基线 version、真并发（后台并行发出，不串行）
VN=$(curl -sf -b "$COOKIE_A" "$API/tables/$TID/rows" | jq -r ".data.rows[] | select(.row_id==\"$RID\") | .version")
curl -s -o /tmp/wb-c1.json -w '%{http_code}\n' -b "$COOKIE_A"  -H 'Content-Type: application/json' \
  -X PATCH "$API/rows/$RID" -d "{\"version\":$VN,\"data\":{\"$FID_TEXT\":\"甲写的\"}}" > /tmp/wb-c1.code &
curl -s -o /tmp/wb-c2.json -w '%{http_code}\n' -b "$COOKIE_A2" -H 'Content-Type: application/json' \
  -X PATCH "$API/rows/$RID" -d "{\"version\":$VN,\"data\":{\"$FID_TEXT\":\"乙写的\"}}" > /tmp/wb-c2.code &
wait
# 期望：两个状态码恰好一个 200 一个 409；409 那个 error.code == ROW_VERSION_CONFLICT
# 且 psql 读到的值 == 那个返 200 的会话写的内容
```

**硬阈值**: 恰一个 200 + 恰一个 409；409 体 `error.code == "ROW_VERSION_CONFLICT"`；库中该格 = 200 那侧写的值（不是"后写的赢"）；**变异证明**：`A13-version-nocheck` 施加后 `--a13-only` 必须 exit ≠ 0

---

### Step 5: 写回失败 → 单元格可见错误态且原输入仍在编辑器内（上位合同 A14，⚠️ 接缝2）

**来源**: `[FROM_PRD]` — PRD 边界情况「写回失败（500/断网）：单元格进入可见错误态，原输入仍留在编辑器内，就地重试不用重打；禁乐观回滚静默、禁全量重拉掩盖失败」

**可观测行为**: 真浏览器里断网 → 改一格失焦 → 单元格出现可见错误标记，**编辑器里还是用户打的那串字**（不是被旧值盖回去，也不是整表重新拉一遍把编辑框冲掉）→ 恢复网络就地重试 → 200 且库中值 = 用户所打内容。

**验证命令**（windows job 内 Playwright；`setOffline` 是**真实网络条件**，不是请求拦截/改写，不违反变体C 死规则）:
```javascript
await context.setOffline(true);
await grid.getByTestId(`cell-${rowId}-${fidText}`).dblclick();
await page.getByTestId(`cell-editor-${rowId}-${fidText}`).fill('断网时打的字');
await page.keyboard.press('Tab');                       // 失焦触发写回
await expect(page.getByTestId(`cell-error-${rowId}-${fidText}`)).toBeVisible({ timeout: 15000 });
await expect(page.getByTestId(`cell-editor-${rowId}-${fidText}`)).toHaveValue('断网时打的字');
await context.setOffline(false);
await page.getByTestId(`cell-retry-${rowId}-${fidText}`).click();
await expect(page.getByTestId(`cell-error-${rowId}-${fidText}`)).toHaveCount(0, { timeout: 15000 });
```

**硬阈值**: 错误态可见；编辑器 DOM 取值**逐字等于**用户所打内容；恢复网络后就地重试成功且库中该格 = 该内容（真 psql 回读）

---

### Step 6: 粘贴批量导入，未匹配列自动建「文本」字段；超 5000 整批拒绝（上位合同 A15 / J9 / J12）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条 + 边界情况「粘贴超上限：整批拒绝、库中零新增、提示含当前上限与已有行数；UI 侧「新增行」达上限时硬拦」

**可观测行为**: 从表格软件复制一片区域 → 在表格里粘贴 → 恰 N 行落库；表里没有的列自动建成 `text` 类型字段（不做类型推断）；粘贴使总行数超上限 → 整批拒绝、库中零新增行零新建字段、提示里能看到当前上限与已有行数；行数达上限时「新增行」按钮硬拦。

**验证命令**:
```bash
RESP=$(curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X POST "$API/tables/$TID/rows/paste" \
  -d '{"header":["字段-text","全新列"],"rows":[["a1","b1"],["a2","b2"],["a3","b3"]]}')
echo "$RESP" | jq -e '.data.inserted == 3 and (.data.created_fields | length) == 1 and .data.created_fields[0].field_type == "text"'
psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_fields f WHERE f.table_id = '$TID' AND f.name = '全新列' AND f.field_type = 'text'"
# 期望：1（自动建列落库且类型是 text，不是被推断成别的）
```

**硬阈值**: `inserted` 恰等于粘贴行数且与库计数相等；未匹配列自动建且 `field_type == "text"`；超限批次返 400 `ROW_LIMIT_EXCEEDED`、message 含上限与已有行数、库中行数与字段数**前后完全相等**；**变异证明**：`A15-limit-off` 施加后 `--a15-only` 必须 exit ≠ 0

---

### Step 7: 行详情面板打开、改动即存；面板打开时该行被删 → 可见提示而非白屏

**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 条 + 边界情况「行详情面板打开时该行被他人删除 → 可见提示而非白屏」

**可观测行为**: 点行首展开面板 → 看到该行**字段全集**（长文本渲染为多行编辑区）→ 在面板里改值同样失焦即存；面板开着时该行被他人删掉 → 面板出现可见提示，页面不白屏、不崩。

**验证命令**（windows job 内 Playwright；r2：以下断言**必须原样进** `apps/staff-hub/e2e/structured-workbench-rows.spec.ts`，并由该 workflow 里一个名字含「行详情」的 step 真跑 —— DoD Step7 两条以「windows job conclusion + 该 step 真跑」为判据，spec 内容由 ARTIFACT「行 E2E spec…逐字含三组断言」钉住）:
```javascript
await page.getByTestId(`row-expand-${rowId}`).click();
const panel = page.getByTestId('row-detail-panel');
await expect(panel).toBeVisible();
await expect(panel.getByTestId(/^detail-field-/)).toHaveCount(8);        // 字段全集
await expect(panel.locator('textarea')).toHaveCount(1);                  // long_text 是多行编辑区
await panel.getByTestId(`detail-field-${fidLongText}`).fill('面板里改的字');
await panel.getByTestId('detail-save-hint').waitFor();                   // 面板内失焦即存
// 他人删掉该行后，面板内改动提交 → 可见提示，且页面主体不白屏
await expect(page.getByTestId('row-gone-notice')).toBeVisible({ timeout: 15000 });
await expect(page.getByTestId('workbench-table-page')).toBeVisible();
```

**UI 侧上限硬拦**（同一 spec，由名字含「上限硬拦」的 step 跑；`WORKBENCH_ROW_LIMIT` 在该 step 的 env 里设成小值，**不写死 5000**）:
```javascript
// 行数已达服务端下发的 row_limit 后
await expect(page.getByTestId('add-row-button')).toBeDisabled();
await expect(page.getByTestId('row-limit-hint')).toContainText(String(rowLimitFromApi));
```

**硬阈值**: 面板字段数 = 该表字段数（8）；`long_text` 渲染为 `textarea`；面板内改值后库中逐字落库；行被删后出现 `row-gone-notice` 且 `workbench-table-page` 仍 visible（没白屏）；达上限时「新增行」按钮 `disabled` 且提示文案含**服务端下发的**上限值；本步截图 `06-row-detail-panel.png`

---

### Step 8: 删行进回收站，30 天内还原全字段逐字回归（上位合同 A16）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 7 条前半「删一行 → 该行离开表格进回收站、30 天内可还原且全字段逐字回归」

**可观测行为**: 删行 → 该行从表格消失、出现在回收站列表（带 `restorable_until`）；`db_rows` 里**物理行仍在**只是 `deleted_at` 非空；还原 → 行回到表格，`data` 全字段逐字回归。

**验证命令**:
```bash
BEFORE=$(psql "$PG" -t -A -q -c "SELECT r.data::text FROM zenithjoy.db_rows r WHERE r.id = '$RID'")
C0=$(psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.table_id = '$TID'")
curl -sf -b "$COOKIE_A" -X DELETE "$API/rows/$RID" | jq -e '.data.deleted_at != null'
C1=$(psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.table_id = '$TID'")
[ "$C0" = "$C1" ] || { echo "FAIL: 物理行被删了，不是软删"; exit 1; }
curl -sf -b "$COOKIE_A" -X POST "$API/rows/$RID/restore" >/dev/null
AFTER=$(psql "$PG" -t -A -q -c "SELECT r.data::text FROM zenithjoy.db_rows r WHERE r.id = '$RID'")
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: 还原后数据不逐字相等"; exit 1; }
```

**硬阈值**: 删后 `deleted_at` 非空且**物理行计数不减**；回收站列表含该行且 `restorable_until` = `deleted_at + 30 天`；还原后 `data` 与删前**逐字相等**；**变异证明**：`A16-row-hard-delete` 施加后 `--a16-only` 必须 exit ≠ 0

---

### Step 9: 单表 JSON 全量导出，行数字段集与库一致且零他组织数据（上位合同 A17）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 7 条后半「点「导出 JSON」→ 拿到该表全量行 JSON，内容与库中一致、不含任何他组织数据」

**可观测行为**: 点「导出 JSON」→ 拿到该表全量导出体：行数 = 库中未删行数、字段集 = 该表字段集；grep 不到任何他组织的痕迹。

**验证命令**:
```bash
EXP=$(curl -sf -b "$COOKIE_A" "$API/tables/$TID/export")
DBN=$(psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.table_id = '$TID' AND r.deleted_at IS NULL")
echo "$EXP" | jq -e --argjson n "$DBN" '(.data.rows | length) == $n'
echo "$EXP" | grep -q "$ORGB_TENANT_ID" && { echo "FAIL: 导出体里出现了他组织 id"; exit 1; }
```

**硬阈值**: 导出行数 == 库中未删行数；字段集与 `db_fields` 一致；导出体内他组织 `org_id`/表名/单元格值**零命中**

---

### Step 10: 跨组织行隔离正反双向（A1/A3 范式在「行」这一层复跑）

**来源**: `[AI_ADDED]` — 理由：上位合同 A34 要求隔离在**行**这一层单独成立，且 A3 教训是「只写反向 403 串会被『全端点一律拒绝』的假绿骗过」。行端点是本刀新增的攻击面，Sprint A 的表层断言覆盖不到它。

**可观测行为**: B 企业会话对 A 企业的行做读/改/删/还原/导出 → 一律 404（与随机 uuid 逐字节同形）且 A 企业该行**前后逐字未变**；**同一次运行内**，A 企业自己的会话对同样的操作全部 2xx 且拿到自己的数据。

**验证命令**:
```bash
BEFORE=$(psql "$PG" -t -A -q -c "SELECT r.data::text FROM zenithjoy.db_rows r WHERE r.id = '$RID'")
CODE=$(curl -s -o /tmp/wb-x1.json -w '%{http_code}' -b "$COOKIE_B" -H 'Content-Type: application/json' \
  -X PATCH "$API/rows/$RID" -d "{\"version\":1,\"data\":{\"$FID_TEXT\":\"越权写入\"}}")
[ "$CODE" = "404" ] || { echo "FAIL: 跨组织改行返 $CODE（应 404）"; exit 1; }
AFTER=$(psql "$PG" -t -A -q -c "SELECT r.data::text FROM zenithjoy.db_rows r WHERE r.id = '$RID'")
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: 跨组织写入生效了"; exit 1; }
# 正向对照：同时刻 A 企业自己读得到
curl -sf -b "$COOKIE_A" "$API/tables/$TID/rows" | jq -e "[.data.rows[].row_id] | index(\"$RID\") != null"
```

**硬阈值**: 跨组织五个操作全部 404 且响应体与随机 uuid 的 404 **md5 相等**；A 企业行数据逐字未变；同一次运行内正向对照全部 2xx；**变异证明**：`A1R-row-org-bypass` 施加后 `--a1-a3-rows-only` 必须 exit ≠ 0

---

### Step 11: XSS 窄面与对抗输入一律作为数据值（上位合同 A18 / A19）

**来源**: `[FROM_PRD]` — PRD 边界情况「恶意输入」段逐条

**可观测行为**: 字段名与单元格值注入 `<img src=x onerror=alert(1)>` → 渲染后该处 DOM **无 `img` 元素**、文本节点等于原字符串；`__proto__` / `constructor` / `"; DROP TABLE db_rows; --` / 超长 emoji 串一律作为**数据值**落库；`information_schema` 表清单未变、服务无 5xx、JS 原型链未被污染。

**验证命令**:
```bash
T0=$(psql "$PG" -t -A -q -c "SELECT string_agg(t.table_name, ',' ORDER BY t.table_name) FROM information_schema.tables t WHERE t.table_schema = 'zenithjoy'")
for P in '<img src=x onerror=alert(1)>' '__proto__' 'constructor' '"; DROP TABLE db_rows; --' '🧨🧨🧨'; do
  curl -s -o /dev/null -w '%{http_code}\n' -b "$COOKIE_A" -H 'Content-Type: application/json' \
    -X POST "$API/tables/$TID/rows/paste" \
    -d "$(jq -nc --arg p "$P" '{header:[$p],rows:[[$p]]}')" | grep -qE '^(201|400)$' \
    || { echo "FAIL: 对抗 payload 触发 5xx: $P"; exit 1; }
done
T1=$(psql "$PG" -t -A -q -c "SELECT string_agg(t.table_name, ',' ORDER BY t.table_name) FROM information_schema.tables t WHERE t.table_schema = 'zenithjoy'")
[ "$T0" = "$T1" ] || { echo "FAIL: information_schema 表清单变了（运行时 DDL）"; exit 1; }
```

**硬阈值**: 五个 payload 全部返 201 或 400（**无 5xx**）；`information_schema` 表清单前后全等；真浏览器里注入串所在单元格 DOM `img` 计数 = 0 且文本 = 原串；`Object.prototype` 未被添加属性

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud

> 三段串行，接线载体沿用 Sprint A 的 `.github/workflows/e2e-knowledge-hub-path3.yml`（**只往 steps 里加，绝不给 windows job 加 job 级 `if:`**——那正是 A33(c) 要堵的孤儿 spec 形态）：
> 段1 静态守卫（无需 DB/服务）→ 段2 真 `apps/api` + 真 Postgres 双企业行链路 + 4 次变异注入 → 段3 windows-latest 干净 VM 真浏览器（判据 = 那个 windows job 的 conclusion == success，**不是** workflow 总结论）。
> 库来源：`E2E_DATABASE_URL` → `DATABASE_URL` → 报错退出，**不静默落默认库**。

```bash
#!/usr/bin/env bash
# 路③ Sprint B final-e2e —— 员工把数据录进表里，改错能看见、删错能捞回、想拿走能导出
# 不用 set -e：靠显式 exit 传播失败，set -e 会让 `[ ... ] && x` 惯用法在条件为假时把脚本打死
set -uo pipefail

SMOKE=".github/workflows/scripts/smoke/structured-workbench-smoke.sh"
SPEC_HUB="apps/staff-hub/e2e/structured-workbench-rows.spec.ts"
WF="e2e-knowledge-hub-path3.yml"

for f in "$SMOKE" "$SPEC_HUB" ".github/workflows/$WF"; do
  if [ ! -f "$f" ]; then
    echo "FAIL: 交付物缺失 $f"
    exit 1
  fi
done

echo "== 段1/3 静态守卫（A2 七字面量含新增行路由文件 / A35 五表名 / A33 四段）=="
if ! bash "$SMOKE" --static-only; then
  echo "FAIL: 段1 静态守卫未过"
  exit 1
fi

if [ -z "${E2E_DATABASE_URL:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "FAIL: 未设 E2E_DATABASE_URL / DATABASE_URL —— 拒绝落默认库跑成假绿"
  exit 1
fi

echo "== 段1b/3 合同测试真被 vitest 收集执行（4 suite / ≥20 用例 / 零失败）=="
VITEST_OUT=/tmp/wb-rows-vitest-e2e.json
rm -f "$VITEST_OUT"
(cd apps/api && npx vitest run --config vitest.workbench-rows.config.ts --reporter=json --outputFile="$VITEST_OUT") >/tmp/wb-rows-vitest-e2e.log 2>&1
if [ ! -f "$VITEST_OUT" ]; then
  echo "FAIL: vitest 未产出报告（零收集 —— 4 个合同测试文件没有执行路径）"
  tail -30 /tmp/wb-rows-vitest-e2e.log
  exit 1
fi
if ! jq -e '.numTotalTestSuites == 4 and .numTotalTests >= 20 and .numFailedTests == 0 and .success == true' < "$VITEST_OUT" >/dev/null; then
  echo "FAIL: 合同测试未全绿或收集数不符"
  jq -c '{suites:.numTotalTestSuites,tests:.numTotalTests,failed:.numFailedTests,ok:.success}' < "$VITEST_OUT"
  exit 1
fi

echo "== 段2/3 真 apps/api + 真 Postgres 行链路（A12/A13/A15/A16/A17/A18/A19 + 行层 A1/A3）=="
for SEG in --a12-only --a13-only --a15-only --a16-only --a17-only --a18-a19-only --a1-a3-rows-only; do
  if ! bash "$SMOKE" "$SEG"; then
    echo "FAIL: 段2 $SEG 未过"
    exit 1
  fi
done

echo "== 段2b/3 变异证明四条（判据外置：施加变异后被守卫的那一段必须 exit != 0）=="
run_mutation() {
  MUT="$1"
  SEG="$2"
  if ! bash "$SMOKE" --mutation-apply "$MUT"; then
    echo "FAIL: 变异 $MUT 施加失败（注入点漂移了？）"
    exit 1
  fi
  bash "$SMOKE" "$SEG"
  RC=$?
  bash "$SMOKE" --mutation-revert "$MUT"
  if [ "$RC" -eq 0 ]; then
    echo "FAIL: 变异 $MUT 已施加但 $SEG 仍 exit 0 —— 那条守卫是空的"
    exit 1
  fi
  echo "  变异 $MUT 已证明会触发 $SEG 报红"
}
run_mutation A13-version-nocheck  --a13-only
run_mutation A16-row-hard-delete  --a16-only
run_mutation A1R-row-org-bypass   --a1-a3-rows-only
run_mutation A15-limit-off        --a15-only

echo "== 段3/3 windows-latest 干净 VM 真浏览器（AG Grid 行内编辑 / 冲突提示 / 断网保留输入 / 粘贴 / 行详情）=="
BRANCH=$(git rev-parse --abbrev-ref HEAD)
RUNS=$(gh run list --workflow "$WF" --branch "$BRANCH" --limit 1 --json databaseId,status,conclusion,url)
if ! echo "$RUNS" | jq -e 'length > 0' >/dev/null; then
  echo "FAIL: 分支 $BRANCH 上查不到 $WF 的运行记录 —— paths 未命中本刀新增源码，spec 又成孤儿"
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

JOBS=$(gh run view "$RUN_ID" --json jobs)
if ! echo "$JOBS" | jq -e '[.jobs[] | select(.name | test("windows")) | select(.conclusion == "success")] | length > 0' >/dev/null; then
  echo "FAIL: windows job 未成功执行（skipped 也算 FAIL —— 那就是孤儿 spec 形态）"
  echo "$JOBS" | jq -r '.jobs[] | "  job=\(.name) conclusion=\(.conclusion)"'
  exit 1
fi

for STEP_NAME in 断网 行详情 上限硬拦; do
  if ! echo "$JOBS" | jq -e --arg s "$STEP_NAME" '[.jobs[] | select(.name | test("windows")) | .steps[] | select(.name | test($s)) | select(.conclusion == "success")] | length > 0' >/dev/null; then
    echo "FAIL: windows job 里没有成功跑「$STEP_NAME」那一段"
    echo "$JOBS" | jq -r '[.jobs[] | select(.name | test("windows")) | .steps[].name] | @csv'
    exit 1
  fi
done

# 截图取证：从 windows job 的 artifact 下载（宿主机上手工塞的图不算数 —— 那是拿手工产物冒充真机产物）
SHOTS="sprints/08201850-workbench-sprintB-rows/screenshots"
TMPSHOTS=$(mktemp -d)
if ! gh run download "$RUN_ID" -n path3-rows-screenshots -D "$TMPSHOTS"; then
  echo "FAIL: 下不到本刀截图 artifact path3-rows-screenshots（workflow 缺 upload step 或真浏览器链没跑完）"
  exit 1
fi
SHOT_N=$(find "$TMPSHOTS" -name '*.png' | wc -l | tr -d ' ')
if [ "$SHOT_N" -lt 6 ]; then
  echo "FAIL: artifact 里只有 $SHOT_N 张截图（需 ≥6，第 6 张是行详情面板）"
  exit 1
fi
for F in $(find "$TMPSHOTS" -name '*.png'); do
  if [ ! -s "$F" ]; then
    echo "FAIL: 空截图 $F"
    exit 1
  fi
done
mkdir -p "$SHOTS"
find "$TMPSHOTS" -name '*.png' -exec cp {} "$SHOTS"/ \;

echo "路③ Sprint B final-e2e 通过：行 CRUD + 乐观锁 409 + 断网保留输入 + 粘贴上限 + 回收站还原 + 导出"
```

### BEHAVIOR:E2E 截图 DoD

六张截图清单与逐张期望**只住在 `contract-dod.md` 的 `## BEHAVIOR:E2E 条目` 段**（r2 去重：上一版两份文件各抄一遍，改一处就分叉）。取证路径：windows job 上传 `path3-rows-screenshots` artifact → 上面段3 用 `gh run download` 取回并落到 `sprints/08201850-workbench-sprintB-rows/screenshots/`。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 行 CRUD + 8 类字段校验 | `tests/rows-crud.test.ts` | `建行返 201 且 version 为 1`；`八类字段各改一次逐字落库`；`类型不符返 400 且该格逐字未变`；`表已软删后其行不可读写` | → 全红（`/rows` 端点族与 `version` 列均不存在） |
| 行级乐观锁 | `tests/rows-optimistic-lock.test.ts` | `同基线并发提交恰一个 200 一个 409`；`409 时库中该格等于先提交者的值`；`成功 PATCH 后 version 恰加一` | → 全红 |
| 粘贴导入与行数上限 | `tests/rows-paste-limit.test.ts` | `粘贴 N 行落库恰 N 行`；`未匹配列自动建为文本类型`；`超上限整批拒绝且库中零新增` | → 全红 |
| 组织隔离·回收站·导出·对抗输入 | `tests/rows-isolation-export.test.ts` | `跨组织改行返 404 且原行逐字未变`；`本组织正向读得到自己的行`；`删行软删物理行仍在`；`还原后全字段逐字回归`；`导出行数与库一致且零他组织数据`；`对抗输入作为数据值落库且表清单未变` | → 全红 |

> 「BEHAVIOR 覆盖」列每个名字都是 `tests/*.test.ts` 里对应 `it()` 名的字面子串（写法：先写 `it()` 名再截子串）。

### 执行路径（r2 新增 — 上一版这 4 个文件没有任何运行器会收集，等同于文档）

四个文件都是 **supertest + 真 Postgres** 的集成型合同测试，执行路径三件套，缺一即为孤儿：

1. **收集配置**：新增 `apps/api/vitest.workbench-rows.config.ts`，`include` 只含 `../../sprints/08201850-workbench-sprintB-rows/tests/**/*.test.ts`，`pool: 'forks'` + `singleFork: true` + `sequence.concurrent: false`（双企业种子共用一库，并发跑会互相踩）+ `testTimeout: 30000`
2. **运行脚本**：`apps/api/package.json` 加 `"test:workbench-rows": "vitest run --config vitest.workbench-rows.config.ts"`
3. **进 CI**：`e2e-knowledge-hub-path3.yml` 的 **linux job**（已有 postgres:16 service + `E2E_DATABASE_URL` + `npm run migrate`，正是这批测试需要的环境）在 migrate 之后加一步 `npm run test:workbench-rows --workspace apps/api`

> **为什么不塞进 `apps/api/vitest.config.ts` 的 include**：`ci-l4-runtime.yml` 的 `api-test` job 跑的是 `npx vitest run --coverage`（默认 config）且**没有 Postgres service**，塞进去会让这批需要真库的测试在那个 job 里必红——`vitest.config.ts` 自己第 27 行的注释就是同一坑的前例（`07212317-android-signal-reporting` 的 supertest 集成测试被注释掉，理由逐字为「需要真实 DB…不进 L3 CI」）。专用 config + 有库的 job 是同一目的的正确落点：**测试真被收集、真跑、红绿真机械可判**，而不是把一个绿的 job 打红。
>
> 判据（DoD Step0 那条）：`npx vitest run --config vitest.workbench-rows.config.ts --reporter=json --outputFile=...` 之后断言 `numTotalTestSuites == 4`、`numTotalTests >= 20`、`numFailedTests == 0`、跑的文件名恰是本刀那 4 个——只看 exit 0 挡不住零收集，所以四项一起断。当前 20 条 `it()`：crud 5 / optimistic-lock 4 / paste-limit 5 / isolation-export 6。

---

## 变更边界（external_commitment_changes）

- **改**：`apps/api/src/routes/workbench.ts`（加 8 条行路由）、`apps/api/src/services/workbench.service.ts`（加行服务，或拆 `workbench-rows.service.ts` 并进 A2 扫描域）、`apps/api/src/routes/workbench.test.ts`（**三条计数断言同步改**：端点清单数组补 8 条 + `toBe(9)`→`toBe(17)`、写端点 `toBe(4)`→`toBe(9)`、读端点 `toBe(5)`→`toBe(8)`，**改值不删断言**）、`apps/api/package.json`（加 `test:workbench-rows` 脚本）、`.github/workflows/e2e-knowledge-hub-path3.yml`（linux job 加「跑 7 个新段 + sprint vitest」两步；windows job 加「行详情面板」「上限硬拦」两步与本刀截图 upload step；`paths` 加本刀 spec）
- **加**：`apps/api/db/migrations/<新时间戳>_workbench_rows_version.sql`（`db_rows` 补 `version` / `created_by`，**不回改** A 刀已合并的 migration）、`apps/api/vitest.workbench-rows.config.ts`（本刀 tests 的收集配置）、staff-hub 表格视图页与组件、`apps/staff-hub/e2e/structured-workbench-rows.spec.ts`、smoke 的 S2 段与 4 个变异开关
- **不动**：`apps/dashboard` 一行不改（本刀与 works 家族零交集）；`apps/api/vitest.config.ts` 与 `ci-l4-runtime.yml` 一行不改（理由见 Test Contract「执行路径」小节：那条无库车道加进去必红）；`e2e-knowledge-hub-path3.yml` 的 `on:` 块与 windows job 的触发形态不改（只加 step 与 paths 条目，**绝不加 job 级 `if:`**）；Sprint A 的表/字段端点族语义不改

---

## r1 逐条回应（GAN Round 1 → Round 2）

**P0-1 四个测试文件没有执行路径** — 已修，落点与你给的处方**有一处刻意偏差**。三件套：新增 `apps/api/vitest.workbench-rows.config.ts`（include 只含本 sprint tests）+ `apps/api/package.json` 的 `test:workbench-rows` 脚本 + `e2e-knowledge-hub-path3.yml` 的 **linux job**（已有 postgres:16 + `E2E_DATABASE_URL` + `npm run migrate`）加一步真跑；变更边界三个文件都已列入；DoD 新增 Step0 那条 [BEHAVIOR]，用 `--reporter=json --outputFile` 断言 `numTotalTestSuites == 4` + `numTotalTests >= 20` + `numFailedTests == 0` + 跑的文件名恰是本刀那 4 个（只看 exit 0 确实挡不住零收集，四项一起断）。
**偏差与依据**：没有加进 `apps/api/vitest.config.ts` 的 include，因为 `ci-l4-runtime.yml` 的 `api-test` job 跑默认 config 且**没有 Postgres service**——这 4 个文件是 supertest + 真 PG，加进去会把一条现在绿的 required 车道打红；`vitest.config.ts` 自己第 27 行就有同一坑的前例（`07212317-android-signal-reporting` 的 supertest 测试被注释掉，理由逐字为「需要真实 DB…不进 L3 CI」）。你要的实质——「有运行器收集、真红真绿、进 CI」——三条全部满足，只是落在有库的那条车道上。

**P0-2 `db_audit` 那条结构性必红** — 已修，改成你说的自持形态：`--fixture-up` → 内联走完建行/改格/删行/还原四个动作 → 同一 shell 内 psql 断言四种 `action` 齐全且 `org_id = $ORGA_TENANT_ID`、外加「本轮零 `org_id IS NULL` 审计行」→ `--fixture-down`。既躲开段末 `cleanup_seed`（`REUSED_FIXTURE=1` 时 `final_down` 直接 return，清理只发生在我最后一行的 `--fixture-down`），也自己产出了 `soft_delete_row` / `restore_row` 两种 `--a12-only` 本来产不出的 action。

**P0-3 行详情面板 / 面板开着时被删 / UI 上限硬拦零 DoD** — 已修，三项各有落点：draft Step 7 的 Playwright 断言写全（补了面板内改动即存与 `workbench-table-page` 仍 visible），并加了「UI 上限硬拦」那段（`add-row-button` `toBeDisabled` + `row-limit-hint` 含服务端下发的上限，`WORKBENCH_ROW_LIMIT` 由 step env 给小值）；DoD 新增两条 [BEHAVIOR]，判据 = windows job conclusion + 名字含「行详情」/「上限硬拦」的 step 真跑成功；spec 内容由 ARTIFACT「行 E2E spec…逐字含三组断言」钉住（`row-detail-panel` / `detail-field-` / `textarea` / `row-gone-notice` / `add-row-button` / `WORKBENCH_ROW_LIMIT` / `toBeDisabled` 九个串逐字必在）——一个空 step 过不了这条 ARTIFACT。截图清单补 `06-row-detail-panel.png`。

**P1-1 回归断言改动清单不全 + ARTIFACT 死分支** — 已修。变更边界写全三条新值（清单数组补 8 条 + `toBe(9)→toBe(17)`、写 `toBe(4)→toBe(9)`、读 `toBe(5)→toBe(8)`）；ARTIFACT-4 重写为：8 条新端点串逐字必在 + `toBe(17)`/`toBe(9)`/`toBe(8)` 三个都在 + `toBe(4)`/`toBe(5)` 旧值零残留，死分支已删。

**P1-2 三段判定整体外包** — 已修，三段都换成自持内联，不再拿 `bash "$S" --xxx-only` 的 exit 码当唯一 oracle：`--a12-only` → 八类字段循环 PATCH，用 `data -> field_id = '<json>'::jsonb` 逐类全等回读（多选数组也能逐字比）且 `version` 1→9 每步断言；`--a17-only` → 先给 B 企业种一个带 `乙企业机密-$SFX` 的行，再断言导出行数/字段数与库相等且导出体 grep 不到 B 的 `org_id` 与那个机密串；`--a18-a19-only` → 五个 payload 逐个断言状态码 ∈ {201,400}（禁 5xx）+ 注入串真作为字段名与单元格值落库 + `information_schema` 表清单前后全等。三个 `--aN-only` 段仍然存在，改由 CI linux job 真跑（见 P1-4）。

**P1-3 截图无取证路径** — 已修。workflow 加本刀专属 upload step（artifact 名 `path3-rows-screenshots`，路径指本刀目录，与 A 刀那个 `path3-screenshots` 并存互不覆盖）；DoD 的 [BEHAVIOR:E2E] 与 final-e2e 段3 都改成 `gh run download <run_id> -n path3-rows-screenshots` 取回后数 png ≥ 6 且逐张非空字节，再落到 `sprints/.../screenshots/`——宿主机上手工塞的图不再能满足这条。

**P1-4 新段与新 spec 没有「进 CI」断言** — 已修，新增 ARTIFACT「workflow 逐字接线」：linux job 的 run 块必须逐字出现 7 个新段 flag 与 `test:workbench-rows`；windows job 的 **run 命令**（不是 step 名）必须出现 `structured-workbench-rows.spec.ts`；windows job 必须出现 `path3-rows-screenshots` 与本刀截图目录。把 spec 名塞进 `paths:` 已经不够用了。

**P1-5 GP-Anchor 双锚** — 已修，`contract-draft.md` 的 GP-Anchor 行、`contract-dod.md` frontmatter、`task-plan.json` 三处统一为 `#step2`，正文不再要求 generator 自己换算。controller payload 里那个 `#step1` 以 `anchor-payload-mismatch` 一行显式登记，请 controller 侧修，合同不替它裁定。

**P1-6 keys 完整性卡与禁用字段反向断言缺失** — 已修，建行那条 DoD 补 `jq -e '(.data | keys) == ["created_at","data","row_id","row_order","updated_at","version"]'` 与 `.data | ([has("id"),has("rowId"),has("rev"),has("etag"),has("updatedAt"),has("fields")] | any | not)` 各一条；Response Schema 段同步写明 keys 完整性口径。

**P1-7 两处实现约束只活在测试里** — 已修，Response Schema 段新增「三条实现约束」：① `row_limit` 每请求从 `process.env.WORKBENCH_ROW_LIMIT` 解析（缺省 5000），禁模块加载期固化——DoD 超限那条内联断言 `row_limit == 3` 会直接抓住固化写法；② 错误判定顺序固定 `404 → 400 → 409`；③ 空 `data:{}` 合法（只做存在性与权限校验）。

**未改（你已核过成立，本轮一字未动）**：行级 version 409 乐观锁那条、组织隔离双向、写回失败可见、软删还原变异、A 刀 oracle 那几处。

**行数**：draft 614 → 674（+60），dod 177 → 198（+21）。增量全部来自三个 P0 的「零验证 → 有验证」与三段内联 oracle；同时删掉了两处冗余（draft 里与 DoD 逐字重复的截图清单块、DoD 里与 Step11 内联断言重复的 INV-7 条目），并把「错误分支零整表重拉」从 [BEHAVIOR] 归位到 [ARTIFACT]（它本就是源码文本断言）。PRD 之外一条没加。
