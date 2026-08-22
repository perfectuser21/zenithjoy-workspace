# Sprint Contract Draft (Round 1) — 路③ 结构化工作台 · Sprint C（S3 视图切得开）

**GP-Anchor**: `line11/structured_workbench#step3`
**上位合同**: 员工知识中枢 路③「结构化工作台」Golden Path 提案 v3（gp `c86e37ff-3307-4b1a-80d9-3b00b8450554`），**CONTRACT IS LAW**
**门禁断言**: 上位合同 §8 Sprint C = **A20–A26**（本刀实装 A20–A25；A26 见下方「本刀显式不实装」）
**journey_type**: user_facing
**target_environment**: windows_cloud
**TASK_ID**: 391e840c-5200-4e60-9f26-525846405018

---

## controller 三条 concern 的落实（本轮起草前置裁定，逐条写进合同硬条款）

| # | concern 裁定 | 本合同怎么落 |
|---|---|---|
| **C1** | **复用 `zenithjoy.db_view_prefs`，不另建 `db_views`** | 全刀**零新增 migration**：视图 = `db_view_prefs` 的一行（`table_id`/`org_id`/`member_id` 三键 + `prefs JSONB` 装视图体）。ARTIFACT 条目机械断言「`apps/api/db/migrations/` 下无本刀新增 `.sql`」+「源码零 `db_views` 字面量」，见 contract-dod.md `ART-1`/`ART-2` |
| **C2** | **分组字段只做 `single_select`**；多选/其它类型 → **400 可见报错** | Golden Path Step4 + 断言 `BEH-4`：`multi_select` / `number` / `date` / `text` / `long_text` / `person` / `url` **七类逐个**做分组字段一律 400 `GROUP_FIELD_TYPE_INVALID`，库中该视图行逐字未变；`single_select` 正向 200 成对（防「一律 400」假绿）。PRD `## 假设` 第 2 条（放宽到含多选）**本刀作废**，理由 = 上位合同 §6 A20 原文只批「按**单选**字段分组」，多选分列（一行出现在多列 + 拖卡改哪个值）是合同未定义的新设计 |
| **C3** | 范围 = §8 Sprint C（A20–A26），**A26 标结构预留、本刀不实装断言** | 本合同 **A20–A25 逐条有门禁断言**；**A26 零断言**，仅在 `## 本刀显式不实装` 记账并要求交付物保持「视图组件不依赖路由 `useParams`、props 完备」这一结构条件（**ARTIFACT 级弱约束，不作为门禁**）。路② 页面内嵌 database 的独立挂载断言留给路②/Sprint D |

**复用 Sprint A/B 底座（不重造，机械可查）**：`workbenchAuthGuard`（`apps/api/src/middleware/workbench-auth.ts:71`）/ `notFoundBody()` 反枚举常量体（`:56`）/ `PATCH /rows/:id` + `version` 乐观锁 409（`apps/api/src/services/workbench-rows.service.ts:358`）/ `resolveTable()` 表可达性四合一 null（`:216`）/ `writeAudit()` + `auditBestEffort()` / `knowledgeJson` 前端解析器 / `structured-workbench-smoke.sh` 的 `--fixture-up` 夹具供给协议与变异协议。**本刀不新建鉴权闸、不新建行写入路径、不新建响应体形状。**

---

## 已知约束

### 来自回归测试（Step 1.2）

- `apps/api/src/routes/workbench.test.ts` → `端点清单恰好 17 个（9 写 + 8 读），与合同逐字一致`（**本刀新增 4 端点，必须同步改成 22 / 12 / 10，改值不删断言**）
- `apps/api/src/routes/workbench.test.ts` → `写端点 9 个、读端点 8 个`
- `apps/api/src/routes/workbench.test.ts` → `鉴权闸挂在所有端点之前 —— 路由栈第一层是中间件而不是某条 route`
- `apps/api/src/middleware/workbench-auth.test.ts` → 四态（401 SESSION_REQUIRED / 403 NO_TENANT / 409 MULTI_ORG_MEMBER / 503 LEDGER_UNREACHABLE）
- `apps/staff-hub/src/lib/workbenchFetch.test.ts` → `parseCellInput` 八类字段解析、空串 = 清空该格
- `sprints/08201850-workbench-sprintB-rows/tests/rows-optimistic-lock.test.ts` → `同基线并发提交恰一个 200 一个 409` / `409 时库中该格等于先提交者的值` / `基线 version 缺失或非数字返 400 而不是被当成放行`
- `sprints/08201850-workbench-sprintB-rows/tests/rows-crud.test.ts` → `空表列行返零行且带 total 与 row_limit`（**本刀给 `GET /tables/:id/rows` 加 `filter`/`sort` 查询参数，响应体形状必须一字不改，否则这条转红**）
- `sprints/08201151-.../tests/*` → 双企业种子 + 三真会话（`aliceCookie` 表主 / `bobCookie` 同组织他人 / `carolCookie` 他企业）

### 累积 FR（Step 1.3 三源之二）

`GET localhost:5221/api/brain/line/da60cb26-.../context-manifest` → **`context-manifest: unavailable`**（端点 404，Brain 未提供该路由）。改取 PRD `## 累积 FR` 段（planner 已按 Sprint A/B 实际合并产物手工补齐），逐条视为本刀不得回退的既有行为：Sprint A G0/G1/G2 + S1 六步、Sprint B S2 七步。**本刀对既有端点的唯一改动 = `GET /tables/:id/rows` 新增两个可选查询参数，不改其响应体、不改其默认行为**（不传参数时逐字等于 Sprint B 的返回）。

### 铁律清单 → INV 映射

PRD `## Invariant 约束` 共 12 条，逐条在 contract-dod.md 有 `INV-N` 条目或显式 `N/A`（见该文件 `### Invariant 覆盖` 段）。

---

## Response Schema（推导来源：**api_registry 推导** —— registry 端点返回 `null`，改取同族既有端点 `apps/api/src/routes/workbench.ts` 与 `workbench-rows.service.ts` 的字面口径）

> 命名家族口径（Sprint A/B 已定，本刀逐字跟进）：主键一律 `<资源>_id`（`table_id` / `field_id` / `row_id`）→ 视图主键 = **`view_id`**；时间戳一律 snake_case ISO 串（`created_at` / `updated_at` / `deleted_at`）；统一成功体 `{success:true, data:<下表>}`；统一失败体 `{success:false, data:null, error:{code,message}, timestamp}`；**404 专用体不带 `timestamp`**（`notFoundBody()`，反枚举逐字节同形）。

### `View` 对象（三个视图端点共用）

```json
{
  "view_id": "<uuid>",
  "name": "<string>",
  "view_type": "grid",
  "filters": [{ "field_id": "<uuid>", "op": "contains", "value": "<string|number|null>" }],
  "sorts": [{ "field_id": "<uuid>", "dir": "asc" }],
  "group_field_id": null,
  "hidden_field_ids": ["<uuid>"],
  "is_active": true,
  "degraded": false,
  "updated_at": "<iso8601>"
}
```

- `view_id` (string uuid, 必填)：`db_view_prefs.id`。来源——api_registry 推导（同族 `table_id`/`row_id`/`field_id` 口径）
- `name` (string, 必填)：视图显示名。来源——PRD Golden Path 第 7 条「删掉某个视图」隐含视图有名字
- `view_type` (string 字面量, 必填)：**只允许 `"grid"` / `"kanban"` 两个字面值**。来源——PRD Golden Path 第 2 条「一键切**看板视图**」+ 第 7 条「视图类型…逐项与上次一致」
- `filters` (array, 必填, 可空数组)：元素 keys **恰好** `["field_id","op","value"]`；`op` ∈ `["contains","equals","gt","lt"]`。来源——PRD 范围内「AG Grid `filterModel` → `db_rows.data` 的 JSONB 路径查询 + `field_id` 白名单映射」
- `sorts` (array, 必填, 可空数组)：元素 keys **恰好** `["field_id","dir"]`；`dir` ∈ `["asc","desc"]`
- `group_field_id` (string uuid | null, 必填**且可为 null**)：看板分组列。非 null 时必须是本表 `field_type = 'single_select'` 的字段
- `hidden_field_ids` (array of uuid, 必填, 可空数组)：隐藏列
- `is_active` (boolean, 必填)：该 member 在该表上的当前视图。同一 `(table_id, member_id)` 下**至多一个** `true`
- `degraded` (boolean, 必填)：读路径剔除过失效引用即为 `true`（上位合同 A22① 的**机械信号**，前端据它出可见提示；没有它前端只能猜，「降级」就退化成静默）
- `updated_at` (string iso8601, 必填)

**Schema 完整性**：`View` 顶层 keys 排序后**恰好等于**
`["degraded","filters","group_field_id","hidden_field_ids","is_active","name","sorts","updated_at","view_id","view_type"]`（10 个）

**禁用字段名**（`View` 里**一个都不许出现**，来自同族既有端点的同义替换词与 AG Grid 原生词）：
`id` / `viewId` / `type` / `prefs` / `config` / `active` / `groupBy` / `group_by` / `hiddenFields` / `hidden_fields` / `filterModel` / `sortModel` / `columns` / `fallback`

### 端点逐个

| # | Endpoint | 类别 | Success | `data` keys（**恰好**） |
|---|---|---|---|---|
| V1 | `GET /api/knowledge/db/tables/:id/views` | 读 | 200 | `["active_view_id","views"]`；`views` = `View[]`（**纯读，零写入副作用**）；无记录时 `{"views":[],"active_view_id":null}` |
| V2 | `POST /api/knowledge/db/tables/:id/views` | 写 | 201 | `View` |
| V3 | `PATCH /api/knowledge/db/views/:id` | 写 | 200 | `View` |
| V4 | `DELETE /api/knowledge/db/views/:id` | 写 | 200 | `["deleted_view_id","remaining"]`（`remaining` = number，删后本 member 在该表剩余视图数） |
| V5 | `GET /api/knowledge/db/assigned-to-me` | 读 | 200 | `["items"]`；`items[]` keys **恰好** `["field_id","row_id","table_id","table_name"]` |
| R1' | `GET /api/knowledge/db/tables/:id/rows?filter=&sort=` | 读（**既有端点加参**） | 200 | **一字不改**：`["row_limit","rows","total"]`，`rows[]` keys 恰好 `["created_at","data","row_id","row_order","updated_at","version"]` |

**V2 / V3 请求体**（字段名逐字，服务端**只取这六个**，`org_id`/`member_id`/`tenant_id` 连读都不读）：
`{ "name": <string>, "view_type": <"grid"|"kanban">, "filters": [...], "sorts": [...], "group_field_id": <uuid|null>, "hidden_field_ids": [...], "is_active": <boolean> }`
V3 全部字段可选（增量补丁语义，与 `PATCH /rows/:id` 同族）。

**`filter` / `sort` 查询参数编码**：URL-encoded JSON 数组，元素形状与 `View.filters` / `View.sorts` **逐字相同**。解析不出 JSON / 不是数组 / 元素 keys 不符 → **400 `VALIDATION_FAILED`**。

### Error（HTTP 4xx / 5xx）

| 场景 | 状态 | `error.code` | 体形状 |
|---|---|---|---|
| 请求体/参数形状非法（含 `field_id` 非 UUID 形态，如 `id; DROP TABLE`） | 400 | `VALIDATION_FAILED` | 带 `timestamp` |
| 分组字段类型不是 `single_select` | 400 | `GROUP_FIELD_TYPE_INVALID` | 带 `timestamp` |
| 删到最后一个视图 | 400 | `LAST_VIEW_PROTECTED` | 带 `timestamp` |
| 表/视图不可达、**合法 UUID 但不属于本表的 `field_id`**（含他企业真实 field id） | 404 | `NOT_FOUND` | **`notFoundBody()`，不带 `timestamp`，与随机不存在 id 逐字节相同** |
| 无会话 / 无归属 / 多组织 / 库不可达 | 401 / 403 / 409 / 503 | 闸层四态（Sprint A 已定） | 带 `timestamp` |
| 拖卡写回并发冲突（复用 `PATCH /rows/:id`） | 409 | `ROW_VERSION_CONFLICT` | 带 `timestamp` |

**404 优先于 400（死顺序）**：表不可达 → 视图不可达 → `field_id` 不属本表（404）→ 才轮到形状/类型校验（400）。

---

## Golden Path

```
[员工打开一张已有数据的表]
  → S1 拿到自己的视图列表（首次为空，前端建默认视图）
  → S2 按文本字段筛 / 按数字字段排（表格当场只剩符合条件的行且按该列有序）
  → S3 切看板 + 选单选字段分组（卡片按值分列，无值归「未分组」）
  → S4 选非单选字段分组 → 400 可见报错，不进看板不留半截状态
  → S5 拖卡换列 → 该行分组字段值落库 → 刷新仍在新列
  → S6 拖卡失败/409 → 卡片弹回原列 + 可见错误提示
  → S7 隐藏若干列 → 视图配置持久化到 db_view_prefs（存 field_id）
  → S8 换会话重进 → 逐项一致；改字段显示名视图不失效
  → S9 删视图 → 表与行一行不少；删到最后一个被拒
  → S10 视图偏好保存失败 → 工具条可见提示，禁静默吞
  → S11 视图层跨组织正反双向 + 反查两分支（已删字段降级 / 他企业 field_id 404）
  → S12 白名单：非白名单 field_id / 原始 SQL 片段 → 4xx，information_schema 未变
  → S13 「指派给我」全局视图
[换个会话重进这张表，还是上次那个视图配置，拖过的卡还在新列里]
```

---

### Step 1: 打开表拿到自己的视图列表（`GET /tables/:id/views`，纯读）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 7 条「换一个会话重新登录进同一张表 → 视图类型/筛/排/分组/隐藏列逐项与上次一致」的读入口；PRD 范围内「视图偏好读写端点 + `db_view_prefs` 的 CRUD service」

**可观测行为**: 表主用自己的会话调该端点得 200；无视图时 `views` 为空数组、`active_view_id` 为 `null`；建过视图后逐字返回，`is_active` 为 `true` 的至多一个。**该端点零写入副作用**（调 N 次后 `db_view_prefs` 行数不变）。

**验证命令**:
```bash
# 前置：bash structured-workbench-smoke.sh --fixture-up && . ./.wb-fixture.env
API="http://localhost:$API_PORT/api/knowledge/db"
curl -sf -b "$COOKIE_A" "$API/tables/$TID/views" \
  | jq -e '(.data|keys)==["active_view_id","views"] and (.data.views|length)==0 and .data.active_view_id==null'
N0=$(psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_view_prefs WHERE table_id = '$TID'")
curl -sf -b "$COOKIE_A" "$API/tables/$TID/views" >/dev/null
N1=$(psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_view_prefs WHERE table_id = '$TID'")
[ "$N0" = "$N1" ] || { echo "FAIL: GET 有写入副作用（$N0 -> $N1）"; exit 1; }
```

**硬阈值**: `data` keys 恰好两个；空表 `views` 长度 0；两次 GET 之间 `db_view_prefs` 行数差 = 0

---

### Step 2: 按文本字段筛 + 按数字字段排（`GET /tables/:id/rows?filter=&sort=`）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条「按某个文本字段筛、按某个数字字段排 → 表格当场只剩符合条件的行且按该列有序」；上位合同 **A20** 四件套前两件

**可观测行为**: 传 `filter=[{field_id:<text 字段>,op:"contains",value:"甲"}]` → 返回集合**恰好等于**该字段含「甲」的行；传 `sort=[{field_id:<number 字段>,dir:"asc"}]` → **按数值序**（`9` 排在 `10` 前面，不是字典序 `"10" < "9"`）；不传参数时响应与 Sprint B 逐字相同。

**验证命令**:
```bash
# 三行：number = 9 / 10 / 2，text = 甲一 / 乙二 / 甲三
RESP=$(curl -sf -b "$COOKIE_A" --get "$API/tables/$TID/rows" \
  --data-urlencode "filter=[{\"field_id\":\"$FT\",\"op\":\"contains\",\"value\":\"甲\"}]" \
  --data-urlencode "sort=[{\"field_id\":\"$FN\",\"dir\":\"asc\"}]")
echo "$RESP" | jq -e --arg ft "$FT" --arg fn "$FN" \
  '(.data.rows|length)==2 and .data.total==2
   and ([.data.rows[].data[$ft]]|all(contains("甲")))
   and [.data.rows[].data[$fn]] == [2,9]'
# 数值序守卫：字典序会把 10 排到 9 前面
echo "$RESP" | jq -e --arg fn "$FN" '[.data.rows[].data[$fn]]|.[0] < .[1]'
```

**硬阈值**: 筛后行数 = 期望集合大小且逐行命中；数字升序结果 `[2,9]`（含 10 的全集升序为 `[2,9,10]`）；`total == (rows|length)`；`rows[]` keys 仍恰好 6 个

---

### Step 3: 切看板 + 选单选字段分组（分列 + 未分组列）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条「点视图切换器切到看板视图 → 选一个单选字段做分组列 → 卡片按该字段值分列展示，该字段无值的行归「未分组」列」；上位合同 **A20** 四件套后两件

**可观测行为**: `PATCH /views/:id {view_type:"kanban", group_field_id:<single_select 字段>}` → 200 且落库；真浏览器里出现列 = 该字段 `options` 全集 + 「未分组」；`data[group_field_id]` 为 `null` / 缺键 / 空串的行**全部**落在「未分组」列。

**验证命令**:
```bash
curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X PATCH "$API/views/$VID" \
  -d "{\"view_type\":\"kanban\",\"group_field_id\":\"$FS\"}" \
  | jq -e --arg fs "$FS" '.data.view_type=="kanban" and .data.group_field_id==$fs and .data.degraded==false'
psql "$PG" -t -A -q -c \
  "SELECT (prefs->>'view_type') || '|' || (prefs->>'group_field_id') FROM zenithjoy.db_view_prefs WHERE id = '$VID'" \
  | grep -qx "kanban|$FS"
```
真浏览器侧（`## E2E 验收` 的 Playwright 段）：
```
await expect(page.getByTestId('kanban-column-甲')).toBeVisible();
await expect(page.getByTestId('kanban-column-__ungrouped__')).toBeVisible();
// 三态各一张卡（null / 缺键 / 空串），只验一态就等于放过 JC3 的误判后果
await expect(page.getByTestId('kanban-column-__ungrouped__').getByTestId(/^kanban-card-/)).toHaveCount(3);
```

**纯函数侧（可机械变异的落点）**：`apps/staff-hub/src/lib/workbenchKanban.ts` 导出
`groupRowsByField(rows, groupFieldId, options) → Array<{ column_value: string; row_ids: string[] }>`，
末列 `column_value === '__ungrouped__'`；`data[groupFieldId]` 为 `null`、**缺键**、空串三态**全部**进末列，有值行进其选项列（选项列按 `options` 原序，值不在 `options` 里的按值追加在选项列之后、未分组列之前）。合同测试 `views-group-type.test.ts` 的「未分组三态」用例断言分列结果逐字；变异 `A20-ungrouped-null-only` 把三态判据改成只判 `null` → 该用例（与 `--a20-only` 段）必须转红。

**硬阈值**: 列数 = `options.length + 1`；未分组列卡片数 = 三态行数之和（本用例为 3）；库中 `prefs` 的 `view_type`/`group_field_id` 逐字相符；`groupRowsByField` 三态用例 `numPassedTests ≥ 1 且 numFailedTests == 0`

---

### Step 4: 分组列选非单选字段 → 400 可见报错（**concern C2 的落点**）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条「选了非单选/多选类型做分组 → 400 + 可见报错，不进看板、不留半截状态」；**类型集合按 controller C2 收窄为「仅 `single_select` 合法」**，`multi_select` 一并 400

**可观测行为**: 其余**七类**字段（`text` / `long_text` / `number` / `date` / `multi_select` / `person` / `url`）逐个做 `group_field_id` → 400 `GROUP_FIELD_TYPE_INVALID`，且该视图行 `prefs` **逐字未变**（不留半截状态）；同一次运行内 `single_select` 正向 200（防「一律 400」假绿）。

**验证命令**:
```bash
BEFORE=$(psql "$PG" -t -A -q -c "SELECT prefs::text FROM zenithjoy.db_view_prefs WHERE id = '$VID'")
for T in text long_text number date multi_select person url; do
  FID=$(printf '%s' "$FLD" | jq -r --arg t "$T" '.data.fields[]|select(.field_type==$t)|.field_id')
  C=$(curl -s -o /tmp/g.json -w '%{http_code}' -b "$COOKIE_A" -H 'Content-Type: application/json' \
        -X PATCH "$API/views/$VID" -d "{\"view_type\":\"kanban\",\"group_field_id\":\"$FID\"}")
  [ "$C" = "400" ] || { echo "FAIL: $T 做分组返 $C（应 400）"; exit 1; }
  jq -e '.error.code=="GROUP_FIELD_TYPE_INVALID"' < /tmp/g.json >/dev/null || exit 1
done
AFTER=$(psql "$PG" -t -A -q -c "SELECT prefs::text FROM zenithjoy.db_view_prefs WHERE id = '$VID'")
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: 400 却改了库（留半截状态）"; exit 1; }
curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X PATCH "$API/views/$VID" \
  -d "{\"view_type\":\"kanban\",\"group_field_id\":\"$FS\"}" | jq -e '.data.group_field_id != null'
```

**硬阈值**: 七类各返 400 + 错误码逐字；`prefs` 前后字符串全等；正向 `single_select` 同轮 200

---

### Step 5: 拖卡换列 → 行分组字段值落库（复用 `PATCH /rows/:id`）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条「拖一张卡到另一列 → 该行分组字段值改成目标列的值并落库（走 Sprint B 的 `PATCH /rows/:id` + `version` 乐观锁）→ 刷新页面卡片仍在新列」；上位合同 **A24** 前半

**可观测行为**: 真浏览器指针拖拽（`mouse.down` → ≥10 步 `mouse.move` → `mouse.up`）把卡片从「甲」列拖到「乙」列 → 库中**被拖那一行**的 `data->>group_field_id` 变为 `乙`、`version` 恰 +1，**同表其余行 `data` 逐字未变**；刷新页面后卡片仍在「乙」列。拖到「未分组」列 → 该键被清空（`data ? group_field_id` 为假 或 值为 `null`）。

**验证命令**（真浏览器段在 `## E2E 验收`；本段为 DB oracle）：
```bash
OTHERS_BEFORE=$(psql "$PG" -t -A -q -c "SELECT string_agg(r.data::text, '|' ORDER BY r.id) FROM zenithjoy.db_rows r WHERE r.table_id = '$TID' AND r.id <> '$RID'")
# …真浏览器拖拽在 windows job 里发生…
psql "$PG" -t -A -q -c "SELECT r.data ->> '$FS' FROM zenithjoy.db_rows r WHERE r.id = '$RID'" | grep -qx '乙'
OTHERS_AFTER=$(psql "$PG" -t -A -q -c "SELECT string_agg(r.data::text, '|' ORDER BY r.id) FROM zenithjoy.db_rows r WHERE r.table_id = '$TID' AND r.id <> '$RID'")
[ "$OTHERS_BEFORE" = "$OTHERS_AFTER" ] || { echo "FAIL: 拖卡改到了别的行"; exit 1; }
```
**纯函数侧（可机械变异的落点）**：`apps/staff-hub/src/lib/workbenchKanban.ts` 导出 `resolveDropPatch(rows, activeCardId, targetColumnValue, groupFieldId)` → `{ row_id, version, data }`，必须返回**被拖那张卡对应行**的 `row_id` 与其当前 `version`。变异 `A24-drag-wrong-row` 把它改成恒返 `rows[0]` → 该单测必须转红。

**硬阈值**: 被拖行分组值 = 目标列值且 `version` +1；其余行 `data` 聚合串前后全等；刷新后仍在新列

---

### Step 6: 拖卡保存失败/409 → 卡片弹回原列 + 可见错误提示

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条「拖卡保存失败（500/断网/并发 409）→ 卡片弹回原列 + 可见错误提示，绝不停在假位置」；上位合同 **A24** 后半 + **J2**

**可观测行为**（**两条前端分支各验一次**——断网是 `fetch` reject，409 是 `res.ok === false` 走 `KnowledgeRequestError`，`knowledgeFetch.ts:38-47` 把两者分开抛，只验一条就等于放过另一条）:
- ① **断网分支**：真断网（`context.setOffline(true)`）下拖卡 → 卡片**回到原列**（原列卡片数逐字复原、目标列不增）+ `kanban-drop-error` 可见
- ② **409 分支**：第二份真会话 cookie（同组织的乙）先真 `PATCH` 该行把 `version` 顶掉，页面手上的基线随即过期 → 在浏览器里拖同一张卡 → 后端返 409 `ROW_VERSION_CONFLICT`，卡片**弹回原列**且 `kanban-drop-conflict` 可见、文案逐字含「该行已被他人修改，你的改动未保存」（与 `## 失败语义声明` 同一句）；库中该行值 = 先提交者写的那个

**验证命令**:
```bash
# 409 语义（API 层，复用 Sprint B 乐观锁；真浏览器弹回在 E2E 段）
VN=$(curl -sf -b "$COOKIE_A" "$API/tables/$TID/rows" | jq -r --arg r "$RID" '.data.rows[]|select(.row_id==$r)|.version')
curl -s -o /tmp/d1.json -w '%{http_code}' -b "$COOKIE_A"  -H 'Content-Type: application/json' -X PATCH "$API/rows/$RID" -d "{\"version\":$VN,\"data\":{\"$FS\":\"乙\"}}" > /tmp/d1.code &
curl -s -o /tmp/d2.json -w '%{http_code}' -b "$COOKIE_A2" -H 'Content-Type: application/json' -X PATCH "$API/rows/$RID" -d "{\"version\":$VN,\"data\":{\"$FS\":\"甲\"}}" > /tmp/d2.code &
wait
[ "$(cat /tmp/d1.code /tmp/d2.code | grep -c '^200$')" = "1" ] || exit 1
[ "$(cat /tmp/d1.code /tmp/d2.code | grep -c '^409$')" = "1" ] || exit 1
```

**硬阈值**: 恰一个 200 一个 409；409 体 `error.code == "ROW_VERSION_CONFLICT"`；真浏览器里**两条分支各自**原列卡片数逐字复原 + 对应提示 `toBeVisible`（断网 → `kanban-drop-error`；409 → `kanban-drop-conflict` 且 `toContainText` 命中冲突文案）

---

### Step 7: 隐藏列 + 视图配置持久化到 `db_view_prefs`（**存 `field_id` 非字段名**）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 条「在工具条隐藏若干列 → 分组/排序/隐藏列这套视图配置持久化到 `db_view_prefs`（按 `org_id` + `table_id` + `member_id`，存 `field_id` 非字段名）」；上位合同 **A21** 后半

**可观测行为**: `PATCH /views/:id {hidden_field_ids:[...], sorts:[...], group_field_id:...}` → 库中 `db_view_prefs.prefs` 里出现的**全是 UUID 形态的 field_id**，**字段显示名一个都不出现**；`org_id` = 会话所属组织、`member_id` = 会话 memberId。

**验证命令**:
```bash
psql "$PG" -t -A -q -c "SELECT prefs::text FROM zenithjoy.db_view_prefs WHERE id = '$VID'" > /tmp/p.json
grep -q "$FS" /tmp/p.json || { echo "FAIL: prefs 里没有 field_id"; exit 1; }
grep -q '字段-single_select' /tmp/p.json && { echo "FAIL: prefs 里存了字段显示名"; exit 1; }
psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_view_prefs WHERE id = '$VID' AND org_id = '$ORGA_TENANT_ID' AND member_id = '$ALICE_OPENID'" | grep -qx 1
```

**硬阈值**: `prefs` 含 field_id 且**零字段显示名**；`org_id`/`member_id` 逐字相符

---

### Step 8: 换会话重进逐项一致 + 改字段显示名视图不失效

**来源**: `[FROM_PRD]` — PRD Golden Path 第 7 条；上位合同 **A21** 前半（「改字段显示名后视图不失效」）

**可观测行为**: 同一员工换一个真会话 cookie 重新 `GET /tables/:id/views` → `view_type`/`filters`/`sorts`/`group_field_id`/`hidden_field_ids`/`is_active` **逐项 JSON 全等**；把该 `single_select` 字段的 `db_fields.name` 直接在库里改名后再 GET → 视图**仍返回同一个 `group_field_id`**、`degraded == false`、`view_type` 仍是 `kanban`。

> ⚠️ 改显示名走 `psql UPDATE zenithjoy.db_fields SET name=...`：Sprint A/B 均未交付字段 UPDATE 端点（PRD `## 范围限定` 明写留 S4），这是**制造前置状态**而非绕过被测路径——被测的是「读视图时按不按 `field_id` 反查」，那条路径一行没被顶替。

**验证命令**:
```bash
V1=$(curl -sf -b "$COOKIE_A" "$API/tables/$TID/views" | jq -S '.data.views')
psql "$PG" -q -c "UPDATE zenithjoy.db_fields SET name = '改过名的单选' WHERE id = '$FS'"
V2=$(curl -sf -b "$COOKIE_A_NEW" "$API/tables/$TID/views" | jq -S '.data.views')
[ "$V1" = "$V2" ] || { echo "FAIL: 换会话/改显示名后视图不一致"; exit 1; }
printf '%s' "$V2" | jq -e --arg fs "$FS" '.[0].group_field_id==$fs and .[0].degraded==false'
```

**硬阈值**: 两次 `jq -S` 归一化后的 `views` 字符串全等；`degraded` 为 `false`

---

### Step 9: 删视图 —— 只删偏好、至少保留一个

**来源**: `[FROM_PRD]` — PRD `## 边界情况` 「删视图：至少保留一个视图，删到最后一个时拒绝并给可见提示；删视图只删偏好记录，`db_tables` / `db_fields` / `db_rows` 逐字不变」

**可观测行为**: 建 2 个视图后 `DELETE /views/:id` → 200 且 `remaining == 1`；三张数据表的行数与内容摘要**逐字未变**；再删最后一个 → **400 `LAST_VIEW_PROTECTED`**，该 prefs 行仍在。

**验证命令**:
```bash
SNAP0=$(psql "$PG" -t -A -q -c "SELECT md5(string_agg(x,'|')) FROM (SELECT t.id::text||t.name FROM zenithjoy.db_tables t WHERE t.org_id='$ORGA_TENANT_ID' UNION ALL SELECT f.id::text||f.name FROM zenithjoy.db_fields f WHERE f.org_id='$ORGA_TENANT_ID' UNION ALL SELECT r.id::text||r.data::text FROM zenithjoy.db_rows r WHERE r.org_id='$ORGA_TENANT_ID' ORDER BY 1) s(x)")
curl -sf -b "$COOKIE_A" -X DELETE "$API/views/$VID2" | jq -e '(.data|keys)==["deleted_view_id","remaining"] and .data.remaining==1'
SNAP1=$(psql "$PG" -t -A -q -c "…同上…")
[ "$SNAP0" = "$SNAP1" ] || { echo "FAIL: 删视图动了表/字段/行"; exit 1; }
C=$(curl -s -o /tmp/lv.json -w '%{http_code}' -b "$COOKIE_A" -X DELETE "$API/views/$VID")
[ "$C" = "400" ] || exit 1
jq -e '.error.code=="LAST_VIEW_PROTECTED"' < /tmp/lv.json >/dev/null
psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_view_prefs WHERE id = '$VID'" | grep -qx 1
```

**硬阈值**: `remaining` 数值正确；三表 md5 摘要前后全等；末个视图删除返 400 且行仍在

---

### Step 10: 视图偏好保存失败 → 可见提示，禁静默吞

**来源**: `[FROM_PRD]` — PRD `## 边界情况` 「保存失败 → 工具条出现「视图偏好未保存」可见提示（**禁静默吞异常**），本次会话内视图仍可用可重试」；上位合同 **A23**

**可观测行为**: 真浏览器真断网下改视图配置 → 工具条出现 `data-testid="view-prefs-error"` 且文案含「视图偏好未保存」；页面**不白屏**、当前视图仍可交互；恢复网络后就地重试成功。源码侧：视图保存的 `catch` 分支里**零空吞**（不许 `catch {}` / `catch { /* ignore */ }` / `.catch(() => {})`）。

**验证命令**:
```bash
# 源码守卫（可离线跑）：视图相关前端文件的 catch 块必须写状态或抛，不许空吞
node -e "const fs=require('fs');for(const f of ['apps/staff-hub/src/pages/WorkbenchTablePage.tsx','apps/staff-hub/src/components/WorkbenchViewSwitcher.tsx']){const c=fs.readFileSync(f,'utf8');if(/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(c))process.exit(1);if(/\.catch\(\s*\(\s*\)\s*=>\s*\{?\s*\}?\s*\)/.test(c))process.exit(1);}"
```
真浏览器侧断言见 `## E2E 验收`。

**硬阈值**: 源码零空 catch；真浏览器提示 `toBeVisible` 且文案含「视图偏好未保存」；页面主体 `workbench-table-page` 仍可见

---

### Step 11: 视图层跨组织正反双向 + 反查两分支（A22 / A34 第五层）

**来源**: `[FROM_PRD]` — PRD `## 边界情况` 「跨组织：以他组织身份读/写本表视图偏好 → 4xx 或空集，且本组织 prefs 前后逐字未变」+「反查两分支（合同 J6）」；上位合同 **A22** / **A34**（视图偏好是隔离五层的第五层）

**可观测行为**（`db_view_prefs` 是 `(org_id, table_id, member_id)` **三键**，隔离必须逐维立起来）:
- **反向 · org 维**：他企业会话（丙 `COOKIE_B`）对 A 企业的 `view_id` 做 `GET`/`PATCH`/`DELETE` → 一律 404 且响应体与随机不存在 uuid **md5 全等**；A 企业该 prefs 行 `prefs::text` 前后全等
- **反向 · member 维**：**同组织他人**（乙 `COOKIE_A2`，同 `org_id` 不同 `member_id`）对甲的 `view_id` 做 `GET`/`PATCH`/`DELETE` → **同样 404 同形**，且乙 `GET /tables/:id/views`（同一张表，乙自己有权访问）返回集合里**零命中**甲的 `view_id`——「我的视图被同事看到/改掉」正是这张表存在的理由；只守 org 维时，摘掉 `member_id` 条件的变异会被 `org_id` 替它挡住，那半边守卫是空的
- **正向对照（同一次运行内）**：A 企业本人（甲）四个视图端点全部 2xx 且拿到自己的数据（堵「一律 404」假绿）
- **分支①（已删字段 → 降级）**：把视图引用的字段行直接从 `db_fields` 删掉 → `GET /views` 返 **200**、该视图 `group_field_id == null`、`filters`/`sorts`/`hidden_field_ids` 里那个 id 被剔除、**`degraded == true`**；不是 5xx、不是空体
- **分支②（他企业 field_id → 404 同形）**：A 企业 `PATCH` 自己的视图但 `group_field_id` 传 B 企业真实存在的 field_id → **404 且体与随机 uuid 逐字节相同**

**验证命令**:
```bash
H(){ openssl dgst -md5 < "$1" | awk '{print $NF}'; }
RND=$(uuidgen | tr 'A-Z' 'a-z')
BEFORE=$(psql "$PG" -t -A -q -c "SELECT prefs::text FROM zenithjoy.db_view_prefs WHERE id = '$VID'")
curl -s -b "$COOKIE_B" -o /tmp/x1.json -w '%{http_code}' -X PATCH "$API/views/$VID" -H 'Content-Type: application/json' -d '{"name":"越权改名"}' > /tmp/x1.code
curl -s -b "$COOKIE_B" -o /tmp/x2.json -w '%{http_code}' -X PATCH "$API/views/$RND" -H 'Content-Type: application/json' -d '{"name":"越权改名"}' > /tmp/x2.code
[ "$(cat /tmp/x1.code)" = "404" ] && [ "$(cat /tmp/x2.code)" = "404" ] || exit 1
[ "$(H /tmp/x1.json)" = "$(H /tmp/x2.json)" ] || { echo "FAIL: 两个 404 体不同 —— 可比对字节分辨视图是否真实存在"; exit 1; }
[ "$BEFORE" = "$(psql "$PG" -t -A -q -c "SELECT prefs::text FROM zenithjoy.db_view_prefs WHERE id = '$VID'")" ] || exit 1
# 正向对照
curl -sf -b "$COOKIE_A" "$API/tables/$TID/views" | jq -e --arg v "$VID" '[.data.views[]|select(.view_id==$v)]|length==1'
# 分支①
psql "$PG" -q -c "DELETE FROM zenithjoy.db_fields WHERE id = '$FS'"
curl -sf -b "$COOKIE_A" "$API/tables/$TID/views" | jq -e --arg v "$VID" '.data.views[]|select(.view_id==$v)|.group_field_id==null and .degraded==true'
# 分支②
BFID=$(psql "$PG" -t -A -q -c "SELECT f.id::text FROM zenithjoy.db_fields f WHERE f.org_id = '$ORGB_TENANT_ID' AND f.field_type = 'single_select' LIMIT 1")
curl -s -b "$COOKIE_A" -o /tmp/x3.json -w '%{http_code}' -X PATCH "$API/views/$VID" -H 'Content-Type: application/json' -d "{\"group_field_id\":\"$BFID\"}" > /tmp/x3.code
[ "$(cat /tmp/x3.code)" = "404" ] && [ "$(H /tmp/x3.json)" = "$(H /tmp/x2.json)" ] || exit 1
```

**硬阈值**: 三个 404 体 md5 三方全等；A 企业 prefs 串前后全等；正向 2xx 同轮命中；分支① 200 + `degraded==true`；分支② 404 同形

---

### Step 12: GROUP BY / ORDER BY 白名单 —— 用户输入永不进标识符位（A25）

**来源**: `[FROM_PRD]` — PRD `## 边界情况` 「GROUP BY / ORDER BY 一律走 `field_id` → 内部列名白名单映射；传非白名单 `field_id` 或 `id; DROP TABLE` 之类原始 SQL 片段 → 4xx，用户输入永不进入标识符位」；上位合同 **A25**（**带变异证明的 proven-to-fire 12 条之一**）

**可观测行为**: 进 SQL 的**三个用户可控位逐个对抗**——① `field_id`（落 JSONB 键位）：`sort`/`filter`/`group_field_id` 三处传合法 UUID 但不属本表 → **404 同形**，传原始 SQL 片段（`id; DROP TABLE zenithjoy.db_rows; --`、`1) OR 1=1 --`、`data->>'x'`）→ **400 `VALIDATION_FAILED`** ② **`dir`（直接落 `ORDER BY … ASC|DESC` 关键字位，与 `field_id` 同属白名单面）**：合法 `field_id` + 坏 `dir`（`asc; DROP TABLE zenithjoy.db_rows; --`、`asc NULLS FIRST, 1`、`ASC--`）→ **400 `VALIDATION_FAILED`** ③ `op`（落比较运算符选择）：合法 `field_id` + 非白名单 `op` → **400**。全程零 5xx；`information_schema.tables WHERE table_schema='zenithjoy'` 清单前后**全等**；`db_rows` 行数不减。

**验证命令**:
```bash
T0=$(psql "$PG" -t -A -q -c "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'zenithjoy'")
R0=$(psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_rows")
# ① field_id 位（payload 用 jq -nc 构造，逐字保留 data->>'x' 里的引号）
for BAD in "id; DROP TABLE zenithjoy.db_rows; --" "1) OR 1=1 --" "data->>'x'"; do
  SP=$(jq -nc --arg f "$BAD" '[{field_id:$f,dir:"asc"}]')
  C=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" --get "$API/tables/$TID/rows" \
        --data-urlencode "sort=$SP")
  [ "$C" = "400" ] || { echo "FAIL: field_id 位 SQL 片段返 $C（应 400）"; exit 1; }
done
# ② dir 位（合法 field_id + 坏 dir，直接落 ORDER BY 关键字位）
for BADD in "asc; DROP TABLE zenithjoy.db_rows; --" "asc NULLS FIRST, 1" "ASC--"; do
  DP=$(jq -nc --arg f "$FT" --arg d "$BADD" '[{field_id:$f,dir:$d}]')
  C=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" --get "$API/tables/$TID/rows" \
        --data-urlencode "sort=$DP")
  [ "$C" = "400" ] || { echo "FAIL: dir 位 $BADD 返 $C（应 400）"; exit 1; }
done
C=$(curl -s -o /tmp/w.json -w '%{http_code}' -b "$COOKIE_A" --get "$API/tables/$TID/rows" \
      --data-urlencode "sort=[{\"field_id\":\"$RND\",\"dir\":\"asc\"}]")
[ "$C" = "404" ] || exit 1
T1=$(psql "$PG" -t -A -q -c "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'zenithjoy'")
[ "$T0" = "$T1" ] || { echo "FAIL: 表清单变了 —— 用户输入进了标识符位"; exit 1; }
[ "$R0" = "$(psql "$PG" -t -A -q -c "SELECT count(*) FROM zenithjoy.db_rows")" ] || exit 1
```

**硬阈值**: `field_id` 位与 `dir` 位的片段全 400 且 `error.code == "VALIDATION_FAILED"`、非白名单 `op` 400、跨表 UUID 全 404、零 5xx；`information_schema` 清单串全等；`db_rows` 总行数不减
**变异证明**: `A25-field-whitelist-off`（摘掉 `field_id` → 本表字段集的白名单校验）施加后 `--a25-only` 必须 `exit ≠ 0`

---

### Step 13: 「指派给我」全局视图（人员字段的归集出口）

**来源**: `[FROM_PRD]` — PRD `## 范围限定 · 在范围内` 「「指派给我」全局视图（人员字段的归集出口）」

**可观测行为**: `GET /assigned-to-me` 返回本组织**当前会话可见的全部表**里、任一 `person` 字段值 == 会话 memberId 的行；`items[]` keys 恰好四个；他企业同名值的行**零命中**；同组织他人的 `private` 表的行**零命中**（表级可见性延伸）。

**验证命令**:
```bash
curl -sf -b "$COOKIE_A" "$API/assigned-to-me" | jq -e --arg r "$RID" \
  '(.data|keys)==["items"] and ([.data.items[]|select(.row_id==$r)]|length==1)
   and ((.data.items[0]|keys)==["field_id","row_id","table_id","table_name"])'
# 反向：B 企业把自己的 person 格也写成 alice 的 openid，A 的结果里零命中
curl -sf -b "$COOKIE_A" "$API/assigned-to-me" | jq -e --arg b "$BROW" '[.data.items[]|select(.row_id==$b)]|length==0'
```

**硬阈值**: `data` keys 恰好 `["items"]`；item keys 恰好四个；自己的行命中 1 条；他企业行命中 0 条

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 视图偏好四端点（`GET/POST/PATCH/DELETE`）落 `db_view_prefs`；`GET /tables/:id/rows` 加 `filter`/`sort`（JSONB 路径查询 + `field_id` 白名单）；看板视图组件（dnd-kit，单选字段分组 + 未分组列 + 拖卡改值 + 失败弹回）；视图切换器 + 隐藏列；`GET /assigned-to-me` |
| **NFR（做得多好）** | | 单表 ≤ 5000 行内看板 client-side 分组（合同 J12，沿用 Sprint B 的 `row_limit` 下发，本刀不改）；筛排走 `db_rows` 既有 `idx_db_rows_table`，不新增索引；AG Grid 钉死 `32.2.1`（不跟 v33）；dnd-kit **精确版本锁定**（无 `^`/`~`） |
| **Invariant（永不违反）** | | ① `org_id`/`member_id` 只来自 `req.workbenchIdentity`，请求体/请求头一律不读 ② 用户输入永不进 SQL 标识符位（`field_id` 白名单 + 绑定参数） ③ 跨组织不可达与不存在**逐字节同形 404** ④ 拖卡写回禁 last-write-wins（复用 `version` 409） ⑤ 视图偏好保存失败禁静默吞 ⑥ 无运行时 DDL（`information_schema` 清单恒等） ⑦ ViewPrefs 只存 `field_id` 不存字段名 |
| **判定点（怎么知道）** | | 见下方「判定点登记表」 |
| **保质期（何时过期）** | | `db_view_prefs` 行随 `db_tables` 的 `ON DELETE CASCADE` 走（migration `:88-99` 已定，本刀不改）；表软删后其视图偏好**仍在物理行里**，表还原后视图一并回来——与 A9/A16「软删可还原」同口径。视图偏好本身**无 TTL**，不设过期（它是用户偏好不是数据） |
| **死亡告警（停了谁知道）** | | `e2e-knowledge-hub-path3.yml` 的 linux job（每个 PR）+ `smoke-baseline.txt` 棘轮（nightly）。视图端点全挂本刀新增的 `--a20/--a21/--a22/--a25/--a1-a3-views/--view-delete` 六段，任一段死 = CI 红。**无独立生产告警**（路③ 尚未上生产，PRD `## 范围限定` 未列），显式记账在 `## 未覆盖真实链路清单` |
| **失败语义（挂了怎么办）** | | 见下方「失败语义声明」 |
| **效果确认（已发≠已生效）** | | ① 视图保存：以 `PATCH /views/:id` 的 **200 响应体**为回执，前端拿它就地回填（不整表重拉）；非 2xx / 网络失败 → 工具条可见提示 + 本地状态保留可重试 ② 拖卡：以 `PATCH /rows/:id` 返回的**整行 + 递增后的 `version`** 为回执；拿不到（409/5xx/断网）→ 卡片弹回原列 + 可见提示，**绝不停在假位置**。两处都禁「乐观更新后不校验回执」 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ **JC1 分组字段合法类型的边界** | A. 仅 `single_select`；B. `single_select` + `multi_select`（PRD 假设）；C. 任意有限值域字段 | **A. 仅 `single_select`** | controller C2 裁定 + 上位合同 §6 A20 原文只批「按**单选**字段分组」；多选分列（一行出现在多列）与拖卡改值语义在合同里**未定义** | 选 B → 拖一张出现在多列的卡时「改哪个值」无定义，实现自行发挥 = **把用户的多选值悄悄改错**，且合同无断言可抓 |
| ⚠️ **JC2 视图引用的 `field_id` 失效时，读路径 vs 写路径怎么判** | A. 一律报错；B. 一律降级；C. **读降级 + 写 404 同形** | **C.** 读路径剔除失效引用并置 `degraded=true` 返 200；写路径传入不属本表的合法 UUID → 404 `notFoundBody()` 与随机 uuid 逐字节同形；非 UUID 形态 → 400 | 上位合同 J6 原文（已删字段降级 / 他企业 field_id 404）+ J5 反枚举统一 404；「非 UUID → 400」不泄露存在性，因为格式合法性客户端自己就能判 | 一律降级 → 越权探测无阻力（拿他企业 field id 试到不报错就知道存在）；一律报错 → 删个字段就把视图打成白屏 |
| **JC3 「未分组」列的归属判据** | A. 仅 `null`；B. `null` + 缺键；C. **`null` + 缺键 + 空串** | **C. 三者归一列** | JSONB 里「没写过这一格」是缺键、「清空过」是 `null`（`patchRow` 的 `clears` 走 `- $4::text[]` 删键）、粘贴导入可能落空串——三种形态都是「用户眼里的没值」 | 只判 `null` → 粘贴进来的空串行既不在任何选项列也不在未分组列，**卡片凭空消失**，用户以为数据丢了 |
| **JC4 「当前视图」存哪** | A. `prefs.is_active` 布尔；B. 单独一行记 active_view_id；C. 前端 localStorage | **A. `prefs.is_active`**，服务端保证同 `(table_id, member_id)` 至多一个 `true`（置一清余在同一事务内） | 复用既有三键 + JSONB，**零新增列零新增表**（concern C1）；localStorage 换设备就丢，违背「换个会话重进还是上次那个视图」 | 选 C → 换台电脑/换浏览器视图归零，PRD Golden Path 第 7 条当场失效且无痕迹 |
| ⚠️ **JC5 拖卡到底存没存上的判定点** | A. 乐观更新即认为成功；B. **以 `PATCH /rows/:id` 返回的整行 + 递增 `version` 为回执**；C. 拖完整表重拉 | **B.** 拿到 2xx 回执才落位；409/5xx/断网一律弹回原列 + 可见提示 | 上位合同 J2（禁静默覆盖）+ A24（失败必须弹回）；C 会把别人同时的改动一并盖掉，且掩盖失败 | 选 A → 卡片停在假位置，用户以为改好了，实际库里没变，**下次刷新才发现，且不知道何时丢的** |
| **JC6 视图列表为空时谁来建默认视图** | A. `GET` 里 create-if-missing；B. **前端在 `views` 为空时显式 `POST` 一个「默认视图」**；C. 建表时预建 | **B.** `GET` 保持纯读零副作用 | A 需要 `(table_id, member_id, name)` 唯一约束才幂等，而 `db_view_prefs` 上没有——并发两个标签页会落两行（**要加约束就得新 migration，违反 concern C1**）；C 要改 Sprint A 的建表代码 | 选 A 且不加约束 → 用户开两个标签页就多出一个视图，看起来像「系统自己冒出来的视图」，且删视图计数全乱 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 视图偏好保存请求非 2xx / 断网 | **不改本地视图状态**，工具条出现「视图偏好未保存」可见提示 | 是（`PATCH /views/:id` 是幂等覆盖写） | 本次会话内视图仍可用可重试；**禁静默吞、禁整表重拉掩盖** |
| 拖卡写回 409（并发） | 卡片弹回原列 + 「该行已被他人修改，你的改动未保存」 | 否（需带新 `version` 重试，由用户显式再拖） | 提供「重新读取该行」入口（复用 Sprint B 的 `rereadRow`） |
| 拖卡写回 5xx / 断网 | 卡片弹回原列 + 可见错误提示 | 是（同一 `version` 重发） | 同上 |
| 视图引用字段已删（读路径） | 200 + 剔除失效引用 + `degraded:true` | 是 | 前端出「视图引用的字段已失效，已降级为默认视图」提示，不白屏 |
| 视图引用他企业 field_id（写路径） | 404 `notFoundBody()` | 是 | 前端按通用错误文案，不区分「存在但无权」与「不存在」 |
| `db_view_prefs` 查询本身失败 | 503 `LEDGER_UNREACHABLE`（沿用 Sprint A 口径，**不吞成 403/空集**） | 是 | 前端出「账本暂时不可达」 |
| `db_audit` 写视图审计失败 | 只打日志，**不把已成功的视图写变成 5xx**（沿用 `auditBestEffort`） | 是 | 审计断链由 DoD 的「三种动作全部落 `db_audit`」条抓 |

### 输入对抗面

**N/A** —— 本刀无对外暴露 agent：全部端点挂 `workbenchAuthGuard`（必须持 better-auth 真会话），输入不进入任何 LLM prompt、不进入检索域（路③ 五表已在 A35 排除清单里）。用户可控输入（`filter.value` / 视图 `name` / 字段值）一律作为**绑定参数的数据值**处理，见 Step 12 的白名单与 `information_schema` 恒等断言。

---

## 真实调用方请求 shape

路③ 的真实调用方是 **staff-hub 浏览器**（不是设备 agent）。逐字摘自 `apps/staff-hub/src/lib/knowledgeFetch.ts:25-31` 与 `workbenchFetch.ts:112`：

```ts
// knowledgeFetch.ts:25 —— 真实发出的请求就是这个形状
export function knowledgeFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: HeadersInit = {
    ...(init?.headers ?? {}),
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
  };
  return fetch(url, { ...init, credentials: 'include', headers });   // ← 认证唯一凭据 = cookie
}
```

- **认证**：`credentials:'include'` 的**会话 cookie**，**零身份头**（一个 `X-*` 都不拼）
- **Content-Type**：仅在有 body 时为 `application/json`
- **路径**：`WORKBENCH_BASE = '/api/knowledge/db'` + 子路径（`workbenchFetch.ts:12`）
- **响应解析**：`knowledgeJson` 读 `{success, data, error:{code,message}}`；`!res.ok || !body.success` → 抛 `KnowledgeRequestError(status, code, message)`

**本合同全部 DoD 断言逐字段与之一致**：一律 `curl -b "$COOKIE_X"`（真 cookie）、写请求带 `-H 'Content-Type: application/json'`、断言读 `.data.*` 与 `.error.code`。**禁止**出现「DoD 用 header 传身份、生产调用方走 cookie」这类双路径分叉——除 INV-1 的**负向**断言（故意塞 `X-Tenant-Id` + `body.org_id` 证明服务端不看），那是反向证明不是正路。

---

## 禁 mock 边清单

- `routes/workbench.ts` ↔ `services/workbench-views.service.ts`（本单新增的调用边：路由把 `req.workbenchIdentity` 交给 service，测试必须真调 service，禁 `vi.mock` 顶替）
- 代码 ↔ `zenithjoy.db_view_prefs`（本单**首次**写路径：INSERT / UPDATE / DELETE，测试必须真 Postgres 验行落库与 `org_id`/`member_id` 归属）
- 代码 ↔ `zenithjoy.db_audit`（视图三动作审计写入，真表验行）
- 代码 ↔ `zenithjoy.db_rows` / `zenithjoy.db_fields`（筛排 JSONB 路径查询 + `field_id` 白名单反查，真 PG 才照得出「数字字段被按字典序排」这类 bug）
- `routes/workbench.ts` ↔ `middleware/workbench-auth.ts`（既有闸，测试走真 `/api/staff/feishu-login` 签的真 cookie，禁伪造 cookie 串）
- `apps/staff-hub` 前端 ↔ 真 `apps/api`（E2E **禁 `page.route` / `context.route` / `fulfill(`**，沿用 Sprint B 变体C 死规则）
- 看板拖拽 ↔ dnd-kit 真库（禁自造 `fireEvent` 假拖拽冒充 —— 真浏览器段必须真发指针事件序列）

**唯一允许 mock 的边**：飞书 OAuth 上游（`FEISHU_API_BASE` 指向本地假上游，属环境端点重定向，Sprint A/B 既有）。

---

## 接缝清单（**未在真目标转绿前一律标 `logic-done-pending`，不得标 `done`**）

| 接缝 | 碰真实世界在哪 | 真目标验证方式 |
|---|---|---|
| **S3-1 dnd-kit 指针拖拽语义** | 真浏览器的 PointerEvent 序列 + dnd-kit `PointerSensor` 的 activation constraint；headless 下鼠标步进不够会「按下就松开」不触发拖拽 | windows job 真浏览器：`mouse.move(源卡中心)` → `mouse.down()` → **≥10 步** `mouse.move` 至目标列中心 → `mouse.up()`，断言目标列卡片数 +1 且库中该行分组值已变 |
| **S3-2 视图偏好保存失败的可见提示** | 真网络失败（`context.setOffline(true)`）+ React 错误态 | windows job 真浏览器：断网改视图 → `view-prefs-error` `toBeVisible` 且文案含「视图偏好未保存」→ 恢复网络就地重试成功 |
| **S3-3 看板分列渲染 + 卡片弹回（两条失败分支）** | 真浏览器 DOM 重排：失败后卡片必须回到**原列**而不是停在目标列或消失；且**断网（fetch reject）与 409（`res.ok===false`）在前端是两条不同分支**，只验一条会放过另一条 | windows job：拖前记录两列卡片数 →（a）断网拖 → 断言卡片数**逐字复原** + `kanban-drop-error` 可见；（b）第二份真会话先 PATCH 顶掉 `version` 再拖同一张卡 → 断言卡片数**逐字复原** + `kanban-drop-conflict` 可见且文案含「该行已被他人修改，你的改动未保存」 |
| **S3-5 未分组三态在真浏览器的落列（JC3）** | 「用户眼里的没值」在 JSONB 里有三种物理形态（`null` / 缺键 / 空串），只判 `null` 时另两态的卡片在真页面上**凭空消失**——纯函数单测能抓逻辑，抓不到「渲染时又按值过滤了一道」 | windows job：未分组列 `getByTestId(/^kanban-card-/)` `toHaveCount(3)`，三态各一张 |
| **S3-4 JSONB 筛排在真 Postgres 的排序语义** | `ORDER BY r.data -> $n` 的 jsonb 比较是**数值序**，而 `->>` 是文本序——差一个箭头就把 `10` 排到 `9` 前面 | linux job 真 Postgres：数字字段升序结果逐字为 `[2,9,10]`（写死 `[2,9,10]` 是**期望输出**不是环境假设值） |

---

## 未覆盖真实链路清单

| 被 mock/顶替的真实链路点 | 为什么 | 真验证补位计划 |
|---|---|---|
| 飞书 OAuth 上游（`FEISHU_API_BASE` → 本地假上游 `_smoke-fake-feishu`） | 真飞书 OAuth 无法在 CI 无人值守完成；且这是 Sprint A 既定的既有夹具，本刀不动它 | 已在 Sprint A/B 合同登记；真飞书登录由 staff-hub 生产上线时人验 |
| 「字段被删」这一前置状态用 `psql DELETE FROM db_fields` 制造 | Sprint A/B **均未交付字段 DELETE 端点**（PRD `## 范围限定` 明写留 S4），没有可调的产品路径 | Sprint D 交付 A30③「删字段 = 软删元数据 + 值保留」后，把本刀 A22① 的前置改成真调删字段端点 |
| 「改字段显示名」用 `psql UPDATE db_fields SET name` 制造 | 同上：字段 UPDATE 端点留 S4 | 同上 |
| 生产环境告警：路③尚未上生产，无生产侧「视图端点死了谁知道」 | PRD `## 范围限定` 未列生产上线 | 路③ 整体上生产时统一接告警，记 P2 |
| **A26「视图组件独立挂载」零断言** | controller concern C3 明令本刀标结构预留、不实装 | **到期口（必须补挂，否则 A26 会在 close_conditions 里悬空）**：以「路② 页面内嵌 database 交付」与「路③ Sprint D 收口」**两者中较早的那一刀**为期限，补一条组件测试（在不带 router 的容器里挂载 `WorkbenchKanbanView` 并渲染一张表）。上位合同 §8 把 A26 列在 Sprint C 门禁里，本刀只是**延期不是豁免**；Sprint D 的 close_conditions 必须显式检查这一条已补挂 |
| 「未分组三态」中的 `null` 与空串两态用 `psql jsonb_set` 直接写库制造 | 产品路径造不出：`PATCH /rows/:id` 传 `null` 走 `clears` 分支（`workbench-rows.service.ts:398` 的 `data - $4::text[]`）会**删键**而不是写 JSON null；空串则被 `parseCellInput` 归一成 `null`。两态在生产里由粘贴导入/历史行产生 | **被测的分列代码路径一行没被顶替**（顶替的只是「这一行怎么变成那个形态」）。Sprint D 若交付粘贴的空串直落路径，把前置改成真调 paste 端点 |
| 5000 行满载下看板 client-side 分组的性能 | 真插 5000 行会烧光 windows job 预算（Sprint B 已就同一理由登记过） | 沿用 Sprint B 口径：上限闸由 `WORKBENCH_ROW_LIMIT` 小值证明，满载性能不在本刀门禁 |

**本刀 DoD 与 tests/ 中零 `force_*` 标志、零 `MOCK_*` 环境变量、零 `--dry-run`。**

---

## 本刀显式不实装（concern C3 记账）

- **A26**（视图组件可独立挂载渲染）：**零门禁断言**。仅保留一条 **ARTIFACT 级弱约束**——看板视图组件 `WorkbenchKanbanView.tsx` 的 props 完备（`fields` / `rows` / `groupFieldId` / `onCardMoved`），源码内**不出现 `useParams` / `useNavigate`**（不依赖路由上下文即可挂载）。该条不构成 A26 的通过判据，仅防止本刀写出一个必须靠路由才能活的组件、让路②返工。**到期口**：以「路② 页面内嵌 database 交付」与「路③ Sprint D 收口」两者中较早的那一刀为限必须补挂组件测试——**这是延期不是豁免**，Sprint D 的 close_conditions 须显式检查（详见 `## 未覆盖真实链路清单` 该行）。
- **日历/画廊视图、跨表关联、公式/rollup、CSV 导出、字段类型变更、行级权限、附件字段、多人实时协同、对外 API、服务端行模型、AG Grid v33 升级、表改名与改可见性、字段 UPDATE/DELETE 端点**：PRD `## 范围限定 · 不在范围内` 逐条，本刀零交付零断言。

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud
**接线**：不新建 workflow。沿用 `.github/workflows/e2e-knowledge-hub-path3.yml` —— linux job 增本刀六段 flag + `test:workbench-views`；windows job（**A33(c)：不许加 job 级 `if`**）增两个 step 调 `sprints/08210012-workbench-sprintC-views/e2e-views-run.ps1`，并增本刀截图的 upload step。

> 下面这个 bash 块是 **evaluator 模式B 的 final-e2e**：真浏览器跑在 GitHub Actions windows-latest 上（ZenithJoy UI 死规则），本地无从复现，所以判据 = **那个 windows job 的 conclusion + 本刀两个 step 各自 conclusion + 从 artifact 真取回本轮截图**（不认宿主机上手工塞的图）。PowerShell 与 Playwright 段见其后的非 bash 代码块，是 generator 要写出的交付物规格。

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
  || { echo "FAIL: 陈旧 run（headSha=$(echo "$R" | jq -r '.[0].headSha') != HEAD=$(git rev-parse HEAD)）"; exit 1; }

J=$(gh run view "$ID" --json jobs)

# 1. windows job 必须 success（skipped / cancelled 一律 FAIL —— 那正是 A33(c) 要堵的孤儿形态）
echo "$J" | jq -e '[.jobs[] | select(.name | test("windows")) | select(.conclusion == "success")] | length > 0' >/dev/null \
  || { echo "FAIL: windows job 未成功"; echo "$J" | jq -r '.jobs[] | "  job=\(.name) conclusion=\(.conclusion)"'; exit 1; }

# 2. 本刀两个真浏览器 step 逐个 success（job 绿但本刀 step 没跑 = 假绿）
for S in "看板拖卡" "视图偏好"; do
  echo "$J" | jq -e --arg s "$S" \
    '[.jobs[] | select(.name | test("windows")) | .steps[] | select(.name | test($s)) | select(.conclusion == "success")] | length > 0' >/dev/null \
    || { echo "FAIL: windows job 里没有跑「$S」那一段"; echo "$J" | jq -r '[.jobs[] | select(.name | test("windows")) | .steps[].name] | @csv'; exit 1; }
done

# 3. linux job 必须 success（筛排真 PG 段与六个 smoke 段在那里）
echo "$J" | jq -e '[.jobs[] | select(.name | test("linux")) | select(.conclusion == "success")] | length > 0' >/dev/null \
  || { echo "FAIL: linux job 未成功"; exit 1; }

# 4. 截图从 artifact 真取回（≥6 张、全部非空），落进 sprint 目录
D=$(mktemp -d)
gh run download "$ID" -n path3-views-screenshots -D "$D" \
  || { echo "FAIL: 下不到本刀截图 artifact path3-views-screenshots"; exit 1; }
N=$(find "$D" -name '*.png' | wc -l | tr -d ' ')
[ "$N" -ge 6 ] || { echo "FAIL: artifact 里只有 $N 张截图（需 >=6）"; exit 1; }
for f in $(find "$D" -name '*.png'); do
  [ -s "$f" ] || { echo "FAIL: 空截图 $f"; exit 1; }
done
DST=sprints/08210012-workbench-sprintC-views/screenshots
mkdir -p "$DST"
find "$D" -name '*.png' -exec cp {} "$DST"/ \;

echo "OK: S3 Golden Path 真浏览器全链通过，截图 $N 张已落 $DST"
```

### 交付物规格 A：`sprints/08210012-workbench-sprintC-views/e2e-views-run.ps1`

```powershell
# 路③ Sprint C —— windows_cloud 视图链 E2E：一个 step 一次自持全跑
# 沿用 Sprint B 的 e2e-rows-lib.ps1（Set-DbEnvFromUrl / New-TwoTenantSeed / Start-Api /
# Get-SessionCookie / Start-Hub / Stop-Procs / Invoke-Checked），一行不抄、直接 dot-source。
param(
  [Parameter(Mandatory = $true)][string]$Grep,
  [string]$Spec = "structured-workbench-views.spec.ts"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$ShotDir   = Join-Path $scriptDir "screenshots"
$ScriptStart = Get-Date

$ApiPort = if ($env:PATH3_VIEWS_API_PORT) { [int]$env:PATH3_VIEWS_API_PORT } else { 5211 }
$HubPort = if ($env:PATH3_VIEWS_HUB_PORT) { [int]$env:PATH3_VIEWS_HUB_PORT } else { 5178 }

if (-not $env:E2E_DATABASE_URL) { throw "FAIL: 未注入 E2E_DATABASE_URL，拒绝跑成假绿" }
New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null
. "$repoRoot\sprints\08201850-workbench-sprintB-rows\e2e-rows-lib.ps1"

Set-DbEnvFromUrl $env:E2E_DATABASE_URL
$seed = New-TwoTenantSeed $ApiPort
$api = $null; $hub = $null
try {
  $api = Start-Api $repoRoot $ApiPort
  # 甲乙是同组织两个真身份：并发拖同一张卡那段要两份真 cookie
  $env:E2E_VIEWS_COOKIE  = Get-SessionCookie $ApiPort $seed.Alice
  $env:E2E_VIEWS_COOKIE2 = Get-SessionCookie $ApiPort $seed.Bob
  $hub = Start-Hub $repoRoot $HubPort $ApiPort
  $env:E2E_BASE_URL = "http://localhost:$HubPort"
  Invoke-Checked "npx.cmd" "playwright test $Spec --grep $Grep --reporter=list" `
    "$repoRoot\apps\staff-hub" "staff-hub 路③ S3 视图链 E2E ($Spec / $Grep)"
} finally { Stop-Procs @($api, $hub) }

# 防历史产物冒充：本轮截图 LastWriteTime 必须 >= $ScriptStart.AddMinutes(-1)，
# 一张新图都没有即 throw（形态逐字沿用 e2e-rows-run.ps1 结尾那段，不重写）
exit 0
```

### 交付物规格 B：`apps/staff-hub/e2e/structured-workbench-views.spec.ts`

```ts
// 变体C 死规则：禁 page.route / context.route / fulfill —— 全部请求打真 apps/api + 真 Postgres。
// 断网那段用 context.setOffline(true)（真实网络条件，不是伪造响应）。
// 两个 ASCII 标签对应 workflow 两个 step：@views-kanban / @views-prefs
//
// @views-kanban —— 切看板 / 分列 / 未分组三态 / 指针拖卡换列 / 断网弹回 / 并发 409 弹回 → 截图 01 02 03 06
// @views-prefs  —— 筛排四件套 / 隐藏列 / 换会话逐项一致 / 断网保存失败提示 / 删视图 → 截图 04 05

test('@views-kanban 看板拖卡换列并落库', async ({ page, context }) => {
  // …建表 + 建视图（真 API，带真 cookie）+ 四行：有值「甲」/ null / 缺键 / 空串…
  // null 与空串两态经 API 造不出（PATCH null 会清键），由 seed SQL 直接写 jsonb，
  // 被测的分列代码路径一行没被顶替（已在「未覆盖真实链路清单」登记为前置状态制造）
  await page.getByTestId('view-switcher-kanban').click();
  await page.getByTestId('group-field-select').selectOption(singleSelectFieldId);
  await expect(page.getByTestId('kanban-column-甲')).toBeVisible();
  await expect(page.getByTestId('kanban-column-__ungrouped__')).toBeVisible();
  // JC3 三态：null / 缺键 / 空串三张卡全在未分组列，只验一态等于放过「卡片凭空消失」
  await expect(page.getByTestId('kanban-column-__ungrouped__').getByTestId(/^kanban-card-/)).toHaveCount(3);
  await page.screenshot({ path: shot('01-kanban-columns.png') });

  // 真指针拖拽：dnd-kit PointerSensor 需要按下后走过 activation distance 才激活，
  // 一步到位的 move 会被当成点击 —— steps 必须 >= 10
  const card = page.getByTestId(`kanban-card-${rowId}`);
  const target = page.getByTestId('kanban-column-乙');
  const c = await card.boundingBox(); const t = await target.boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + 40, { steps: 20 });
  await page.mouse.up();

  await expect(page.getByTestId('kanban-column-乙').getByTestId(`kanban-card-${rowId}`)).toBeVisible();
  await page.screenshot({ path: shot('02-kanban-dragged.png') });
  // 交叉验证后端（防前端撒谎）：库中该行分组值已变，且 version +1
  const after = await api.get(`${BASE_URL}${DB_BASE}/tables/${tableId}/rows`);
  expect(rowOf(after, rowId).data[singleSelectFieldId]).toBe('乙');

  // 刷新后仍在新列
  await page.reload();
  await expect(page.getByTestId('kanban-column-乙').getByTestId(`kanban-card-${rowId}`)).toBeVisible();

  // 失败弹回：真断网拖回「甲」列 → 卡片必须回到「乙」列 + 可见错误
  const beforeB = await page.getByTestId('kanban-column-乙').getByTestId(/^kanban-card-/).count();
  await context.setOffline(true);
  /* …同一套指针序列拖向「甲」列… */
  await expect(page.getByTestId('kanban-drop-error')).toBeVisible();
  await expect(page.getByTestId('kanban-column-乙').getByTestId(/^kanban-card-/)).toHaveCount(beforeB);
  await context.setOffline(false);
  await page.screenshot({ path: shot('03-kanban-revert.png') });

  // 并发 409 弹回（上位合同 A24 第三段）——与断网是**两条不同前端分支**：
  // 断网是 fetch reject，409 是 res.ok===false 走 KnowledgeRequestError，只验断网等于放过 409 分支。
  // 用第二份真会话 cookie（同组织的乙）真 PATCH 该行把 version 顶掉，页面手上的基线就过期了。
  await api2.patch(`${BASE_URL}${DB_BASE}/rows/${rowId}`, {
    data: { version: currentVersion, data: { [singleSelectFieldId]: '甲' } },
  });
  const beforeConflict = await page.getByTestId('kanban-column-甲').getByTestId(/^kanban-card-/).count();
  /* …同一套指针序列把那张卡拖向另一列… */
  await expect(page.getByTestId('kanban-drop-conflict')).toBeVisible();
  await expect(page.getByTestId('kanban-drop-conflict')).toContainText('该行已被他人修改，你的改动未保存');
  await expect(page.getByTestId('kanban-column-甲').getByTestId(/^kanban-card-/)).toHaveCount(beforeConflict);
  await page.screenshot({ path: shot('06-kanban-conflict.png') });
});

test('@views-prefs 筛排隐藏列持久化与保存失败可见', async ({ page, context }) => {
  // 筛 + 排 + 隐藏列 → 断言表格行集合与顺序 → 截图 04
  await expect(page.getByTestId('row-grid')).toContainText('甲一');
  await expect(page.getByTestId(`grid-col-${hiddenFieldId}`)).toHaveCount(0);
  await page.screenshot({ path: shot('04-grid-filter-sort.png') });

  // 断网改视图 → 「视图偏好未保存」可见，页面不白屏
  await context.setOffline(true);
  await page.getByTestId('view-switcher-kanban').click();
  await expect(page.getByTestId('view-prefs-error')).toBeVisible();
  await expect(page.getByTestId('view-prefs-error')).toContainText('视图偏好未保存');
  await expect(page.getByTestId('workbench-table-page')).toBeVisible();
  await context.setOffline(false);
  await page.screenshot({ path: shot('05-view-prefs-error.png') });

  // 换会话（新 context + 第二份真 cookie 属同一员工的另一次登录）重进 → 逐项一致
});
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（**必须是 `it()` 名的字面子串**） | 预期红证据 |
|---|---|---|---|
| 视图 CRUD + 默认形状 + 至少保留一个 | `tests/views-crud.test.ts` | `建视图返 201 且 keys 恰好十个`；`GET views 纯读零写入副作用`；`删视图只删偏好三表逐字不变`；`删到最后一个视图返 400` | → 4 failures |
| 分组字段类型闸（concern C2）+ 未分组三态（JC3） | `tests/views-group-type.test.ts` | `七类非单选字段做分组一律 400`；`single_select 做分组正向 200`；`400 时视图 prefs 逐字未变`；`未分组三态：null 缺键 空串三行全归未分组列` | → 4 failures |
| 筛排 + `field_id`/`dir` 白名单（A20 / A25） | `tests/views-filter-sort.test.ts` | `按文本字段筛返回集合完全一致`；`按数字字段排是数值序不是字典序`；`不传参数时响应与 Sprint B 逐字相同`；`原始 SQL 片段返 400 且表清单未变`；`跨表 field_id 返 404 同形` | → 5 failures |
| 隔离（org + member 两维）+ 反查两分支 + 审计（A21 / A22 / A34） | `tests/views-isolation-degrade.test.ts` | `他企业会话读改删视图一律 404 同形`；`同组织他人读改删本人视图一律 404 同形`；`本组织正向拿到自己的视图`；`已删字段的视图降级且 degraded 为 true`；`他企业 field_id 写入返 404 同形`；`prefs 存 field_id 而非字段名`；`视图三动作全部落 db_audit` | → 7 failures |

**红证据落 `red-evidence.md`**（generator commit-1 产出）：4 文件 / ≥20 用例 / 全红，理由 = 视图端点族与 `filter`/`sort` 参数在 `origin/main` 上都不存在。

**收集配置**（generator 交付）：`apps/api/vitest.workbench-views.config.ts`（include 逐字 `../../sprints/08210012-workbench-sprintC-views/tests/**/*.test.ts`，`singleFork` + 非并发 + `setupFiles: ./vitest.workbench-views.setup.ts`）+ `apps/api/package.json` 加 `test:workbench-views`。**理由与 Sprint B 同**：这批是 supertest + 真 PG，塞进默认 `vitest.config.ts` 会把无 Postgres 的 `ci-l4-runtime.yml` `api-test` job 打红。

---

## smoke 新增段与变异开关（generator 必须登记进 `structured-workbench-smoke.sh`）

| 新段 flag | 覆盖 | 对应上位断言 |
|---|---|---|
| `--a20-only` | 筛/排/分组/切视图四件套 + 分组类型闸七类 400 + 正向 200 + **真跑「未分组三态」纯函数用例**（`npx vitest run --config vitest.workbench-views.config.ts -t 未分组三态`） | A20 |
| `--a21-only` | 视图偏好持久 + 存 `field_id` 非字段名 + 改显示名视图不失效 | A21 |
| `--a22-only` | 反查两分支（已删字段降级 / 他企业 field_id 404 同形） | A22 |
| `--a25-only` | 白名单三位：`field_id` 片段 400 / **`dir` 片段 400** / 非白名单 `op` 400 / 跨表 UUID 404 / `information_schema` 恒等 | A25 |
| `--a1-a3-views-only` | 视图层隔离**三层成对**：他企业反向 404 + **同组织他人反向 404 同形** + 本人正向 2xx（隔离第五层，`org_id`/`member_id` 两维各自可被变异打红） | A34 |
| `--view-delete-only` | 删视图只删偏好 + 至少保留一个 | PRD 边界 |

| 变异开关 | 改什么 | 判据（**外置**） |
|---|---|---|
| `A25-field-whitelist-off` | 摘掉 `field_id` → 本表字段集的白名单校验 | `--a25-only` `exit ≠ 0` |
| `A20-group-type-nocheck` | 摘掉分组字段 `field_type === 'single_select'` 判断 | `--a20-only` `exit ≠ 0` |
| `A1V-view-org-bypass` | 视图 SQL **只**去掉 `org_id` 条件 | `--a1-a3-views-only` `exit ≠ 0` |
| `A1V-view-member-bypass` | 视图 SQL **只**去掉 `member_id` 条件（拆成两个开关的理由：合成一个时，摘 member 那半边会被 `org_id` 替它挡住，跨企业段照样绿 = 半边不是 proven-to-fire） | `--a1-a3-views-only` `exit ≠ 0` |
| `VIEW-lastview-off` | 摘掉「至少保留一个视图」判断 | `--view-delete-only` `exit ≠ 0` |
| `A24-drag-wrong-row` | `resolveDropPatch` 改成恒返 `rows[0]` | `--a24-pure-only`（跑 staff-hub 那个单测）`exit ≠ 0` |
| `A20-ungrouped-null-only` | `groupRowsByField` 的未分组判据从三态改成**只判 `null`**（缺键与空串的卡片凭空消失） | `--a20-only` `exit ≠ 0` |

**变异协议沿用 Sprint A/B**：`--mutation-apply` 只改代码、零判定、不打印 `proven-to-fire`；判据一律是「被守卫的那一段自己 `exit ≠ 0`」。

---

## contract-gate

`packages/brain/src/lib/contract-gate.js` 在本 repo（zenithjoy-workspace）不存在 →
`contract-gate: skipped (file not found, third-party repo)`。本合同按 skill 内置规则自审（惯用法速查表 + 自查 checklist + Step 2b-check 确定性脚本）。

---

## r1 逐条回应（GAN Round 2）

> 反馈原文：`.harness/feedback-sc-r1.md`（VERDICT REVISION，P0×3 / P1×4 / P2×3）。逐条**核销**或带证据 **REFUTE**。
> reviewer 点名「不要动」的六项（Response Schema 推导段 10 keys + 14 禁用字段 / 404 md5 三方全等 / `information_schema` 恒等 / 五变异判据外置 / windows 三段判据 / `--reporter=json` 锁收集数）**一处未改**；三条 concern 裁定（`db_view_prefs` 复用 / 仅单选分组 / A26 结构预留）与 GP-Anchor `#step3` 保持不变。

| # | 反馈 | 处置 | 落点 / 证据 |
|---|---|---|---|
| **P0-1** | JC3 未分组三态零有效断言（psql 重言 / `node -e require .ts` no-op / ART-8 `??` 近恒真 / E2E 只验一态），且正文「三态」与命令「两行」自相矛盾 | **核销（按建议 a + c，并顺手做了 b）** | (a) `views-group-type.test.ts` 新增 `it('未分组三态：null 缺键 空串三行全归未分组列，有值行归其选项列')`——动态 import `groupRowsByField`，断言列序 `['甲','乙','__ungrouped__']`、每列 `row_ids` 逐字、每行恰出现一次；新增变异 `A20-ungrouped-null-only`（三态改回只判 `null`）判据外置到 `--a20-only exit≠0`（DoD 新增一条 BEHAVIOR）。(b) DoD Step3 **删掉那条 psql 重言与 no-op `node -e`**，改为造**四行**（有值/`null`/**缺键**/空串）+ psql **逐态点名**核对（`data -> fid = $$null$$::jsonb` / `NOT (data ? fid)` / `char_length(data ->> fid)=0` 各恰 1 行，标注为前置自检）+ **真跑产品代码**（`npx vitest -t 未分组三态 --reporter=json`，断言 `numPassedTests>=1 且 numFailedTests==0 且 success==true`，零收集时 vitest 自己非 0）。(c) E2E 未分组列 `toHaveCount(1)` → **`toHaveCount(3)`**，写进 `01-kanban-columns.png` 截图期望与 ART-11 逐字清单；新增接缝 **S3-5**。正文与命令已同步（P1-4 一并核销）。**`null` 与空串两态经 API 造不出**（`patchRow` 的 `null` 走 `clears` 删键、`parseCellInput` 把空串归一成 `null`），改由 seed SQL 制造，已进 `## 未覆盖真实链路清单` 并写明「被测的分列路径一行没被顶替」 |
| **P0-2** | A22① 降级 jq 是恒红死断言（`\|` 优先级低于 `and`，喂理想 JSON 实测 `exit=5`） | **核销** | 改为 `(.data.views \| map(select(.view_id==$v)) \| length) == 1 and (.data.views[] \| select(...) \| ...)`。**从 contract-dod.md 原文提取该 jq 程序**后正反双跑：理想 JSON `exit=0`／`degraded:false` JSON `exit=1`／未降级（`group_field_id` 还在、`sorts` 未剔）JSON `exit=1`。旧写法在同一份理想 JSON 上复现 `jq: error … Cannot index array with string "data"`，`exit=5` —— 反馈属实 |
| **P0-3** | `db_view_prefs` 三键但 member 维零断言，`A1V-view-org-bypass` 半边不是 proven-to-fire | **核销（两条修法都做）** | ① `--a1-a3-views-only` 扩成**三层同一次运行内成对**：他企业（丙 `COOKIE_B`）反向 404 md5 全等 + **同组织他人（乙 `COOKIE_A2`）反向 404 同形且 `GET views` 列表零命中甲的 `view_id`** + 本人（甲）四端点正向 2xx（Golden Path Step 11 正文与 DoD 同步改）② 变异**拆成两个开关**：`A1V-view-org-bypass`（只摘 `org_id`）与 `A1V-view-member-bypass`（只摘 `member_id`），DoD 一条 BEHAVIOR 里**逐个** apply→跑段→revert，两次都必须 `exit≠0` ③ `views-isolation-degrade.test.ts` 新增 `it('同组织他人读改删本人视图一律 404 同形，且列表里零命中')`（含「乙对这张表本身有权访问 → 列表应 200 而不是 404」这条正向锚，防止把 member 维做成表级拒绝）。Step0 阈值同步 `>=18` → **`>=20`**，Test Contract 表与 red-evidence 口径一并上调 |
| **P1-1** | `dir` 落 `ORDER BY` 方向位，零对抗断言 | **核销** | DoD Step12 由「`field_id` 一轮」扩成**标识符位三处全对抗**：① `field_id` 位三个 SQL 片段（`sort`+`filter` 各一遍）② **`dir` 位**（合法 `field_id` + `asc; DROP TABLE zenithjoy.db_rows; --` / `asc NULLS FIRST, 1` / `ASC--`）→ 一律 400 且 `error.code=="VALIDATION_FAILED"` ③ 非白名单 `op` → 400。`views-filter-sort.test.ts` 加 `BAD_DIRS` 常量与对应断言轮；Golden Path Step 12 的 `可观测行为`/`硬阈值`/验证命令同步 |
| **P1-2** | A24 第三段「双人拖同卡 → 409 并弹回」浏览器层零断言且未记账 | **核销（选 a，不走记账豁免）** | `@views-kanban` 补一段：第二份真会话（乙 `COOKIE_A2`）先真 `PATCH` 顶掉 `version`，再在页面里拖同一张卡 → 断言 `kanban-drop-conflict` 可见、`toContainText('该行已被他人修改，你的改动未保存')`、原列卡片数**逐字复原**；新增截图 `06-kanban-conflict.png`，E2E 截图门槛 `>=5` → **`>=6`**；testid 与文案进 ART-11 逐字清单；Golden Path Step 6 正文改成「**两条前端分支各验一次**」并点名 `knowledgeFetch.ts:38-47` 的分叉处；接缝 **S3-3** 改名为「两条失败分支」并写明各自判据 |
| **P1-3** | 四条 `gh run list --limit 1` 未钉 `headSha`，陈旧 run 可冒充本轮 | **核销** | DoD 四条（Step5 / Step6 断网 / Step10 / BEHAVIOR:E2E）与 draft `## E2E 验收` 的 bash 块**全部**改为 `--json databaseId,headSha[,url]` + `[ "$(echo "$R" \| jq -r '.[0].headSha')" = "$(git rev-parse HEAD)" ] \|\| fail`；`grep -c headSha contract-dod.md` = 4 |
| **P1-4** | Step3 正文与命令自相矛盾 | **核销** | 见 P0-1（正文改「四行 / 三态逐态点名」，命令同步造第三态「缺键」行） |
| **P2-1** | draft `data->>'x'` vs dod `data->>x` 不一致 | **核销** | DoD 改用 `jq -nc --arg` 构造 payload，**逐字保留** `data->>'x'`；已实跑确认输出 `[{"field_id":"data->>'x'","dir":"asc"}]`；draft 的验证命令块同步改成 `jq -nc` |
| **P2-2** | 夹具导出清单漏列 `BOB_OPENID` / `CAROL_OPENID` | **核销** | DoD 抬头补全为「`API_PORT`/`SFX`/`ORGA_TENANT_ID`/`ORGB_TENANT_ID`/`COOKIE_A`(甲)/`COOKIE_A2`(乙，同组织他人)/`COOKIE_B`(丙，他企业)/`ALICE_OPENID`/`BOB_OPENID`/`CAROL_OPENID`/`EIGHT_FIELDS`」并标注来源行号 |
| **P2-3** | A26 记账需补到期口 | **核销** | `## 未覆盖真实链路清单` 与 `## 本刀显式不实装` 两处各补：以「路② 页面内嵌 database 交付」与「路③ Sprint D 收口」**较早的那一刀**为限必须补挂组件测试，**延期不是豁免**，Sprint D 的 close_conditions 须显式检查该条已补挂 |

**Round 2 交付前自查（按反馈第 157-163 行照跑）**

1. **P0-2 正反双跑**：从 `contract-dod.md` 原文提取 jq → 理想 JSON `exit=0`、`degraded:false` `exit=1`、未降级 `exit=1`；旧写法同一份理想 JSON `exit=5`（`Cannot index array with string "data"`）。
2. **新增断言在 `origin/main` 上是红的**：`git cat-file -e origin/main:apps/staff-hub/src/lib/workbenchKanban.ts` → 不存在（三态用例的动态 import 必抛）；`git show origin/main:apps/api/src/routes/workbench.ts \| grep -c views` → **0**（member 维用例断言 `bobList.status===200`，实得 404 → 红）；`--a20-only` / `--a1-a3-views-only` 在当前 smoke 上命中 `*) fail "未知参数"` → `exit 1`；`--mutation-apply <未登记名>` 命中 `*) echo "未登记的变异名"; exit 1` → 变异条目的 `|| exit 1` 当场红（**不存在「未注册变异 → 段报未知参数 → RC≠0 → 假绿」这条通路**）。
3. **阈值同步**：Step0 `numTotalTests >= 20`；实际 `it()` 计数 4+4+7+5 = **20**（`grep -c "  it("`）。
4. **机械核重跑**：Step 2b-check 全过（`BC=25 MC=27 blocks=1 real=27 grep=0`）；`contract-dod.md` 全部 27 条 `Test:` 外层 `bash -n` 零报错；12 条 `node -e` 内层用 `vm.Script` 解析零报错；`## E2E 验收` bash 块 `bash -n` 通过且无全角标点紧贴 `$VAR`；psql 美元引用与 `jq -nc` payload 已实跑确认展开正确。
5. **行数**：draft 合同正文 764 → 804（含主动删去 PS1 里与 `e2e-rows-run.ps1` 逐字重复的截图保鲜段 -7；本「r1 逐条回应」段属 GAN 台账不计入合同正文）、dod 205 → 210（+5）。合计 **+45**，逐行可归属到 P0/P1/P2 某一条，**零「可以更严谨」新增**，结构未重写。
