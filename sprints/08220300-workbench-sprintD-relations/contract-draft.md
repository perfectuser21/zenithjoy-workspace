# Sprint Contract Draft (Round 1) — 路③ Sprint D · S4 关联连得上（跨表 Relation）

**Sprint**: 08220300-workbench-sprintD-relations
**journey_type**: user_facing
**target_environment**: windows_cloud
**上位 GP**: line11 员工知识中枢 / 路③ 结构化工作台（`c86e37ff-3307-4b1a-80d9-3b00b8450554`）
**门禁断言（本刀 delta）**: A27–A31（relation 功能）+ 把 relation 接入既有路级件（A32/A33 workflow、vitest、smoke baseline）

> **controller 两条 concern 已落实（详见文末「附一」）**：
> ① 范围收敛为 A27–A31 delta + 接入既有路级件，**不重造** A33（path3 workflow 已在 base）/ A35（`retrieval-exclusions.ts` 已在 base）/ A32/A34（workbench 路由族 + 鉴权闸已在 base）。
> ② 关联值存 `db_rows.data` JSONB（目标 row_id 数组）+ 目标表配置存 `db_fields.options[0]`，**零新建关联表**；反向引用用 JSONB 反查，不建反向索引表（裁量结论见附一）。

---

## GP-Anchor

GP-Anchor: line11/structured_workbench#step4

---

## Response Schema（推导来源: PRD 字面 + api_registry 同族既有端点推导）

本刀新增 2 个只读端点（PRD「预期受影响文件」逐字：行选择器数据端点 + 反向引用查询端点）。字段命名跟同族既有端点口径（`row_id` 而非 `id`、`field_id` / `table_id` 后缀，见 Sprint B/C 的 `RowOut` / `FieldOut` / `View`）。relation 字段本身复用既有 `POST /tables/:id/fields`（字段类型加 `relation`）与 `PATCH /rows/:id`（关联值写进 `data`），不新增写端点。

### Endpoint 1: GET /api/knowledge/db/tables/:tableId/fields/:fieldId/relation-candidates

**Success (HTTP 200)**:
```json
{"success": true, "data": {"field_id": "<uuid>", "target_table_id": "<uuid>", "candidates": [{"row_id": "<uuid>", "title": "<string>"}]}}
```
- `data` keys **恰好**（排序后） `["candidates","field_id","target_table_id"]`
- `field_id` (string uuid, 必填): 来源——PRD「relation 字段」；同族 `FieldOut.field_id` 口径
- `target_table_id` (string uuid, 必填): 来源——PRD「配置目标表 = 表B」
- `candidates` (array, 必填): 目标表**本组织未软删**记录；每项 keys **恰好** `["row_id","title"]`
  - `row_id` (string uuid): 同族 `RowOut.row_id` 口径
  - `title` (string): 目标行首字段（display_order=0）渲染值，无值回落 row_id

**禁用字段名（envelope 层）**: `rows` / `items` / `results` / `records` / `options` / `list` / `data`(嵌套)
**禁用字段名（candidate item 层）**: `id` / `label` / `name` / `text` / `value` / `display` / `primary`

**Error (HTTP 404，跨企业/私有非表主/随机不存在/目标表已删/字段非 relation 一律走此)**:
```json
{"success": false, "data": null, "error": {"code": "NOT_FOUND", "message": "表不存在或无权访问"}}
```
- **无 `timestamp`**（`notFoundBody()` 常量，带上就能靠比对字节分辨 id 是否真实存在）
- **404 优先于 400**：表/字段解析不到先返 404，不因「表真的存在」而走 400 分支（反枚举）

### Endpoint 2: GET /api/knowledge/db/rows/:rowId/backrefs

**Success (HTTP 200)**:
```json
{"success": true, "data": {"row_id": "<uuid>", "backrefs": [{"table_id": "<uuid>", "table_name": "<string>", "row_id": "<uuid>", "row_title": "<string>", "field_id": "<uuid>"}]}}
```
- `data` keys **恰好**（排序后） `["backrefs","row_id"]`
- `backrefs` (array, 必填): 「谁引用了我」；本组织内引用来源，**排除**：来源行已软删、来源表已软删、来源表为他人「仅自己」私有表（A29 零泄露）。每项 keys **恰好**（排序后） `["field_id","row_id","row_title","table_id","table_name"]`
  - `table_id`/`table_name`：来源表；`row_id`/`row_title`：来源行；`field_id`：来源表上那个 relation 字段

**禁用字段名（envelope 层）**: `references` / `refs` / `incoming` / `sources` / `data`(嵌套)
**禁用字段名（backref item 层）**: `id` / `name` / `title` / `table` / `source` / `ref` / `refs` / `reference` / `references` / `incoming`

**Error (HTTP 404)**: 同 Endpoint 1 的 `notFoundBody()`（行不存在/跨企业/私有非表主）

### 复用端点（字段类型扩展，无新响应形状）

- `POST /api/knowledge/db/tables/:id/fields`：body `fields[]` 项 `{name, field_type:"relation", options:[<targetTableId>], display_order}`；目标表不可解析（跨企业 org≠本组织 / 他人私有 / 不存在）→ `400 VALIDATION_FAILED`（`workbenchErrorBody`，带 timestamp）。`FieldOut.options[0]` 逐字回读 = 目标表 id。
- `PATCH /api/knowledge/db/rows/:id`：`data:{<relFieldId>:[<rowId>...]}`；关联值须为**数组**，元素须为目标表**本组织可见**记录，否则 `400 VALIDATION_FAILED`。落库形态 = `db_rows.data->'<relFieldId>'` 为 JSON 数组。
- `DELETE /api/knowledge/db/tables/:id/fields/:fieldId`（**本刀新增**，A30③）：body `{confirm_name}`；`confirm_name` ≠ 字段名 → `400 CONFIRM_MISMATCH`；相符 → 软删（`db_fields.deleted_at` 置位，行不物理删，`db_rows.data` 旧值保留）→ `200`。

---

## 已知约束（来自回归测试 + 累积 FR）

来自 base（Sprint A/B/C）回归测试与 GP §8 累积 FR，本刀**不得回退**：

- [`_workbench-fixture.ts`] 双企业种子恒定两家企业 + 三身份（alice 表主 / bob 同组织他人 / carol 他企业）；`license_key` NOT NULL+UNIQUE 必须给。
- [`structured-workbench-smoke.sh`] 七个禁用身份头字面量（`X-Tenant-Id`/`X-User-Email`/`X-Feishu-User-Id`/`X-Bypass-Tenant`/`tenantContextOptional`/`selfHealOwnerMember`/`staffGuard`）在路③源码零命中（A2）；A2 现算扫描域会自动纳入本刀新增 workbench 文件。
- [累积FR S1] 建表/字段元数据/软删+30天回收站/表级可见性（org/private）已验收。
- [累积FR S2] 行 CRUD（`PATCH /rows/:id` 走 field_id）/ 乐观锁 409 / JSON 全量导出 / ≤5000 行上限。
- [累积FR S3] 筛排 JSONB + field_id 白名单 / 看板拖卡 / ViewPrefs / 「指派给我」。
- [路级墙] A35 排除清单 `retrieval-exclusions.ts` 含五张物理表名，本刀**关联值存 JSONB 不新建物理表** → 排除清单**无需改动**（附一 concern① 详述）。
- [不传参回归] `GET /tables/:id/rows` 不传参时响应形状（`rows[]` keys 恰 6 个）Sprint B 已锁，本刀读路径**不得改动其形状**。
- context-manifest: unavailable（第三方 repo，`localhost:5221` 累积 FR 端点对路③ 投影为空，据 GP §8 重建，见上）。

---

## 真实调用方请求 shape

本刀无「设备/agent 调服务端」的外部真实调用方。所有端点的调用方是 **Staff Hub 浏览器同源前端**，身份**只来自 better-auth 会话 cookie**（`workbenchAuthGuard` 从 `auth.api.getSession` 解析 org_id，零请求头兜底）。因此认证 shape 逐字为：`Cookie: <better-auth session>`，**无** `X-Tenant-Id`/`body.org_id`/`body.tenant_id` 等任何身份头/体字段（写了即触 A2 静态守卫报红）。DoD 的 [BEHAVIOR] 构造请求一律用夹具签发的真会话 cookie，与该 shape 逐字段一致。规则 A（真实调用方 shape）：本刀调用方即同源前端会话，**N/A 外部 agent shape**。

---

## 禁 mock 边清单

本刀改动涉及「跨模块数据传递」（关联值在 route↔service↔db_rows.data 间接力）+「DB 写路径」（新增 relation 字段类型的 CHECK migration、`db_fields.deleted_at` 软删列、`db_rows.data` 关联值读写）。以下边**禁 mock**，测试必须真 Postgres、真相邻模块：

- `routes/workbench.ts` ↔ `services/workbench-rows.service.ts` / `workbench.service.ts`（本单改了关联字段校验、关联值读写、字段软删、候选/反查两端点，测试必须真调 service，禁 vi.mock/stub）
- 代码 ↔ `zenithjoy.db_rows.data`(JSONB)（本单改写路径：关联值以目标 row_id 数组落 JSONB，测试必须真 Postgres 验数组真落库、真反查）
- 代码 ↔ `zenithjoy.db_fields`（本单新增 relation 类型 + `deleted_at` 软删列，测试必须真查库验行仍在 + deleted_at 置位）
- 代码 ↔ `zenithjoy.db_tables`（A30② 删表/还原触达，测试真软删真还原真查）
- `workbenchAuthGuard` ↔ 关联路由（走真 `/api/staff/feishu-login` 签的真会话 cookie，不伪造 cookie 串）

唯一允许 mock 的边：飞书 OAuth 上游（`FEISHU_API_BASE` 指向本地假上游，属环境端点重定向，被测代码路径一行不变——沿用路①③ 先例）。

---

## 未覆盖真实链路清单

（本合同无第三方 API 依赖、无 force_*、无假数据顶替。所有断言真 Postgres + 真会话 + 真 supertest/curl。**N/A**。）
唯一登记项：A29「点关联项跳目标记录」的**真浏览器点击→跳转**只能在 windows_cloud（GHA windows-latest）真跑，本地不可复现——不属 mock 豁免，属环境路由（见 `## E2E 验收`），判据 = 该 windows job + 本刀 step 的 conclusion + 真取回截图。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 员工在表A建 relation 字段配目标表B → 挑B记录建关联（row_id数组落JSONB）→ 单元格显示目标标题·点击跳转 → 表B记录反向面板列「谁引用我」→ 删B记录引用安全失效 → 跨组织/私有零泄露、反枚举统一404 |
| **NFR（做得多好）** | 非功能 | AG Grid 锁 32.2.1 不升 v33；关联保存/展开失败必须单元格可见提示，禁静默吞异常；候选/反查读端点纯读无写副作用 |
| **Invariant（永不违反）** | 不变量 | ①org_id 只从会话解析零请求头 ②五表 org_id NOT NULL、跨企业不可见不可关联 ③无运行时DDL、关联值存 db_rows.data JSONB 不新建关联表（information_schema 前后全等）④跨企业统一404同文案同形状 ⑤删表/删字段/删行全软删可还原，关联引用不留悬空指针 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方「判定点登记表」 |
| **保质期（何时过期）** | 失效 | relation 字段/关联值随所属表软删+30天回收站过期；无 token 类时效物 |
| **死亡告警（停了谁知道）** | 告警 | 关联端点纳入 `e2e-knowledge-hub-path3.yml` PR 门 + smoke baseline 棘轮，回退即该 workflow 红（PR 阻塞可见） |
| **失败语义（挂了怎么办）** | 故障 | 见下方「失败语义声明」；关联展开/保存失败 = 拦截并单元格可见提示，绝不 fail-open 泄露；删被引用记录 = 安全失效（占位标记）非白屏 |
| **效果确认（已发≠已生效）** | 回执 | 建关联 PATCH 200 后**真查 db_rows.data** 确认数组落库；软删字段 200 后**真查 db_fields.deleted_at** 确认置位且行未物理删 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | API 不稳定 | 静默丢消息 |
| ⚠️ 关联目标是否「本组织可见」 | A. 仅写入时校验目标表 org; B. 写入校验 + 读路径二次校验目标行 org | B. 写入 + 读路径二次校验（候选/展开都重验 org_id） | 单点写入校验挡不住脏数据/直接改库越权（A27②实证） | 泄露对方组织记录标题（直接面客数据泄露，不可逆） |
| ⚠️ 目标记录是否「已失效」（被删） | A. 存 row_id 时不管，跳转时再看; B. 读路径按 deleted_at IS NULL 剔除，候选/反查都不返回已删行 | B. 读路径统一剔除已软删目标 | 存下的 row_id 会悬空，跳转 404 白屏或误导用户 | 悬空引用跳 404 白屏 / 误点已删记录 |
| 跨企业 id 是否「存在」 | A. 存在返资源、不存在返404（可枚举）; B. 一律 notFoundBody 同字节，无 timestamp | B. 统一404同文案同形状，耗时不构成信号 | 可区分响应 = 枚举漏洞（A28实证） | 攻击者枚举出对方表/记录是否存在 |
| relation 值是否「合法结构」 | A. 只查是数组; B. 数组 + 每元素是目标表本组织可见记录 | B. 深校验每个目标 row_id | 只查形状挡不住指向不可见记录 | 关联指向越权记录 |

> 本表 ⚠️ 两条（org 二次校验 / 悬空剔除）误判后果为「直接面客数据泄露」「白屏」级，PrepPRD 与 GP §6 A27/A30 已明确要求 B 方案，**已拍板**，无 judgment-pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 建 relation 字段目标表不可解析 | 400 VALIDATION_FAILED，不写 db_fields | 是（重放同请求同结果） | 前端字段编辑器可见报错 |
| PATCH 关联值含不可见目标记录 | 400 VALIDATION_FAILED，行 version 不变（不留半截） | 是 | 单元格可见报错，不静默吞 |
| 候选/反查跨企业访问 | 404 notFoundBody 同字节 | 是 | 无（拦截，不泄露存在性） |
| 被引用行/表被软删 | 候选/反查按 deleted_at 剔除，单元格占位标记 | 是 | 安全失效非白屏；表还原后引用恢复 |
| 删字段 confirm_name 不符 | 400 CONFIRM_MISMATCH，字段不删 | 是 | 前端二次确认弹窗 |

### 输入对抗面

本刀端点均为**同源认证前端**调用，非对外暴露 agent（无客服 agent / 爬虫 / 外部可写接口）。relation 值经 field_id 白名单 + uuid 校验 + 目标可见性深校验；表名/标题渲染沿用 Sprint A/B 的 XSS 文本节点口径（A18）。**其余 N/A**。

---

## Golden Path

[员工在表A配 relation 字段(目标=表B)] → [挑B记录建关联(row_id数组落 db_rows.data JSONB)] → [单元格显示目标标题·点击跳转表B记录] → [表B记录详情反向面板列「谁引用我」] → [删B记录→表A引用安全失效不悬空] → [删表还原引用恢复 / 删字段软删值保留] → [跨组织·私有零泄露·反枚举统一404] → [information_schema 前后全等(relation不进标识符位)] → [路③ relation E2E 接进 path3 workflow 全绿]

### Step 1: 员工在表A新增 relation 字段，配置目标表=表B（跨企业目标被拒）
**来源**: `[FROM_PRD]` — PRD「Golden Path」步骤1 + GP §6 A27①（写入时目标表 org≠本组织 → 拒）

**可观测行为**: `POST /tables/A/fields` 带 `{field_type:"relation", options:[B]}` → 201，字段 `field_type` 逐字 `relation`、`options[0]` 逐字 = B；目标表跨企业（carol 的表）→ 400，不 2xx。

**验证命令**:
```bash
# 真跑本刀 vitest（真 PG）：relations-field-and-build.test.ts 前两条 + 跨企业拒
PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo "FAIL: 缺 PG"; exit 1; }
(cd apps/api && npx vitest run --config vitest.workbench-relations.config.ts \
  ../../sprints/08220300-workbench-sprintD-relations/tests/relations-field-and-build.test.ts --reporter=dot) || exit 1
```
**硬阈值**: 该 suite 全绿；relation 字段 201、options[0]==B、跨企业 400。

---

### Step 2: 挑表B记录建关联 —— 目标 row_id 数组落 db_rows.data JSONB
**来源**: `[FROM_PRD]` — PRD 步骤2「勾选若干条 → 保存（目标 row_id 数组存进 db_rows.data JSONB，不新建表）」

**可观测行为**: `PATCH /rows/:aRow {data:{<relField>:[b1,b2]}}` → 200；真查 `db_rows.data->'<relField>'` = `["b1","b2"]` JSON 数组。

**验证命令**:
```bash
(cd apps/api && npx vitest run --config vitest.workbench-relations.config.ts \
  ../../sprints/08220300-workbench-sprintD-relations/tests/relations-field-and-build.test.ts -t "建关联" --reporter=dot) || exit 1
```
**硬阈值**: 关联值以数组落 db_rows.data，读回逐字相等。

---

### Step 3: 单元格候选 + 双向可见（A关联B → B侧反查看得到）+ A29② 私有反向零泄露
**来源**: `[FROM_PRD]` — PRD 步骤2 行选择器 + 步骤4 反向引用面板；GP §6 A29①②

**可观测行为**: `GET /tables/A/fields/:rel/relation-candidates` → 200，`data` keys 恰 `[candidates,field_id,target_table_id]`，候选列出 B 表记录带 title；`GET /rows/:b1/backrefs` → 200，`data` keys 恰 `[backrefs,row_id]`，列出 A 表名+A 行标题+field_id。两端点禁用字段名零命中。**A29②「仅自己」表反向面板仅表主可见（判定口径写死）**：backref 来源表 `visibility='private'` 且 `owner_member_id ≠ 请求会话 memberId` → 从反向面板**剔除**（他人零泄露，连私有表名/行标题都不出现）；表主本人不剔除。变异 `A29-backref-private-leak`（去掉该过滤）proven-to-fire。

**验证命令**:
```bash
(cd apps/api && npx vitest run --config vitest.workbench-relations.config.ts \
  ../../sprints/08220300-workbench-sprintD-relations/tests/relations-bidirectional.test.ts --reporter=dot) || exit 1
```
**硬阈值**: 候选/反查双向命中；envelope+item keys 完整性卡通过；禁用字段名反向断言通过。

---

### Step 4: 点关联项跳转目标记录（windows 真浏览器）
**来源**: `[FROM_PRD]` — PRD 步骤3「点关联项 → 跳转到表B对应记录」；GP §6 A29/A32（windows_cloud UI 死规则）

**可观测行为**: 真浏览器建 relation 字段→挑记录→单元格显示目标标题→点击→跳转到表B该记录详情（`WorkbenchRowDetailPanel` 可见）；反向面板列出引用来源。

**验证命令**:
```bash
# 见 ## E2E 验收：判据 = e2e-knowledge-hub-path3.yml 的 windows job + 本刀 relation step conclusion==success + 真取回截图
echo "windows_cloud E2E，见 ## E2E 验收 段"
```
**硬阈值**: windows job success；本刀 `@relation-*` step success；截图 ≥3 张非空。

---

### Step 5: 删被引用行 → 关联侧安全失效，不留悬空 row_id
**来源**: `[FROM_PRD]` — PRD 步骤5 + GP §6 A30①（删被引用行 → 引用置空+单元格可见标记）

**可观测行为**: 软删表B某被引用行 → `relation-candidates` 不再返回该行、`backrefs` 不再暴露它；来源行读取不 5xx、不白屏；库里来源行关联值仍是合法数组结构。

**验证命令**:
```bash
(cd apps/api && npx vitest run --config vitest.workbench-relations.config.ts \
  ../../sprints/08220300-workbench-sprintD-relations/tests/relations-integrity.test.ts -t "A30①" --reporter=dot) || exit 1
```
**硬阈值**: 已删目标从候选/反查剔除；来源读路径安全（200/404，非 5xx）。

---

### Step 6: 删表还原引用恢复 / 删字段软删值保留
**来源**: `[FROM_PRD]` — PRD 步骤5 + GP §6 A30②③（删表随回收站还原；删字段软删+值保留+二次确认）

**可观测行为**: 软删表B → `relation-candidates` 404；还原表B → 候选恢复且含被引用行。删 relation 字段 confirm_name 不符 → 400 字段不删；相符 → 200 软删（`db_fields` 行仍在 + `deleted_at` 置位 + `db_rows.data` 旧值保留）。

**验证命令**:
```bash
(cd apps/api && npx vitest run --config vitest.workbench-relations.config.ts \
  ../../sprints/08220300-workbench-sprintD-relations/tests/relations-integrity.test.ts -t "A30" --reporter=dot) || exit 1
```
**硬阈值**: 删表候选404→还原后恢复；删字段软删行仍在 deleted_at 置位、值保留、confirm 不符拒。

---

### Step 7: 组织隔离三向 + 反枚举 + 仅自己零泄露
**来源**: `[FROM_PRD]` — PRD「边界情况」+ GP §6 A27②/A28/A31

**可观测行为**: ①carol(B企业)以 A 真实表 id 与随机 id 各调候选端点多次，两组状态码全404、响应体逐字节相同、无 timestamp（A28，404优先于400）；②篡改目标行 org 为他企业后展开候选 → 该行被剔除（A27② 读路径二次校验）；③bob 对 alice 私有表建关联被拒（A31①）；④导出含 relation 的表 → 含目标 row_id 占位但 grep 不到目标行标题（A31②）。

**验证命令**:
```bash
(cd apps/api && npx vitest run --config vitest.workbench-relations.config.ts \
  ../../sprints/08220300-workbench-sprintD-relations/tests/relations-isolation-enum.test.ts --reporter=dot) || exit 1
```
**硬阈值**: 反枚举逐字节相同；读路径二次校验剔除越权行；私有表建关联拒；导出不内联对方标题。

---

### Step 8: information_schema 前后全等（relation 不进标识符位）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入。理由：GP Invariant「无运行时DDL + 不新建关联表」需要可机检守卫；防 generator 用「每关联建表/建列」实现导致标识符注入面。这是 concern② 的证据化断言。

**可观测行为**: 建 relation 字段 + 建关联 + 反查全程，`zenithjoy` schema 的 `information_schema.tables` + `.columns` 集合逐字节不变；且零 `%relation%` 命名的物理表。

**验证命令**:
```bash
(cd apps/api && npx vitest run --config vitest.workbench-relations.config.ts \
  ../../sprints/08220300-workbench-sprintD-relations/tests/relations-field-and-build.test.ts -t "DDL" --reporter=dot) || exit 1
# 静态兜底：全仓源码零 db_relations 之类关联物理表建表 SQL
! grep -rIn "CREATE TABLE.*relation" apps/api/db/migrations/ 2>/dev/null | grep -vi "exclusion" || { echo "FAIL: 出现 relation 物理表 migration"; exit 1; }
echo OK
```
**硬阈值**: information_schema 前后全等；零 relation 物理表。

---

### Step 9: 路③ relation E2E 接进既有 path3 workflow（不重造）
**来源**: `[FROM_PRD]` — PRD 范围「路③ relation E2E spec 接入既有 e2e-knowledge-hub-path3.yml」+ GP §8 Sprint D「接线三件套」（本刀只**接入**不重造，见附一 concern①）

**可观测行为**: `structured-workbench-relations.spec.ts` 进 `e2e-knowledge-hub-path3.yml` 的 `paths` + windows job 有真调该 spec 的 `@relation-*` step（且 windows job **仍无 job 级事件条件门**，A33(c) 不被破坏）；linux job 含 `npm run test:workbench-relations`；smoke 新增 relation 段进 baseline 棘轮。

**验证命令**:
```bash
WF=.github/workflows/e2e-knowledge-hub-path3.yml
grep -q "structured-workbench-relations.spec.ts" "$WF" || { echo "FAIL: spec 未进 workflow paths"; exit 1; }
grep -q "e2e-relations-run.ps1" "$WF" || { echo "FAIL: windows job 无 relation step"; exit 1; }
grep -q "test:workbench-relations" "$WF" || { echo "FAIL: linux job 未跑 relation vitest"; exit 1; }
# windows job 仍无 job 级事件条件门（A33(c) 不回退）：解析 windows job 顶层无 if 含 workflow_dispatch
node -e '
const y=require("fs").readFileSync(process.argv[1],"utf8");
const m=y.match(/windows-real-browser:[\s\S]*?(?=\n  [a-z]|\n[a-z]|$)/);
if(!m){console.error("FAIL: 找不到 windows job");process.exit(1)}
const head=m[0].split("\n").filter(l=>/^    [a-z_]+:/.test(l)).join("\n");
if(/if:.*(workflow_dispatch|github\.event_name)/.test(head)){console.error("FAIL: windows job 加了事件条件门(A33c 回退)");process.exit(1)}
console.log("OK: windows job 无 job 级事件门")' "$WF" || exit 1
echo OK
```
**硬阈值**: 三件套接线逐字在案；A33(c) windows job 无事件门不回退。

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud
**接线**：**不新建 workflow**（A33 的独立 workflow `e2e-knowledge-hub-path3.yml` 已在 base，concern① 明令不重造）。沿用它 —— linux job 增 `test:workbench-relations` + 本刀 relation smoke 段 flag；windows job（**A33(c)：不许加 job 级 if**）增调 `sprints/08220300-workbench-sprintD-relations/e2e-relations-run.ps1` 的 step + 本刀截图 upload step；workflow `paths` 增本刀 spec 与 sprint 目录。

> 下面 bash 块是 **evaluator 模式B 的 final-e2e**：真浏览器跑在 GitHub Actions windows-latest 上（ZenithJoy UI 死规则），本地无从复现，判据 = **那个 windows job 的 conclusion + 本刀 relation step 的 conclusion + 从 artifact 真取回本轮截图**（不认宿主机手工塞的图）。PowerShell/Playwright 交付物规格见其后非 bash 代码块。

```bash
#!/bin/bash
set -uo pipefail
WF=e2e-knowledge-hub-path3.yml
B=$(git rev-parse --abbrev-ref HEAD)

R=$(gh run list --workflow "$WF" --branch "$B" --limit 1 --json databaseId,headSha,conclusion,url) \
  || { echo "FAIL: gh run list 失败"; exit 1; }
echo "$R" | jq -e 'length > 0' >/dev/null \
  || { echo "FAIL: 分支 $B 上无 $WF 运行记录 —— 本刀 spec 成了孤儿"; exit 1; }
ID=$(echo "$R" | jq -r '.[0].databaseId')
echo "run=$(echo "$R" | jq -r '.[0].url')"

# 0. 钉 SHA：拿到的必须是本轮 HEAD 的那个 run，否则上一次 push 的绿 run 会冒充本轮
[ "$(echo "$R" | jq -r '.[0].headSha')" = "$(git rev-parse HEAD)" ] \
  || { echo "FAIL: 陈旧 run（headSha != HEAD）"; exit 1; }

J=$(gh run view "$ID" --json jobs)

# 1. windows job 必须 success（skipped/cancelled 一律 FAIL —— 那正是 A33(c) 要堵的孤儿形态）
echo "$J" | jq -e '[.jobs[] | select(.name | test("windows")) | select(.conclusion == "success")] | length > 0' >/dev/null \
  || { echo "FAIL: windows job 未成功"; echo "$J" | jq -r '.jobs[] | "  job=\(.name) conclusion=\(.conclusion)"'; exit 1; }

# 2. 本刀 relation 真浏览器 step success（job 绿但本刀 step 没跑 = 假绿）
echo "$J" | jq -e '[.jobs[] | select(.name | test("windows")) | .steps[] | select(.name | test("关联|relation")) | select(.conclusion == "success")] | length > 0' >/dev/null \
  || { echo "FAIL: windows job 里没有跑本刀 relation 那一段"; echo "$J" | jq -r '[.jobs[] | select(.name | test("windows")) | .steps[].name] | @csv'; exit 1; }

# 3. linux job 必须 success（关联真 PG 段 + relation vitest + smoke 段在那里）
echo "$J" | jq -e '[.jobs[] | select(.name | test("linux")) | select(.conclusion == "success")] | length > 0' >/dev/null \
  || { echo "FAIL: linux job 未成功"; exit 1; }

# 4. 截图从 artifact 真取回（≥3 张、全部非空），落进 sprint 目录
D=$(mktemp -d)
gh run download "$ID" -n path3-relations-screenshots -D "$D" \
  || { echo "FAIL: 下不到本刀截图 artifact path3-relations-screenshots"; exit 1; }
N=$(find "$D" -name '*.png' | wc -l | tr -d ' ')
[ "$N" -ge 3 ] || { echo "FAIL: artifact 里只有 $N 张截图（需 >=3）"; exit 1; }
for f in $(find "$D" -name '*.png'); do [ -s "$f" ] || { echo "FAIL: 空截图 $f"; exit 1; }; done
DST=sprints/08220300-workbench-sprintD-relations/screenshots
mkdir -p "$DST"
find "$D" -name '*.png' -exec cp {} "$DST"/ \;
echo "OK: S4 关联 Golden Path 真浏览器全链通过，截图 $N 张已落 $DST"
```

### 交付物规格 A：`sprints/08220300-workbench-sprintD-relations/e2e-relations-run.ps1`

沿用 Sprint B 的 `e2e-rows-lib.ps1`（`Set-DbEnvFromUrl` / `New-TwoTenantSeed` / `Start-Api` / `Get-SessionCookie` / `Start-Hub` / `Stop-Procs` / `Invoke-Checked`），一行不抄、直接 dot-source。见本 sprint 目录同名文件（proposer 已产出骨架，generator 按 spec 落 `@relation-*` 用例调用）。要点：起真 apps/api + 真 Postgres（禁 stub），spec 禁 `page.route()`/请求拦截；`$Grep` 传 ASCII 标签（`@relation-build` / `@relation-jump` / `@relation-backref`）；产出截图晚于脚本启动（防历史产物冒充）。

### 交付物规格 B：`apps/staff-hub/e2e/structured-workbench-relations.spec.ts`（generator 写）

变体C 死规则：零 `page.route()`、全打真 apps/api + 真 PG；双企业种子由 ps1 runner 注入 cookie；ASCII 标签。至少覆盖：
- `@relation-build`：建 relation 字段配目标表 → 挑记录建关联 → 单元格显示目标标题（`toBeVisible`+`toHaveText`）
- `@relation-jump`：点单元格关联项 → 跳转到目标表该记录详情面板（`toBeVisible`）
- `@relation-backref`：打开被引用记录详情 → 反向面板列出引用来源（表名+行标题 `toHaveText`）
每关键态截图落 `sprints/08220300-workbench-sprintD-relations/screenshots/`。

### 交付物规格 C：`structured-workbench-smoke.sh` relation 段 + 变异开关（generator 加）

在既有 smoke 上**增量**加（不改既有段）：`--a27-only` / `--a28-only` / `--a29-backref-only` / `--a30-row-only` / `--a30-table-only` / `--a30-field-only` / `--a31-only` **7 段**（真 apps/api + 真 PG 双企业夹具），并在 `mutation_list()` 追加 **7 个**变异开关：
- `A27-rel-org-bypass`（去掉关联目标 org 校验 → 跨企业/私有可关联 → `--a27-only` 段红）
- `A30R-rel-dangling-leak`（去掉关联读路径**行**维 `deleted_at IS NULL` 剔除 → 已删目标行回魂进候选/反查 → `--a30-row-only` 段红）
- `A30T-table-hard-delete`（把**删表**软删改物理 DELETE → 目标表软删后候选不返 404 / 还原拿不回 → `--a30-table-only` 段红；补齐 GP §6 A30② 删表维变异，与 A30F 字段维成对）
- `A28-rel-enum-leak`（让候选端点对真实存在 vs 随机 id 返回不同响应 → `--a28-only` 段红）
- `A31-rel-private-leak`（去掉**写入侧**私有表 relation 目标可见性校验 → bob 可指 alice 私有表 → `--a31-only` 段红）
- `A29-backref-private-leak`（去掉 backref **读路径**「来源表 private 且非表主则剔除」过滤 → bob 从 X 反向面板看到 alice 私有来源 → `--a29-backref-only` 段红）
- `A30F-field-hard-delete`（把字段软删改物理 DELETE → `--a30-field-only` 段红：db_fields 行消失）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 关联字段配置+建关联落JSONB+零DDL | `tests/relations-field-and-build.test.ts` | `field_type 逐字为 relation`、`建关联`、`A27①`、`DDL`、`relation 命名的表` | relation 类型未登记/端点缺 → red |
| 双向可见+候选+反查+schema | `tests/relations-bidirectional.test.ts` | `行选择器候选`、`候选记录 keys`、`双向可见`、`反向引用 keys`、`未被引用` | 候选/backrefs 端点 404 → red |
| 组织隔离+反枚举+仅自己零泄露 | `tests/relations-isolation-enum.test.ts` | `反枚举`、`A27②`、`A31①`、`A31②` | 端点缺/隔离未成 → red |
| 引用完整性三级 A30 | `tests/relations-integrity.test.ts` | `A30①`、`A30②`、`A30③` | deleted_at 列缺/字段软删端点缺 → red |

---

## 附一：controller 两条 concern 落实

**concern① 范围=A27–A31 delta + 接入既有路级件，不重造 A33/A35/A32/A34**：
- 探查实证（base `cp-08220300-workbench-relations` @ Sprint A/B/C 已合并）：`e2e-knowledge-hub-path3.yml`（A33 独立 workflow，`on: pull_request` + windows job 无 job 级 if）**已存在**；`apps/api/src/knowledge/retrieval-exclusions.ts`（A35 排除清单，含五张物理表名）**已存在**；`workbench.ts` 路由族（`/api/knowledge/db`）+ `workbench-auth.ts` 鉴权闸（A32/A34）**已存在**。
- 本刀**不重造**这四件：只把 relation **接入** —— workflow `paths` 加本刀 spec/sprint 目录、windows job 加 relation step、linux job 加 `test:workbench-relations` + relation smoke 段、smoke baseline 棘轮加本刀段。合同门禁断言只覆盖 A27–A31（relation 功能）+ Step 9 接入验证，**对齐 GP §8 不放大**。
- A35 排除清单**无需改**：本刀关联值存 `db_rows.data` JSONB、目标配置存 `db_fields.options`，**零新增物理表**，五张表名清单不变（Step 8 information_schema 前后全等即证据）。

**concern② 关联存 db_rows.data JSONB，不建新关联表；反向引用用 JSONB 反查**：
- 关联值 = 目标 row_id 数组，落 `db_rows.data->'<relFieldId>'`（Step 2 真查库证据）；目标表配置 = `db_fields.options[0]`（既有 JSONB 列，零新列用于配置）。
- 反向引用（谁引用了我）= **JSONB 反查**：`SELECT ... FROM db_rows r JOIN db_fields f ON f.field_type='relation' AND f.options->>0 = <viewedRowTable> WHERE r.data->f.id @> to_jsonb(<viewedRowId>)::text[]...`（generator 落具体 SQL，同组织 + 排除软删/私有非表主）。
- **反向索引表裁量结论：不建**。理由：路③ 单表 ≤5000 行（S2 上限），组织级 relation 反查数据量在 JSONB `@>` + org_id 索引下足够；建反向索引表会新增 SQL 注入面 + 破坏「零新建关联表」不变式（与前三刀一致），违反 concern② 优先 JSONB 的指示。若未来行数级别上量，另立后刀加物化视图，不在本刀范围。
- 唯一 schema 变更 = 新 migration 加 `relation` 进 `db_fields` CHECK + 加 `db_fields.deleted_at` 软删列（A30③ 需要），二者均 migrate 时落地、非运行时 DDL，Step 8 的 information_schema「运行时前后全等」断言不受影响。
