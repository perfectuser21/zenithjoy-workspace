# Sprint Contract Draft (Round 2) — 路③ Sprint E · S4 加厚 rollup/lookup 聚合

> **Round 2 修订（唯一变更）**：回应 Reviewer P1（verification_oracle_completeness）——`/rollups` 端点声明了 404 反枚举三性质却零可执行断言（declared-but-not-codified oracle 缺口 + error-path BEHAVIOR 类别缺失）。本轮补：`tests/rollup-isolation.test.ts` 增反枚举用例（carol 请求 A 表/随机 id 各调 `/rollups` → 两组 404 逐字节相同 + 无 timestamp，沿 Sprint D `relations-isolation-enum.test.ts` 口径）+ contract-dod.md 增一条对应 [BEHAVIOR]。其余七个对抗面 Reviewer 已核过，**一字不动，不放大**。


**Sprint**: 08222228-workbench-rollup-sprintE
**journey_type**: user_facing
**target_environment**: windows_cloud
**上位 GP**: line11 员工知识中枢 / 路③ 结构化工作台（`c86e37ff-3307-4b1a-80d9-3b00b8450554`）
**门禁断言（本刀 delta）**: A37–A41（rollup/lookup 聚合，逐字取已 APPROVED 提案 v5）+ 把 rollup 接入既有路级件（path3 workflow / vitest / smoke baseline）

> **承接已 APPROVED 提案 v5**（`sprints/08200910-knowledge-hub-path3-proposal/proposal-v5.md`）：A37–A41 断言语义逐字落进本合同，不改语义。**不重造** A33 workflow / A35 排除清单 / A32/A34 路由族+鉴权闸 / Sprint D relation 解析链（均在 base）。rollup 采**读时计算不落库**、配置存 `db_fields.options`、**零新建物理表**。

---

## GP-Anchor

GP-Anchor: line11/structured_workbench#step4

---

## Response Schema（推导来源: PRD 字面 + api_registry 同族既有端点推导 + Sprint D 口径）

本刀新增 **1 个只读端点**（rollup 聚合值读端点），并**扩展**既有 `POST /tables/:id/fields`（字段类型加 `rollup`/`lookup` + 类型×函数校验）。**不新增** rollup 配置候选端点：配置器列「本表 relation 字段」「目标表字段」全部复用既有 `GET /tables/:id/fields`（客户端按 `field_type=='relation'` 过滤本表字段；目标字段读 `GET /tables/<relation.options[0]>/fields`）——scope 收敛，PRD「预期受影响文件」未列新候选端点。

### Endpoint 1（新增）: GET /api/knowledge/db/tables/:tableId/rollups

一次性返回该表**每条存活源行 × 每个 rollup/lookup 字段**的聚合值（读时计算不落库）。

**Success (HTTP 200)**:
```json
{"success": true, "data": {"table_id": "<uuid>", "cells": [{"row_id": "<uuid>", "field_id": "<uuid>", "fn": "<string>", "value": <number|string|null>, "degraded": <bool>}]}}
```
- `data` keys **恰好**（排序后）`["cells","table_id"]`
- `table_id` (string uuid, 必填): 被读表 id
- `cells` (array, 必填): 每项 keys **恰好**（排序后）`["degraded","field_id","fn","row_id","value"]`
  - `row_id` (string uuid): 源表存活行（同族 `RowOut.row_id` 口径）
  - `field_id` (string uuid): 该 rollup/lookup 字段 id
  - `fn` (string): 聚合函数，取值域**恰好** `count|sum|min|max|concat|lookup`（lookup 字段的 fn 逐字为 `lookup`）
  - `value` (number|string|null): count/sum/min/max → number；concat/lookup → string；**降级 → null**
  - `degraded` (bool): 失效降级标记（true = 依赖失效/含非数值跳过，单元格渲染可见降级占位）

**禁用字段名（envelope 层）**: `rows` / `items` / `results` / `records` / `list` / `rollups` / `data`(嵌套)
**禁用字段名（cell 层）**: `id` / `name` / `title` / `label` / `text` / `display` / `aggregate` / `function` / `result` / `cell`

**Error (HTTP 404，源表跨企业/私有非表主/随机不存在/已软删一律走此)**:
```json
{"success": false, "data": null, "error": {"code": "NOT_FOUND", "message": "表不存在或无权访问"}}
```
- **无 `timestamp`**（`notFoundBody()` 常量，反枚举同 Sprint D relation-candidates 口径）
- **404 优先于 400**：源表解析不到先返 404

### Endpoint 2（复用扩展，无新响应形状）: POST /api/knowledge/db/tables/:id/fields

字段类型集合扩到十一类（八类 + relation + **rollup + lookup**）。body `fields[]` 项：
- **rollup**: `{name, field_type:"rollup", options:[<relationFieldId>, <targetFieldId>, <fn>], display_order}`，`fn ∈ {count,sum,min,max,concat}`；**count** 不需目标字段（`targetFieldId` 传空串 `""`）。
- **lookup**: `{name, field_type:"lookup", options:[<relationFieldId>, <targetFieldId>], display_order}`（fn 隐含为 `lookup`）。
- 合法 → `201`；`FieldOut.options` 逐字回读 = 配置三元组（J14）。
- **配置不可解析 / 类型×函数非法** → `400 VALIDATION_FAILED`（`workbenchErrorBody`，带 timestamp）+ 明确文案，**非静默返错值/NaN**：
  - `relationFieldId` 不是本表存活 relation 字段 → 400
  - `fn` 不在 `{count,sum,min,max,concat}` 内 → 400
  - `sum/min/max` 的 `targetFieldId` 目标字段类型 ≠ `number` → 400（文案含「聚合函数与字段类型不匹配」意）
  - `concat/lookup` 允许任意目标字段类型

### 复用端点（无形状变化，仅读路径挂降级）

- `GET /tables/:id/fields`：新增 rollup/lookup 字段照既有 `FieldOut` 形状回读（`options` 承载三元组）。
- `DELETE /tables/:id/fields/:fieldId`（Sprint D 已在）：删 relation 字段/目标字段触发 rollup 降级（A39①②，读路径体现）。
- `DELETE /tables/:id`（Sprint A 已在）：软删目标表触发 rollup 降级（A39③）。

---

## 已知约束（来自回归测试 + 累积 FR）

来自 base（Sprint A/B/C/D）回归测试与 GP §8 累积 FR，本刀**不得回退**：

- [`_workbench-fixture.ts`] 双企业种子恒定两家企业 + 三身份（alice 表主 / bob 同组织他人 / carol 他企业）；`license_key` NOT NULL+UNIQUE 必须给。
- [`_relations-fixture.ts`] Sprint D relation 解析链（relationCandidates 四环 + backrefs JSONB 反查 + org 二次校验 `WHERE r.org_id=$orgId`）本刀直接复用，rollup 聚合基数沿用同一条 org 过滤。
- [`structured-workbench-smoke.sh`] 七个禁用身份头字面量（`X-Tenant-Id`/`X-User-Email`/`X-Feishu-User-Id`/`X-Bypass-Tenant`/`tenantContextOptional`/`selfHealOwnerMember`/`staffGuard`）在路③源码零命中（A2）；A2 扫描域自动纳入本刀新增 `workbench-rollup.service.ts`。
- [累积FR S1-S4] 建表/字段/软删回收站/行 CRUD/乐观锁/筛排看板/relation 关联+反查+组织隔离三向，已验收，本刀不回退。
- [路级墙] A35 排除清单 `retrieval-exclusions.ts` 含五张物理表名；本刀 rollup 读时计算不落库、**零新增物理表** → 排除清单**无需改动**（无运行时 DDL 断言即证据）。
- [不传参回归] `GET /tables/:id/rows` 响应形状 Sprint B 已锁；本刀**不改行读端点**，rollup 值走独立 `/rollups` 端点（不污染行读形状，见 §Response Schema 选型理由）。
- [累积FR] context-manifest: unavailable（第三方 repo，`localhost:5221` 累积 FR 端点对路③投影为空，据 GP §8 + 提案 v5 重建，见上）。

---

## 真实调用方请求 shape

本刀无「设备/agent 调服务端」的外部真实调用方。所有端点的调用方是 **Staff Hub 浏览器同源前端**，身份**只来自 better-auth 会话 cookie**（`workbenchAuthGuard` 从 `auth.api.getSession` 解析 org_id，零请求头）。认证 shape 逐字为 `Cookie: <better-auth session>`，**无** `X-Tenant-Id`/`body.org_id`/`body.tenant_id` 等任何身份头/体字段（写了即触 A2 静态守卫报红）。DoD 的 [BEHAVIOR] 构造请求一律用夹具签发的真会话 cookie。规则 A（真实调用方 shape）：**N/A 外部 agent shape**。

---

## 禁 mock 边清单

本刀改动涉及「跨模块数据传递」（聚合值在 route↔rollup service↔db_rows.data 间接力）+「DB 写路径」（rollup/lookup 字段类型 CHECK 扩容 migration、rollup 配置以三元组写 `db_fields.options`）。以下边**禁 mock**，测试必须真 Postgres、真相邻模块：

- `routes/workbench.ts` ↔ `services/workbench-rollup.service.ts` / `workbench.service.ts`（本单改了 rollup/lookup 字段类型×函数校验、rollups 聚合读端点，测试必须真调 service，禁 vi.mock/stub）
- 代码 ↔ `zenithjoy.db_rows.data`(JSONB)（本单读路径：顺 relation 目标 row_ids 去目标表捞值聚合、含 string 数字 `Number()` 规整，测试必须真 Postgres 读真值）
- 代码 ↔ `zenithjoy.db_fields`（本单新增 rollup/lookup 类型 + 配置存 options，测试必须真查库验 options 落库；relation 字段/目标字段软删触发降级须真软删真查）
- 代码 ↔ `zenithjoy.db_tables`（A39③ 软删目标表 → getTable 返 null → 降级，真软删真查）
- `workbenchAuthGuard` ↔ rollups 路由（走真会话 cookie，不伪造 cookie 串）

唯一允许 mock 的边：飞书 OAuth 上游（`FEISHU_API_BASE` 指向本地假上游，属环境端点重定向，被测代码路径一行不变——沿用路①③④先例）。

---

## 未覆盖真实链路清单

（本合同无第三方 API 依赖、无 force_*、无假数据顶替。所有断言真 Postgres + 真会话 + 真 supertest/curl。**N/A**。）
唯一登记项：A37/lookup「单元格看到聚合值」的**真浏览器渲染**只能在 windows_cloud（GHA windows-latest）真跑，本地不可复现——不属 mock 豁免，属环境路由（见 `## E2E 验收`），判据 = 该 windows job + 本刀 rollup step 的 conclusion + 真取回截图。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 员工给 relation 字段配 rollup 汇总字段（选本表 relation 字段 + 目标字段 + 聚合函数 count/sum/min/max/concat）或 lookup 字段（取关联行某字段展示）→ 单元格只读显示读时聚合值 → sum/min/max 前 Number() 规整（string 数字计入）→ concat/lookup 多值 row_order 升序 `, ` 拼接 → 聚合基数只含本 org 存活目标行 → relation 字段/目标字段/目标表失效则单元格降级占位 → 建字段时类型×函数校验非法 400 |
| **NFR（做得多好）** | 非功能 | 读时计算无缓存，工作台单表 ≤5000 行 N+1 读可接受（J13）；AG Grid 锁 32.2.1；聚合/降级失败必须单元格可见提示，禁静默吞异常；类型×函数非法 400 明确文案非静默 NaN |
| **Invariant（永不违反）** | 不变量 | ①org_id 只从会话解析零请求头，聚合基数 org 判定同源 ②聚合基数只含本 org 存活目标行，库里越权脏行不进聚合 ③无运行时 DDL、读时计算不落库、配置存 options、零新建表（information_schema 前后全等）④跨企业统一 404 同文案同形状 ⑤删 relation 字段/目标字段/软删目标表 → rollup 安全降级不留悬空指针 ⑥database 表内容不进路①问答检索域，rollup 富数据同口径挡外，读服务钉死路径不被 knowledge 检索特征文件 import |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方「判定点登记表」（J13-J15） |
| **保质期（何时过期）** | 失效 | rollup/lookup 字段随所属表软删+30 天回收站过期；rollup 值读时计算无物化物、无 token 类时效物 |
| **死亡告警（停了谁知道）** | 告警 | rollup 端点纳入 `e2e-knowledge-hub-path3.yml` PR 门 + smoke baseline 棘轮，回退即该 workflow 红（PR 阻塞可见） |
| **失败语义（挂了怎么办）** | 故障 | 见下方「失败语义声明」；聚合依赖失效 = 单元格 null+degraded 可见占位（拦截，绝不悬空/白屏/5xx）；类型×函数非法 = 建字段 400 拒绝 |
| **效果确认（已发≠已生效）** | 回执 | 建 rollup 字段 201 后**真查 db_fields.options** 确认三元组落库；读 rollup 值后**与手算期望逐一相等**（含 string "12" 计入 sum、abc 跳过 degraded） |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | API 不稳定 | 静默丢消息 |
| **J13** rollup 值读时计算 vs 落库缓存 | A. 读时计算（每次读顺 relation 现查目标行聚合）; B. 落库缓存（物化+触发器级联重算） | A. 读时计算 | 零一致性维护（子记录一改下次读即最新）+ 守零运行时 DDL/零新建表 + 单表 ≤5000 行 N+1 可接受 | 选 B：目标行改值后 rollup 未重算 → 员工看过期汇总数字做决策；级联重算引入 GP 明令禁止的触发器/job 复杂度 |
| **J14** rollup 配置存储形态 | A. `db_fields.options` 位序三元组 `[relation_field_id, target_field_id, aggregate_fn]`; B. options schema 放宽为带 key 对象; C. 新建 rollup_config 表 | A. 位序三元组 string[] | 既有 `normalizeFields` 对 options 元素做 `String()` 强制转换，对象 schema 会被压成 `"[object Object]"` 破坏——位序 string[] 是零改动唯一适配；复用现有 JSONB 列守零新表；relation 已用 `options[0]` 有先例 | 选 C 违反零新表不变式；位序不写清 → 解析歧义（哪位是目标字段） |
| ⚠️ **J15** lookup/concat 多值展示（一个 relation 可指向多行） | A. 只取第一行; B. 多值按 row_order 升序 `, ` 分隔拼接、非文本先格式化 | B. row_order 升序 `, ` 拼接不截断；date=`YYYY-MM-DD`、number=`String()`、person=显示名、single/multi_select=选项标签 | 关联本就是多值数组，只取第一行让员工以为看到全部实际漏数据；分隔符/类型格式化不钉死则各实现行为不一 | 选 A：员工看到「负责人=张三」实际还有李四王五，据此派工出错 |

> ⚠️ J15 误判后果为「据错数据派工」级；提案 v5 已钉死 B 方案分隔符与格式化口径，**已拍板**，无 judgment-pending-user。J13/J14 提案 v5 已给 REC，无接缝不可逆面。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 建 rollup 字段类型×函数非法（sum 配 text） | 400 VALIDATION_FAILED，不写 db_fields | 是（重放同请求同结果） | 前端字段编辑器可见报错，非静默 NaN |
| rollup 依赖 relation 字段/目标字段被删 | 读 rollup 值置 null + degraded=true，单元格可见降级占位 | 是（读时计算，纯读） | 安全降级非白屏；还原字段后自动恢复 |
| rollup 目标表被软删 | 同上降级（getTable 返 null） | 是 | 还原表后自动恢复 |
| 目标行金额以非数值 string 存（如 abc） | 该行跳过聚合 + degraded=true，绝不字符串拼接冒充 sum | 是 | 其余数值行照常聚合 |
| rollups 端点跨企业访问 | 404 notFoundBody 同字节 | 是 | 无（拦截，不泄露存在性） |

### 输入对抗面

本刀端点均为**同源认证前端**调用，非对外暴露 agent。rollup 配置经 field_id/uuid 校验 + 目标可见性校验 + fn 白名单；聚合值来自 db_rows.data 已存值，rollup 字段只读不接受用户写值（读时计算）；表名/标题渲染沿用 Sprint A/B 的 XSS 文本节点口径。**其余 N/A**。

---

## Golden Path

[员工给某 relation 字段配 rollup 汇总字段(选目标字段+聚合函数)或 lookup 字段] → [建字段时类型×函数校验：sum/min/max 只允 number，非法 400] → [打开表格 rollup 单元格顺 relation 目标 row_ids 读时聚合并只读展示] → [count/sum/min/max/concat/lookup 各函数值与手算相等，string 数字规整计入 sum、多值 row_order 升序拼接] → [聚合基数只含本 org 存活目标行，越权脏行不进聚合] → [relation 字段/目标字段/目标表失效 → 单元格 null+degraded 可见占位不悬空] → [读时计算不落库·零新建表·information_schema 前后全等] → [墙裁定：rollup 读服务钉死路径不被 knowledge 检索特征文件 import] → [rollup E2E 接进既有 path3 workflow 全绿]

### Step 1: 建 rollup/lookup 字段 + 类型×函数校验（A40）
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤1-2 + 提案 v5 A40（sum/min/max 只允 number，非法组合 400+文案，非静默 NaN）

**可观测行为**: `POST /tables/:id/fields` 带 rollup 配置三元组 → 合法 201、`options` 逐字回读；`sum/min/max` 配 text 目标字段 → 400 VALIDATION_FAILED + 明确文案（非 2xx、非静默错值）；非法 fn（avg）→ 400；relation_field_id 非本表 relation 字段 → 400；count 无需目标字段可建；concat/lookup 配任意类型可建。

**验证命令**:
```bash
PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo "FAIL: 缺 PG"; exit 1; }
(cd apps/api && npx vitest run --config vitest.workbench-rollup.config.ts \
  ../../sprints/08222228-workbench-rollup-sprintE/tests/rollup-type-check-ddl.test.ts --reporter=dot) || exit 1
```
**硬阈值**: 该 suite 全绿；sum 配 text 400、count/concat/lookup 合法 201、options 三元组落库。

---

### Step 2: rollup 聚合值正确性 + 数值规整 + 多值格式化（A37 / J15）
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤3-4 + 提案 v5 A37 断言原文（逐字）+ J15 多值口径

**可观测行为**: 双企业种子——A 企业建源表+目标表+relation 字段，目标表录已知数值/文本行，源记录关联 N 条子行。逐函数与手算期望**逐一相等**：`count`=关联行数、`sum/min/max`=数值字段和/最小/最大、`concat`=文本字段 row_order 升序 `, ` 拼接、`lookup`=取关联行目标字段值多值展示。**数值规整**：sum/min/max 聚合前 `Number()` 规整（JSONB 数字可能 string 存），种子含一行 string 数字 `"12"` 须计入 sum（52=10+30+12，**绝不字符串拼接冒充 sum**，值不是 "103012"）；非数值目标行（abc）按跳过+degraded 处理。

**验证命令**:
```bash
(cd apps/api && npx vitest run --config vitest.workbench-rollup.config.ts \
  ../../sprints/08222228-workbench-rollup-sprintE/tests/rollup-aggregate.test.ts --reporter=dot) || exit 1
```
**硬阈值**: count=3、sum=52（含 string "12"）、min=10、max=30、concat/lookup="甲, 乙, 丙"；混入 abc 后 sum 仍 52 且 degraded=true。

---

### Step 3: 聚合隔离只跨本 org 目标行（A38）
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤4 组织隔离 + 提案 v5 A38 断言原文（逐字）

**可观测行为**: 把某目标行 `org_id` 在库里直接改成 B 企业后，A 企业读该 rollup——被篡改行**不进入聚合基数**（count 减 1、sum 不含该行值），聚合值等于「仅本 org 存活目标行」的期望，绝不因库里脏行泄露对方数据。**变异 proven-to-fire**：去掉聚合读服务 `AND org_id=$orgId` → 该断言转红。

**验证命令**:
```bash
(cd apps/api && npx vitest run --config vitest.workbench-rollup.config.ts \
  ../../sprints/08222228-workbench-rollup-sprintE/tests/rollup-isolation.test.ts --reporter=dot) || exit 1
```
**硬阈值**: 篡改前 count=3/sum=60；篡改后 count=2/sum=30（越权行剔除）。

---

### Step 4: 失效降级三支（A39）
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤5 + 提案 v5 A39 断言原文（逐字，含目标表软删第三支）

**可观测行为**: ① 删 rollup 依赖的 relation 字段 → rollup 值置 null + `degraded=true` + 单元格可见降级标记（**不悬空、不 500、不白屏**）② 删 rollup 目标字段 → 同上降级 ③ **目标表软删 → 同上降级**（复用 relation 解析链 `getTable` 返 null 的机制，与 A30② 对称）。**变异 proven-to-fire**：把降级分支改成直接抛错/裸访问已删字段/无视 getTable 返 null → 该断言三支转红。

**验证命令**:
```bash
(cd apps/api && npx vitest run --config vitest.workbench-rollup.config.ts \
  ../../sprints/08222228-workbench-rollup-sprintE/tests/rollup-degrade.test.ts --reporter=dot) || exit 1
```
**硬阈值**: 三支各 200（非 5xx）、cell.value 为 null、degraded=true、单元格不消失。

---

### Step 5: 无运行时 DDL + 读时计算不落库 + 配置存 options
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入。理由：GP Invariant「无运行时 DDL + 零新建表 + 聚合值不物化」需要可机检守卫，防 generator 用「rollup 落库/建缓存表」实现引入一致性接缝与标识符注入面（J13 已否决落库缓存）。

**可观测行为**: 建 rollup 字段 + 读聚合全程，`zenithjoy` schema 的 `information_schema.tables`+`.columns` 集合逐字节不变；零 `%rollup%` 命名物理表；rollup 配置以三元组落 `db_fields.options`（读回逐字相等），聚合值不写任何行/列。

**验证命令**:
```bash
(cd apps/api && npx vitest run --config vitest.workbench-rollup.config.ts \
  ../../sprints/08222228-workbench-rollup-sprintE/tests/rollup-type-check-ddl.test.ts -t "DDL" --reporter=dot) || exit 1
# 静态兜底：全仓 migration 零 rollup 物理表建表 SQL
! grep -rIn "CREATE TABLE" apps/api/db/migrations/ 2>/dev/null | grep -iE "rollup|db_agg" | grep -vi "exclusion" || { echo "FAIL: 出现 rollup 物理表 migration"; exit 1; }
echo OK
```
**硬阈值**: information_schema 前后全等；零 rollup 物理表；options 三元组读回逐字。

---

### Step 6: 墙裁定 · rollup 读服务不进问答检索域（A41）
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤6 墙裁定 + 提案 v5 A41 断言原文（逐字）

**可观测行为**: ① rollup 聚合读服务**必须落钉死路径** `apps/api/src/services/workbench-rollup.service.ts`（Sprint E 交付物冻结此路径，不得并入 relation/其他服务文件——给守卫固定 grep 靶，避免『或等价路径』导致 must-not-import 恒空假绿）②该文件**不被** `apps/api/src/knowledge/` 下 knowledge 检索特征文件 import/消费 ③rollup 值只经 `/api/knowledge/db/*` 端点返回。**变异 proven-to-fire**：在 knowledge 检索特征文件里 `import ... from '../services/workbench-rollup.service'` → 守卫报红。

**验证命令**:
```bash
bash sprints/08222228-workbench-rollup-sprintE/scripts/rollup-wall-guard.sh || exit 1
```
**硬阈值**: 守卫 exit 0（钉死路径存在 + 检索特征文件零 workbench-rollup 命中）。

---

### Step 7: 真浏览器 rollup 链（windows_cloud）
**来源**: `[FROM_PRD]` — PRD「journey_type: user_facing」+ target_environment: windows_cloud（ZenithJoy UI 死规则）

**可观测行为**: 真浏览器建 relation 字段→配 rollup/lookup 字段→单元格显示聚合值（count/sum/concat）→lookup 多值逗号拼接→删依赖字段后单元格降级占位（不白屏）。判据 = `e2e-knowledge-hub-path3.yml` 的 windows job + 本刀 rollup step conclusion==success + 真取回截图。

**验证命令**:
```bash
# 见 ## E2E 验收：判据 = windows job + 本刀 @rollup-* step conclusion==success + 真取回截图
echo "windows_cloud E2E，见 ## E2E 验收 段"
```
**硬阈值**: windows job success；本刀 `@rollup-*` step success；截图 ≥3 张非空。

---

### Step 8: rollup 接进既有 path3 workflow / vitest / smoke（不重造）
**来源**: `[FROM_PRD]` — PRD 范围「rollup E2E spec 接进既有 e2e-knowledge-hub-path3.yml」+ 提案 v5「接入不重造」

**可观测行为**: `structured-workbench-rollup.spec.ts` 进 `e2e-knowledge-hub-path3.yml` 的 `paths` + windows job 有真调 `e2e-rollup-run.ps1` 的 `@rollup-*` step（windows job **仍无 job 级事件条件门**，A33(c) 不破）；linux job 含 `npm run test:workbench-rollup` + rollup smoke 段；smoke 新增 rollup 段 + 变异开关进 baseline 棘轮。

**验证命令**:
```bash
WF=.github/workflows/e2e-knowledge-hub-path3.yml
grep -q "structured-workbench-rollup.spec.ts" "$WF" || { echo "FAIL: spec 未进 workflow paths"; exit 1; }
grep -q "e2e-rollup-run.ps1" "$WF" || { echo "FAIL: windows job 无 rollup step"; exit 1; }
grep -q "test:workbench-rollup" "$WF" || { echo "FAIL: linux job 未跑 rollup vitest"; exit 1; }
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

## 墙裁定（GP 层决策，本刀不绕过 — 逐字承接提案 v5 §墙裁定）

**问题**：rollup 聚出的富数据（关联子记录的求和/计数/拼接值）算不算「database 表内容」，要不要按路①③墙（A35/lifeline[13]）挡在路①问答检索域外？

**裁定**：**算，同口径挡在检索域外。** 三点理由：
1. **性质**：rollup 值是 `db_rows`/`db_fields` 的读时派生投影，语义上仍是 database 表内容的一种呈现，不因「是聚合值」就脱离墙的管辖——否则会开一个「把明细挡住、把明细的汇总放进去」的旁路。
2. **天然守墙**：rollup 采读时计算不落库（J13 REC），聚合值不物化进任何物理表，因此它**根本不存在于任何可被检索的表里**——墙在数据层天然成立。
3. **前向兼容锚**：为防路①问答检索日后误把 rollup 读服务接进检索链，本刀把 rollup 服务钉死路径纳入 A41 守卫——检索特征文件若 import rollup 服务，守卫报红。

**记账**：若未来 rollup 改走落库缓存（J13 备选，本刀否决），缓存表**必须**同步进 `retrieval-exclusions.ts` 清单（A35① 载体）——写入 P2-12 记账。

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud
**接线**：**不新建 workflow**（A33 独立 workflow `e2e-knowledge-hub-path3.yml` 已在 base）。沿用它——linux job 增 `test:workbench-rollup` + rollup smoke 段；windows job（**A33(c)：不许加 job 级 if**）增调 `sprints/08222228-workbench-rollup-sprintE/e2e-rollup-run.ps1` 的 `@rollup-*` step + 本刀截图 upload step（`path3-rollup-screenshots`）；workflow `paths` 增本刀 spec、`vitest.workbench-rollup.config.ts` 与 sprint 目录。

> 下面 bash 块是 **evaluator 模式B 的 final-e2e**：真浏览器跑在 GitHub Actions windows-latest 上（ZenithJoy UI 死规则），本地无从复现，判据 = **那个 windows job 的 conclusion + 本刀 rollup step 的 conclusion + 从 artifact 真取回本轮截图**（不认宿主机手工塞的图）。PowerShell/Playwright 交付物规格见其后非 bash 代码块。

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

# 2. 本刀 rollup 真浏览器 step success（job 绿但本刀 step 没跑 = 假绿）
echo "$J" | jq -e '[.jobs[] | select(.name | test("windows")) | .steps[] | select(.name | test("rollup|聚合")) | select(.conclusion == "success")] | length > 0' >/dev/null \
  || { echo "FAIL: windows job 里没有跑本刀 rollup 那一段"; echo "$J" | jq -r '[.jobs[] | select(.name | test("windows")) | .steps[].name] | @csv'; exit 1; }

# 3. linux job 必须 success（rollup 真 PG 段 + rollup vitest + smoke 段在那里）
echo "$J" | jq -e '[.jobs[] | select(.name | test("linux")) | select(.conclusion == "success")] | length > 0' >/dev/null \
  || { echo "FAIL: linux job 未成功"; exit 1; }

# 4. 截图从 artifact 真取回（≥3 张、全部非空），落进 sprint 目录
D=$(mktemp -d)
gh run download "$ID" -n path3-rollup-screenshots -D "$D" \
  || { echo "FAIL: 下不到本刀截图 artifact path3-rollup-screenshots"; exit 1; }
N=$(find "$D" -name '*.png' | wc -l | tr -d ' ')
[ "$N" -ge 3 ] || { echo "FAIL: artifact 里只有 $N 张截图（需 >=3）"; exit 1; }
for f in $(find "$D" -name '*.png'); do [ -s "$f" ] || { echo "FAIL: 空截图 $f"; exit 1; }; done
DST=sprints/08222228-workbench-rollup-sprintE/screenshots
mkdir -p "$DST"
find "$D" -name '*.png' -exec cp {} "$DST"/ \;
echo "OK: S4 rollup Golden Path 真浏览器全链通过，截图 $N 张已落 $DST"
```

### 交付物规格 A：`sprints/08222228-workbench-rollup-sprintE/e2e-rollup-run.ps1`（proposer 已产出）

沿用 Sprint B 的 `e2e-rows-lib.ps1`（`Set-DbEnvFromUrl` / `New-TwoTenantSeed` / `Start-Api` / `Get-SessionCookie` / `Start-Hub` / `Stop-Procs` / `Invoke-Checked`），直接 dot-source。起真 apps/api + 真 Postgres（禁 stub），spec 禁 `page.route()`；`$Grep` 传 ASCII 标签（`@rollup-build` / `@rollup-lookup` / `@rollup-degrade`）；产出截图晚于脚本启动（防历史产物冒充）。

### 交付物规格 B：`apps/staff-hub/e2e/structured-workbench-rollup.spec.ts`（generator 写）

变体C 死规则：零 `page.route()`、全打真 apps/api + 真 PG；双企业种子由 ps1 runner 注入 cookie；ASCII 标签。至少覆盖：
- `@rollup-build`：建 relation 字段→配 rollup 字段(sum/count over 目标字段)→单元格显示聚合值（`toBeVisible`+`toHaveText` 断言具体数值）
- `@rollup-lookup`：配 lookup 字段→单元格显示关联行目标字段多值逗号拼接（`toHaveText` 含 `, `）
- `@rollup-degrade`：删 rollup 依赖字段→单元格显示可见降级占位（`toBeVisible`，不显示旧值、不白屏）
每关键态截图落 `sprints/08222228-workbench-rollup-sprintE/screenshots/`。

### 交付物规格 C：`apps/api/vitest.workbench-rollup.config.ts` + `.setup.ts`（generator 写）

照 `vitest.workbench-relations.config.ts`/`.setup.ts` 同口径：`include` 白名单本 sprint tests 目录（`../../sprints/08222228-workbench-rollup-sprintE/tests/**/*.test.ts`）、`singleFork`+非并发、setup 从 `E2E_DATABASE_URL`/`DATABASE_URL` 推导五个 `DATABASE_*`。`apps/api/package.json` 加 `test:workbench-rollup` script。

### 交付物规格 D：`structured-workbench-smoke.sh` rollup 段 + 变异开关（generator 加）

在既有 smoke 上**增量**加（不改既有段）：`--rollup-a37-only` / `--rollup-a38-only` / `--rollup-a39-only` / `--rollup-a40-only` / `--rollup-ddl-only` 段（真 apps/api + 真 PG 双企业夹具 + psql 验），并在 `mutation_list()` 追加 **4 个**变异开关：
- `A38-rollup-org-bypass`（去掉聚合读服务 `AND org_id=$orgId` → 越权脏行进聚合 → `--rollup-a38-only` 段红）
- `A39-rollup-degrade-bypass`（降级分支改成裸访问已删字段/直接抛错/无视 getTable 返 null → `--rollup-a39-only` 三支段红）
- `A40-rollup-typecheck-off`（去掉类型×函数校验 → sum 配文本能建成返错值 → `--rollup-a40-only` 段红）
- `A41-rollup-retrieval-import`（在 `retrieval-exclusions.ts` 里 import rollup 服务 → `scripts/rollup-wall-guard.sh` 报红）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 聚合值正确+数值规整+多值格式化 | `tests/rollup-aggregate.test.ts` | `count 聚合`、`sum 聚合`、`min / max 聚合`、`concat 聚合`、`lookup 取值`、`非数值目标行跳过` | rollups 端点缺/聚合未实现 → red |
| 聚合隔离只跨本 org + 反枚举 404 | `tests/rollup-isolation.test.ts` | `篡改前基线`、`把目标行 org 直接改成 B 企业`、`反枚举` | 聚合无 org 二次校验 / `/rollups` 404 可区分 → red |
| 失效降级三支 | `tests/rollup-degrade.test.ts` | `A39①`、`A39②`、`A39③` | 降级未实现/悬空 500 → red |
| 类型×函数校验+零 DDL+配置存 options | `tests/rollup-type-check-ddl.test.ts` | `sum 配 text`、`min / max 配 text`、`非法聚合函数名`、`relation_field_id 不是本表`、`count 无需目标字段`、`配置以三元组落`、`无运行时 DDL` | 校验缺/rollup 类型未登记/新建物理表 → red |

**A41 墙裁定**：独立源码守卫脚本 `scripts/rollup-wall-guard.sh`（无需 DB）；rollup 服务未落钉死路径时报红（当前 Red 证据已验），generator 落地后转绿；变异 import 使其报红。

---

## 附一：范围收敛与不重造（承接提案 v5 + PRD 范围限定）

- **不重造**：A33 workflow（`e2e-knowledge-hub-path3.yml` 已在 base，只接入）/ A35 排除清单（`retrieval-exclusions.ts` 已在 base，本刀零新表无需改）/ A32/A34 路由族+鉴权闸（`workbench.ts`+`workbench-auth.ts` 已在）/ Sprint D relation 解析链（`relationCandidates`/`backrefs`/org 二次校验，本刀复用不重写）。
- **零新建表**：rollup 读时计算不落库、配置存 `db_fields.options` 位序三元组；唯一 schema 变更 = migration 把 `rollup`/`lookup` 加进 `db_fields` field_type CHECK（DROP-then-ADD 幂等），migrate 时落地非运行时 DDL，Step 5 information_schema「运行时前后全等」断言不受影响。
- **门禁断言只覆盖 A37–A41**（rollup 功能）+ Step 8 接入验证，对齐提案 v5 不放大。既有 A1–A36 语义、Gate G0/G1/G2、骨干步数、既有变异语义本刀不碰。
