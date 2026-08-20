---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
gp_anchor: line11/structured_workbench#step1
---
# Contract DoD — Sprint: 员工知识中枢 路③ 结构化工作台 · Sprint A（底座与三道门）

**范围**: G0 会话鉴权闸 + A2 静态守卫 / G1 新字段元数据表隔离 + 旧 `/api/fields` J7 四段处置 / G2 `pg_dump` 备份与恢复演练 / JSONB 五表存储底座 / S1 建表最小闭环（模板 · 8 类字段 · 表级可见性 · 软删回收站）/ A35① 前向兼容锚 / A33 独立 windows workflow 接线
**不在范围**: S2 录数据（Sprint B）、S3 视图看板（Sprint C）、S4 关联（Sprint D）；不删端点/表/service
**大小**: L

> 全部 `manual:` 命令的工作目录 = repo 根。需 `E2E_DATABASE_URL`（或 `DATABASE_URL`）；未设时命令自身报错退出，**不落默认库**。
> **两个库别混**：`E2E_DATABASE_URL`/`DATABASE_URL` 指 **zenithjoy** 库（`zenithjoy.*` 各表）；`decisions` 表**只在 Brain（cecelia）库** `public.decisions`，由 `BRAIN_DATABASE_URL` 或 Brain API `localhost:5221` 访问（仅 INV-10 与 `--a4-only` 段⑤ 用到）。用错库 = 该判据恒 FAIL。
> **判定归 DoD、供给归脚本**（见合同「夹具供给协议」）：`--fixture-up` 只起真 `apps/api` + 种双企业 + 签三个真会话并写 `./.wb-fixture.env`，一切 pass/fail 判定写在下面的命令里由 evaluator 直接执行；DB 断言的 `PGURL` 直接取 `${E2E_DATABASE_URL:-$DATABASE_URL}`，**不经脚本**。
> **变异一律外置判据**（见合同「变异证明执行协议」）：`--mutation-apply` 只改代码/数据，判据是「被守卫的那一段自己 exit≠0」，不认脚本自述的 `proven-to-fire`。

## ARTIFACT 条目

- [ ] [ARTIFACT] `workbenchAuthGuard` 中间件存在，且身份只来自服务端会话（零身份头名字面量）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/middleware/workbench-auth.ts','utf8');if(!/workbenchAuthGuard/.test(c))process.exit(1);if(/X-Tenant-Id|X-User-Email|X-Feishu-User-Id|X-Bypass-Tenant|tenantContextOptional|selfHealOwnerMember|staffGuard/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路③ 五表 migration 存在，五张表逐个 `org_id NOT NULL`，DDL 幂等（`IF NOT EXISTS`）
  Test: node -e "const fs=require('fs');const d='apps/api/db/migrations';const f=fs.readdirSync(d).find(n=>/structured_workbench|knowledge_db/.test(n)&&n.endsWith('.sql'));if(!f)process.exit(1);const c=fs.readFileSync(d+'/'+f,'utf8');for(const t of ['db_tables','db_fields','db_rows','db_view_prefs','db_audit']){if(!new RegExp('CREATE TABLE IF NOT EXISTS zenithjoy\\\\.'+t).test(c))process.exit(1)}if((c.match(/org_id\s+uuid\s+NOT NULL/gi)||[]).length<5)process.exit(1)"

- [ ] [ARTIFACT] A35① 排除清单文件存在、可被 Node 解析，导出常量数组逐字含五个物理表名
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/knowledge/retrieval-exclusions.ts','utf8');for(const t of ['db_tables','db_fields','db_rows','db_view_prefs','db_audit']){if(!c.includes(t))process.exit(1)}if(!/export const .*=\s*\[/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路③ smoke 脚本存在且已进 `smoke-baseline.txt`（否则 nightly 不跑 = 死了没人知道）
  Test: node -e "const fs=require('fs');if(!fs.existsSync('.github/workflows/scripts/smoke/structured-workbench-smoke.sh'))process.exit(1);if(!fs.readFileSync('.github/workflows/scripts/smoke-baseline.txt','utf8').includes('structured-workbench-smoke.sh'))process.exit(1)"

- [ ] [ARTIFACT] 独立 E2E workflow 存在：`on:` 含 `pull_request`，`paths` 含路③ spec 与源码
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-knowledge-hub-path3.yml','utf8');if(!/^\s{2}pull_request:/m.test(c))process.exit(1);if(!/windows-latest/.test(c))process.exit(1);if(!/structured-workbench\.spec\.ts/.test(c))process.exit(1)"

- [ ] [ARTIFACT] G2 备份 workflow 存在且 `on:` 含 `schedule`（持久载体，非一次性手跑）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/db-backup.yml','utf8');if(!/^\s{2}schedule:/m.test(c))process.exit(1);if(!/pg_dump/.test(c))process.exit(1);if(!/restore-drill\.sh/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路③ 前端不走 `adminFetch`（那条通道拼两个明文身份头，是既有 16 端点的凭据，两路不得互串）
  Test: node -e "const fs=require('fs');const p='apps/staff-hub/src/pages';const hit=fs.readdirSync(p).filter(n=>/Workbench/.test(n)).map(n=>fs.readFileSync(p+'/'+n,'utf8')).filter(c=>/adminFetch/.test(c));if(hit.length)process.exit(1)"

- [ ] [ARTIFACT] 假上游按成员寻址扩展已落地（P0-1 修复载体：`code-<ORGKEY>` 既有分支一字不改，只加分组未命中时按 `open_id` 精确寻址的 fallback）
  Test: node -e 'const c=require("fs").readFileSync("apps/api/src/routes/_smoke-fake-feishu.ts","utf8");if(!/pickDeclaredMember/.test(c))process.exit(1);if(!/pickGroupMembers\(key\)\s*\?\?\s*pickDeclaredMember\(key\)/.test(c))process.exit(1);if(!/code-\(\[A-Za-z0-9_\]\+\)\$/.test(c))process.exit(1)'

- [ ] [ARTIFACT] 两个扫描器存在（INV-4 / INV-7 的判据载体，`origin/main` 上不存在，属本刀交付物；不进清单 = 空实现满分）
  Test: node -e "const fs=require('fs');for(const f of ['.github/workflows/scripts/smoke/lib/scan-hardcoded-secrets.mjs','.github/workflows/scripts/smoke/lib/scan-hardcoded-env.mjs']){if(!fs.existsSync(f))process.exit(1);const c=fs.readFileSync(f,'utf8');if(!/process\.exit\(1\)/.test(c))process.exit(1)}"

- [ ] [ARTIFACT] Sprint B/C 记账三项已留痕（AG Grid 32.2.1 / dnd-kit / 5000 行上限，本刀只记账不引入）
  Test: node -e "const c=require('fs').readFileSync('sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/accounting.md','utf8');for(const k of ['32.2.1','dnd-kit','5000'])if(!c.includes(k))process.exit(1)"

## BEHAVIOR 条目

> 对应 Golden Path Step1–Step10。每条都可回答「这是 Golden Path 哪一步的用户可观察输出」，且对应代码一行没写时必然 FAIL。
> 五组最高价值判据（A1/A3、A6、A8、A9、A5）已从 `--aN-only` 换成**下方内联的真 curl/jq -e + 真 psql**，脚本只供给环境。

### Step1 — 空工作台模板（本地标签 A7，来源 PRD「开箱模板」+ 假设第 3 条）

- [ ] [BEHAVIOR] 模板端点返回 ≥2 个开箱模板，且一键建表后落库字段集与模板声明逐字一致
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --fixture-up || exit 1; . ./.wb-fixture.env; PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; fail(){ echo "FAIL: $1"; bash "$S" --fixture-down; exit 1; }; [ -n "$PG" ] || fail "缺 E2E_DATABASE_URL/DATABASE_URL"; API="http://localhost:$API_PORT/api/knowledge/db"; TPL=$(curl -sf -b "$COOKIE_A" "$API/templates") || fail "模板端点非 2xx"; echo "$TPL" | jq -e ".success == true and (.data.templates | length) >= 2" >/dev/null || fail "模板数 <2"; K=$(echo "$TPL" | jq -r ".data.templates[0].template_key"); EXP=$(echo "$TPL" | jq -Sc "[.data.templates[0].fields[] | {name,field_type,display_order}] | sort_by(.display_order)"); TID=$(curl -sf -b "$COOKIE_A" -H "Content-Type: application/json" -X POST "$API/tables" -d "{\"name\":\"WB-A7-$SFX\",\"visibility\":\"org\",\"template_key\":\"$K\"}" | jq -r ".data.table_id"); [ -n "$TID" ] && [ "$TID" != "null" ] || fail "一键建表未返 table_id"; GOT=$(psql "$PG" -t -A -c "SELECT json_agg(json_build_object(\$\$name\$\$, name, \$\$field_type\$\$, field_type, \$\$display_order\$\$, display_order) ORDER BY display_order) FROM zenithjoy.db_fields WHERE table_id = \$\$$TID\$\$" | jq -Sc "."); [ "$GOT" = "$EXP" ] || fail "落库字段集与模板声明不一致 got=$GOT exp=$EXP"; bash "$S" --fixture-down; echo OK'
  期望: OK

### Step2 — 建表与 8 类字段（本地标签 A6，来源 PRD Golden Path 第 2/3 条 / 上位合同 A10）

- [ ] [BEHAVIOR] 建表返 201，`org_id` 取自会话而非请求体，八类字段各一落 `db_fields`（psql 带 5 分钟时间窗防历史行冒充）
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --fixture-up || exit 1; . ./.wb-fixture.env; PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; fail(){ echo "FAIL: $1"; bash "$S" --fixture-down; exit 1; }; [ -n "$PG" ] || fail "缺 E2E_DATABASE_URL/DATABASE_URL"; echo "$EIGHT_FIELDS" | jq -e "([.[].field_type] | unique | length) == 8" >/dev/null || fail "夹具给的字段载荷不是八类各一"; API="http://localhost:$API_PORT/api/knowledge/db"; RESP=$(curl -sf -b "$COOKIE_A" -H "Content-Type: application/json" -X POST "$API/tables" -d "{\"name\":\"WB-A6-$SFX\",\"visibility\":\"org\",\"org_id\":\"$ORGB_TENANT_ID\",\"fields\":$EIGHT_FIELDS}") || fail "建表非 2xx"; echo "$RESP" | jq -e ".success == true and .data.org_id == \"$ORGA_TENANT_ID\"" >/dev/null || fail "org_id 未取自会话（请求体里的 B 企业 id 被采信）"; TID=$(echo "$RESP" | jq -r ".data.table_id"); psql "$PG" -t -A -c "SELECT count(*) FROM zenithjoy.db_tables WHERE id = \$\$$TID\$\$ AND org_id = \$\$$ORGA_TENANT_ID\$\$ AND created_at > NOW() - make_interval(mins => 5)" | grep -qx 1 || fail "落库缺行或归属错"; psql "$PG" -t -A -c "SELECT count(DISTINCT field_type) FROM zenithjoy.db_fields WHERE table_id = \$\$$TID\$\$" | grep -qx 8 || fail "八类字段未落全"; bash "$S" --fixture-down; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 建表全程零运行时 DDL：`information_schema.tables WHERE table_schema='zenithjoy'` 建表前后集合全等且等于 migration 声明集合
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a10-only
  期望: exit 0

### Step3 — G0 命门：伪造头无效 + 正向对照（A1 / A3）

- [ ] [BEHAVIOR] 持 B 企业真会话 + 伪造 `X-Tenant-Id`/`body.tenant_id`/`body.org_id` 指向 A 企业建表 → A 企业零新增行；同时刻 A 企业自己的会话读得到自己的列表（正向对照，堵「一律拒绝」假绿）
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --fixture-up || exit 1; . ./.wb-fixture.env; PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; fail(){ echo "FAIL: $1"; bash "$S" --fixture-down; exit 1; }; [ -n "$PG" ] || fail "缺 E2E_DATABASE_URL/DATABASE_URL"; API="http://localhost:$API_PORT/api/knowledge/db"; FN="WB-FORGE-$SFX"; CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_B" -H "X-Tenant-Id: $ORGA_TENANT_ID" -H "Content-Type: application/json" -X POST "$API/tables" -d "{\"name\":\"$FN\",\"visibility\":\"org\",\"org_id\":\"$ORGA_TENANT_ID\",\"tenant_id\":\"$ORGA_TENANT_ID\",\"fields\":$EIGHT_FIELDS}"); psql "$PG" -t -A -c "SELECT count(*) FROM zenithjoy.db_tables WHERE org_id = \$\$$ORGA_TENANT_ID\$\$ AND name = \$\$$FN\$\$" | grep -qx 0 || fail "A1 反向失败：B 企业会话伪造头把行写进了 A 企业 http=$CODE"; curl -sf -b "$COOKIE_A" "$API/tables" | jq -e ".success == true and (.data.tables | type) == \"array\"" >/dev/null || fail "A3 正向失败：A 企业自己也读不到（闸在一律拒绝）"; curl -sf -b "$COOKIE_A" "$API/templates" | jq -e ".success == true" >/dev/null || fail "A3 正向失败：模板端点对本企业也拒绝"; bash "$S" --fixture-down; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 变异证明（判据外置）：把闸改回「有头则读头」后，A1/A3 段自己必须 `exit ≠ 0`
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --mutation-apply A1-header-fallback || exit 1; bash "$S" --a1-a3-only; RC=$?; bash "$S" --mutation-revert A1-header-fallback; [ "$RC" -ne 0 ] || { echo "FAIL: 变异已施加但 A1 段仍 exit 0 —— 守卫是空的"; exit 1; }; echo OK'
  期望: OK

### Step4 — 表级可见性真访问控制（A8）

- [ ] [BEHAVIOR] 「仅自己」表：同组织他人（乙）列表不含且 `GET :id` 返 404、响应体与随机不存在 uuid 逐字节相同；同时刻表主（甲）返 200 且表名逐字一致
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --fixture-up || exit 1; . ./.wb-fixture.env; fail(){ echo "FAIL: $1"; bash "$S" --fixture-down; exit 1; }; H(){ openssl dgst -md5 < "$1" | awk "{print \$NF}"; }; API="http://localhost:$API_PORT/api/knowledge/db"; PN="WB-PRIV-$SFX"; PT=$(curl -sf -b "$COOKIE_A" -H "Content-Type: application/json" -X POST "$API/tables" -d "{\"name\":\"$PN\",\"visibility\":\"private\",\"fields\":$EIGHT_FIELDS}" | jq -r ".data.table_id"); [ -n "$PT" ] && [ "$PT" != "null" ] || fail "建私有表失败"; RND=$(uuidgen | tr "A-Z" "a-z"); H1=$(curl -s -b "$COOKIE_A2" -o /tmp/wb-a8-1.json -w "%{http_code}" "$API/tables/$PT"); H2=$(curl -s -b "$COOKIE_A2" -o /tmp/wb-a8-2.json -w "%{http_code}" "$API/tables/$RND"); [ "$H1" = "404" ] || fail "乙访问甲的私有表返 $H1（应 404，403 会泄漏存在性）"; [ "$H2" = "404" ] || fail "随机 uuid 返 $H2"; [ "$(H /tmp/wb-a8-1.json)" = "$(H /tmp/wb-a8-2.json)" ] || fail "两个 404 响应体不同 —— 可被逐个 id 枚举出他人表"; curl -sf -b "$COOKIE_A2" "$API/tables" | jq -e "[.data.tables[].table_id] | index(\"$PT\") | not" >/dev/null || fail "乙的列表里泄漏了甲的私有表"; curl -sf -b "$COOKIE_A" "$API/tables/$PT" | jq -e ".data.name == \"$PN\"" >/dev/null || fail "正向对照失败：表主本人同时刻也访问不到（一律拒绝假绿）"; bash "$S" --fixture-down; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 变异证明（判据外置）：可见性判据改成「一律拒绝」后，A8 段（含正向对照）必须 `exit ≠ 0`
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --mutation-apply A8-deny-all || exit 1; bash "$S" --a8-only; RC=$?; bash "$S" --mutation-revert A8-deny-all; [ "$RC" -ne 0 ] || { echo "FAIL: 一律拒绝下 A8 仍 exit 0 —— 正向对照根本没跑"; exit 1; }; echo OK'
  期望: OK

### Step5 — 删表二次确认 · 软删可还原（A9 / A30①）

- [ ] [BEHAVIOR] 确认名不匹配返 400 `CONFIRM_MISMATCH` 且 `deleted_at` 仍 NULL；正确确认名删除后 `deleted_at` 非空而组织内物理行计数不减；还原后 `deleted_at` 回 NULL
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --fixture-up || exit 1; . ./.wb-fixture.env; PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; fail(){ echo "FAIL: $1"; bash "$S" --fixture-down; exit 1; }; [ -n "$PG" ] || fail "缺 E2E_DATABASE_URL/DATABASE_URL"; API="http://localhost:$API_PORT/api/knowledge/db"; DN="WB-DEL-$SFX"; DT=$(curl -sf -b "$COOKIE_A" -H "Content-Type: application/json" -X POST "$API/tables" -d "{\"name\":\"$DN\",\"visibility\":\"org\",\"fields\":$EIGHT_FIELDS}" | jq -r ".data.table_id"); [ -n "$DT" ] && [ "$DT" != "null" ] || fail "建表失败"; C0=$(psql "$PG" -t -A -c "SELECT count(*) FROM zenithjoy.db_tables WHERE org_id = \$\$$ORGA_TENANT_ID\$\$"); BAD=$(curl -s -o /tmp/wb-a9-bad.json -w "%{http_code}" -b "$COOKIE_A" -H "Content-Type: application/json" -X DELETE "$API/tables/$DT" -d "{\"confirm_name\":\"WRONG-$SFX\"}"); [ "$BAD" = "400" ] || fail "确认名不符返 $BAD（应 400）"; jq -e ".error.code == \"CONFIRM_MISMATCH\"" < /tmp/wb-a9-bad.json >/dev/null || fail "错误码不是 CONFIRM_MISMATCH"; psql "$PG" -t -A -c "SELECT count(*) FROM zenithjoy.db_tables WHERE id = \$\$$DT\$\$ AND deleted_at IS NULL" | grep -qx 1 || fail "确认名不符却已执行删除"; curl -sf -b "$COOKIE_A" -H "Content-Type: application/json" -X DELETE "$API/tables/$DT" -d "{\"confirm_name\":\"$DN\"}" >/dev/null || fail "正确确认名删除非 2xx"; psql "$PG" -t -A -c "SELECT count(*) FROM zenithjoy.db_tables WHERE id = \$\$$DT\$\$ AND deleted_at IS NOT NULL" | grep -qx 1 || fail "软删未打 deleted_at"; C1=$(psql "$PG" -t -A -c "SELECT count(*) FROM zenithjoy.db_tables WHERE org_id = \$\$$ORGA_TENANT_ID\$\$"); [ "$C0" = "$C1" ] || fail "物理行被删了（$C0 -> $C1）不是软删"; curl -sf -b "$COOKIE_A" -X POST "$API/trash/$DT/restore" >/dev/null || fail "回收站还原非 2xx"; psql "$PG" -t -A -c "SELECT count(*) FROM zenithjoy.db_tables WHERE id = \$\$$DT\$\$ AND deleted_at IS NULL" | grep -qx 1 || fail "还原后 deleted_at 未清空"; bash "$S" --fixture-down; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 变异证明（判据外置）：软删改成物理 `DELETE` 后，A9 段必须 `exit ≠ 0`
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --mutation-apply A9-hard-delete || exit 1; bash "$S" --a9-only; RC=$?; bash "$S" --mutation-revert A9-hard-delete; [ "$RC" -ne 0 ] || { echo "FAIL: 物理删除下 A9 仍 exit 0"; exit 1; }; echo OK'
  期望: OK

### Step6 — G0 机械闸（A2，扫描域从挂载事实推导）

- [ ] [BEHAVIOR] 路③ 全部路由与中间件源码七个禁用字面量零命中，且路③ 挂载路径以 `/api/knowledge/db` 开头
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a2-only
  期望: exit 0

- [ ] [BEHAVIOR] A2 扫描域非空且逐项命中真实文件；`git diff origin/main` 里所有新增的路③ 源文件都在扫描域内（堵「漏登记一个文件 = 空集假绿」，同上位合同 A35 v3 改形理由）
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; SC=$(bash "$S" --a2-print-scope) || { echo "FAIL: --a2-print-scope 非 0"; exit 1; }; N=$(printf "%s\n" "$SC" | grep -c .); [ "$N" -ge 3 ] || { echo "FAIL: 扫描域仅 $N 项（<3，疑似空集）"; exit 1; }; for f in $SC; do [ -f "$f" ] || { echo "FAIL: 扫描域项不是真实文件 $f"; exit 1; }; done; for f in $(git diff --name-only origin/main...HEAD -- apps/api/src apps/staff-hub/src | grep -E "\.(ts|tsx)$"); do [ -f "$f" ] || continue; grep -qE "/api/knowledge/db|[Ww]orkbench" "$f" || continue; printf "%s\n" "$SC" | grep -qxF "$f" || { echo "FAIL: 路③ 新增文件未进扫描域 $f"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 变异证明（判据外置）：七个字面量逐个插入到**现算扫描域里的真实文件**后，A2 段必须 `exit ≠ 0`，且 `--mutation-list` 报告该开关注入次数 = 7
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --mutation-list | grep -qE "A2-inject-all[[:space:]]+7" || { echo "FAIL: A2-inject-all 注入次数不是 7（有字面量漏网）"; exit 1; }; bash "$S" --mutation-apply A2-inject-all || exit 1; bash "$S" --a2-only; RC=$?; bash "$S" --mutation-revert A2-inject-all; [ "$RC" -ne 0 ] || { echo "FAIL: 七字面量已注入但 A2 仍 exit 0"; exit 1; }; echo OK'
  期望: OK

### Step7 — G1 旧 `/api/fields` J7 五段（A4，反向 + 正向对照）

- [ ] [BEHAVIOR] A4 五段全绿：新表 `org_id NOT NULL` 跨企业读改被拒 / 旧四端点无身份返 401 / 旧表跨企业隔离且 B 行未变 / 回归 spec 无 `page.route` / 处置结果落 decisions
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a4-only
  期望: exit 0

- [ ] [BEHAVIOR] G1 段③ 正向对照：A 持身份 `GET /api/fields` 命中自己那一行，`PUT` 自己那行返 2xx 且 `psql` 复查 `field_name` 真变成新值（堵「一律返空数组 / 一律 403」——那会让三条反向断言全绿而 dashboard `/works/fields` 当场瘫痪，即 PR#1675→#1676 的形状）
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --fixture-up || exit 1; . ./.wb-fixture.env; PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; fail(){ echo "FAIL: $1"; bash "$S" --fixture-down; exit 1; }; [ -n "$PG" ] || fail "缺 E2E_DATABASE_URL/DATABASE_URL"; FID=$(psql "$PG" -t -A -q -c "INSERT INTO zenithjoy.field_definitions (field_name, field_type, tenant_id) VALUES (\$\$fwd_a_$SFX\$\$, \$\$text\$\$, \$\$$ORGA_TENANT_ID\$\$) RETURNING id"); [ -n "$FID" ] || fail "种 A 企业字段行失败"; curl -sf -b "$COOKIE_A" "http://localhost:$API_PORT/api/fields" | jq -e "(if type == \"array\" then . else .data end) | map(.id) | index(\"$FID\") != null" >/dev/null || fail "正向对照失败：A 读不到自己那一行（实现在一律返空）"; NEW="fwd_a_renamed_$SFX"; curl -sf -b "$COOKIE_A" -H "Content-Type: application/json" -X PUT "http://localhost:$API_PORT/api/fields/$FID" -d "{\"field_name\":\"$NEW\"}" >/dev/null || fail "正向对照失败：A 改不动自己那一行（实现在一律 403）"; psql "$PG" -t -A -c "SELECT count(*) FROM zenithjoy.field_definitions WHERE id = \$\$$FID\$\$ AND field_name = \$\$$NEW\$\$" | grep -qx 1 || fail "PUT 返 2xx 但 field_name 没真落库"; psql "$PG" -t -A -c "DELETE FROM zenithjoy.field_definitions WHERE id = \$\$$FID\$\$" >/dev/null; bash "$S" --fixture-down; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 段③ 两个既有 smoke 改带身份头后自己仍是绿的（挂鉴权把它们打成 401 是必然，必须同刀修）
  Test: manual:bash -c 'bash .github/workflows/scripts/smoke/fields-smoke.sh && bash .github/workflows/scripts/smoke/zenithjoy-smoke-audit.sh'
  期望: 两个脚本均 exit 0

### Step8 — G2 备份与恢复演练（A5）

- [ ] [BEHAVIOR] 恢复演练在**非空表**上跑：五表逐表 `count(*) ≥ 1` 且各含本轮 `WB-DRILL-<run>` 标记行；真 `pg_dump` → 还原到临时库 → 五表行数与逐行字段值全等（回执不是 `pg_dump` 退出码）
  > 判据取**演练当轮回执**而非演练结束后的源库：演练自带 `trap cleanup EXIT` 会删掉自己种的 `WB-DRILL` 行（不许污染源库），事后查源库恒查不到；`count>0` / 标记行逐字回读这两件事只在演练进行中成立，所以逐表核对回执里那一行。演练啥也没干（空实现/没种数据/漏表）时这些行拿不出来 → 必然 FAIL。
  Test: manual:bash -c 'PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo "FAIL: 缺 E2E_DATABASE_URL/DATABASE_URL"; exit 1; }; OUT=$(bash .github/workflows/scripts/backup/restore-drill.sh 2>&1); RC=$?; printf "%s\n" "$OUT"; [ "$RC" -eq 0 ] || { echo "FAIL: 恢复演练非 0"; exit 1; }; MK=$(printf "%s\n" "$OUT" | grep -oE "WB-DRILL-[0-9]+" | head -1); [ -n "$MK" ] || { echo "FAIL: 演练没种本轮 WB-DRILL-<run> 可判别数据"; exit 1; }; printf "%s\n" "$OUT" | grep -qF "run=${MK#WB-DRILL-}" || { echo "FAIL: 演练未跑到收尾回执（run=${MK#WB-DRILL-}）—— 中途退出"; exit 1; }; for T in db_tables db_fields db_rows db_view_prefs db_audit; do L=$(printf "%s\n" "$OUT" | grep -E "zenithjoy[.]$T count=[0-9]+ md5 " | head -1); [ -n "$L" ] || { echo "FAIL: zenithjoy.$T 没有「count 全等 + md5 全等 + 标记行逐字相同」回执 —— 该表没进逐行比对"; exit 1; }; C=$(printf "%s" "$L" | sed -E "s/.*count=([0-9]+).*/\1/"); [ "$C" -gt 0 ] || { echo "FAIL: zenithjoy.$T 演练时是空表 —— count 全等在空表上恒真（0==0），备份缺内容看不出来"; exit 1; }; printf "%s" "$L" | grep -qF "标记行逐字相同" || { echo "FAIL: zenithjoy.$T 未做本轮标记行逐字回读 —— 备份可能只有表结构"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 变异证明（判据外置，G2 唯一守卫证明）：把 `pg_dump` 换成 `--schema-only` 后，恢复演练必须 `exit ≠ 0`
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --mutation-apply A5-schema-only || exit 1; bash .github/workflows/scripts/backup/restore-drill.sh; RC=$?; bash "$S" --mutation-revert A5-schema-only; [ "$RC" -ne 0 ] || { echo "FAIL: 只备份 schema 演练仍 exit 0 —— A5 在空表/空内容上恒真"; exit 1; }; echo OK'
  期望: OK

### Step9 — 单组织前置自检 fail-closed（本地标签 A11，来源 PRD 边界情况第 1 条）

- [ ] [BEHAVIOR] 正常态服务起得来且启动日志含 `A11 single-org selfcheck passed`；多组织行时进程在 listen 之前退出、日志点名 `A11-MULTI-ORG`；请求期返 409 `MULTI_ORG_MEMBER`
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a11-only
  期望: exit 0

- [ ] [BEHAVIOR] 变异证明（判据外置）：自检改回「取第一条」后，A11 段必须 `exit ≠ 0`
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --mutation-apply A11-take-first || exit 1; bash "$S" --a11-only; RC=$?; bash "$S" --mutation-revert A11-take-first; [ "$RC" -ne 0 ] || { echo "FAIL: 取第一条下 A11 仍 exit 0"; exit 1; }; echo OK'
  期望: OK

### Step10 — A35① 前向兼容锚 + A33 接线（含真跑判据）

- [ ] [BEHAVIOR] 排除清单五个表名逐字命中；变异证明（判据外置）：逐个删表名后 A35 段必须 `exit ≠ 0`，且 `--mutation-list` 报告注入次数 = 5
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --a35-only || { echo "FAIL: A35 基线不绿"; exit 1; }; bash "$S" --mutation-list | grep -qE "A35-drop-name[[:space:]]+5" || { echo "FAIL: A35-drop-name 注入次数不是 5"; exit 1; }; bash "$S" --mutation-apply A35-drop-name || exit 1; bash "$S" --a35-only; RC=$?; bash "$S" --mutation-revert A35-drop-name; [ "$RC" -ne 0 ] || { echo "FAIL: 删表名后 A35 仍 exit 0"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] A33 四段静态判据全绿：`on:` 含 `pull_request` / 有 `windows-latest` job 且它跑全链 / 该 job 无事件条件门 / `paths` 含路③ spec 与源码
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a33-only
  期望: exit 0

- [ ] [BEHAVIOR] 接缝 S3/S4 真验：本分支上该 workflow 的 windows-latest job 真跑过且 `conclusion == success`（`skipped` 判 FAIL）
  Test: manual:bash -c 'BR=$(git rev-parse --abbrev-ref HEAD); RID=$(gh run list --workflow e2e-knowledge-hub-path3.yml --branch "$BR" --limit 1 --json databaseId | jq -r ".[0].databaseId // empty"); [ -n "$RID" ] || { echo "FAIL: 分支无该 workflow 运行记录，A33 接线未成"; exit 1; }; gh run view "$RID" --json jobs | jq -e "[.jobs[] | select(.name|test(\"windows\")) | select(.conclusion==\"success\")] | length > 0"'
  期望: exit 0（`skipped` 会让 jq 断言为假 → FAIL，正是 A33(c) 要堵的孤儿 spec 形态）

## INV 条目（PRD 铁律逐条覆盖）

- [ ] [BEHAVIOR] INV-1 [租户隔离] 路③ 每条触碰五表的 SQL 都带 `org_id` 条件，且运行时跨企业读改返 4xx/空集
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-tenant-isolation
  期望: exit 0

- [ ] [BEHAVIOR] INV-2 [端点鉴权] 路③ 九个端点无会话逐个返 401，且旧 `/api/fields` 四端点无身份逐个返 401（无鉴权端点不准 ship）
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --fixture-up || exit 1; . ./.wb-fixture.env; fail(){ echo "FAIL: $1"; bash "$S" --fixture-down; exit 1; }; B="http://localhost:$API_PORT"; N=0; for U in "GET $B/api/knowledge/db/tables" "GET $B/api/knowledge/db/templates" "GET $B/api/knowledge/db/trash" "POST $B/api/knowledge/db/tables" "GET $B/api/fields" "POST $B/api/fields"; do M=${U%% *}; P=${U#* }; C=$(curl -s -o /dev/null -w "%{http_code}" -X "$M" -H "Content-Type: application/json" -d "{}" "$P"); [ "$C" = "401" ] || fail "$M $P 无会话返 $C（应 401）"; N=$((N+1)); done; [ "$N" = "6" ] || fail "探测端点数 $N"; bash "$S" --inv-endpoint-auth || fail "全量 13 端点鉴权探测未过"; bash "$S" --fixture-down; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-3 [测试默认多租户] smoke 与 tests 均种 ≥2 个企业并断言互不串（单租户种子会让隔离漏洞永远看不见）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-two-tenant-seed
  期望: exit 0

- [ ] [BEHAVIOR] INV-4 [凭据安全] 本刀全部交付物零硬编码 secret（连接串/token/密钥字面量）
  Test: manual:node .github/workflows/scripts/smoke/lib/scan-hardcoded-secrets.mjs sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff apps/api/src/knowledge apps/api/src/middleware/workbench-auth.ts .github/workflows/db-backup.yml .github/workflows/e2e-knowledge-hub-path3.yml
  期望: exit 0

- [ ] [BEHAVIOR] INV-4 变异证明（判据外置）：往被扫目录塞一个假连接串后，扫描器必须 `exit ≠ 0` 且输出点名被注入文件的路径与行号（空实现拿不到这一条）
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --mutation-apply INV4-inject-secret || exit 1; T=$(cat ./.wb-mutation-target); OUT=$(node .github/workflows/scripts/smoke/lib/scan-hardcoded-secrets.mjs sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff apps/api/src/knowledge apps/api/src/middleware/workbench-auth.ts .github/workflows/db-backup.yml .github/workflows/e2e-knowledge-hub-path3.yml 2>&1); RC=$?; bash "$S" --mutation-revert INV4-inject-secret; [ "$RC" -ne 0 ] || { echo "FAIL: 注入假连接串后扫描器仍 exit 0 —— 空实现"; exit 1; }; printf "%s" "$OUT" | grep -qF "$T" || { echo "FAIL: 输出未点名被注入文件 $T"; exit 1; }; printf "%s" "$OUT" | grep -qE "$(basename "$T"):[0-9]+" || { echo "FAIL: 输出无行号"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-5 [日志脱敏] 真跑一轮建表后，`apps/api` 日志中不出现表名/字段名/单元格值正文（只许出现 id）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-log-redaction
  期望: exit 0

- [ ] [BEHAVIOR] INV-6 [真环境验证才算done] 接缝清单 S1–S5 逐条有真目标证据；未真验项必须显式标 `logic-done-pending`，不得标 done
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-seam-ledger
  期望: exit 0

- [ ] [BEHAVIOR] INV-7 [禁写死环境假设值] 交付脚本零硬编码端口/UUID/连接串字面量，全部从 env 推导或运行时生成
  Test: manual:node .github/workflows/scripts/smoke/lib/scan-hardcoded-env.mjs .github/workflows/scripts/smoke/structured-workbench-smoke.sh .github/workflows/scripts/backup/restore-drill.sh sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/e2e-verify.ps1
  期望: exit 0

- [ ] [BEHAVIOR] INV-7 变异证明（判据外置）：往被扫脚本塞一个硬编码 UUID/端口后，扫描器必须 `exit ≠ 0` 且点名文件与行号
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/structured-workbench-smoke.sh; bash "$S" --mutation-apply INV7-inject-hardcoded-env || exit 1; T=$(cat ./.wb-mutation-target); OUT=$(node .github/workflows/scripts/smoke/lib/scan-hardcoded-env.mjs .github/workflows/scripts/smoke/structured-workbench-smoke.sh .github/workflows/scripts/backup/restore-drill.sh sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/e2e-verify.ps1 2>&1); RC=$?; bash "$S" --mutation-revert INV7-inject-hardcoded-env; [ "$RC" -ne 0 ] || { echo "FAIL: 注入硬编码值后扫描器仍 exit 0 —— 空实现"; exit 1; }; printf "%s" "$OUT" | grep -qE "$(basename "$T"):[0-9]+" || { echo "FAIL: 输出未点名 $T 的行号"; exit 1; }; echo OK'
  期望: OK

- INV-8 [单slot串行] **N/A：** 该铁律约束的是 harness 执行编排（同一时刻只有一个实现者动手），不是本 sprint 交付物的可观测属性，无法也不应在交付物上立机械断言。

- [ ] [BEHAVIOR] INV-9 [表名认领] 五张新表在 `origin/main` 上零既有写入方（建表前已 grep 全部写入方，无 schema 撞车）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-table-claim
  期望: exit 0

- [ ] [BEHAVIOR] INV-10 [语义重叠消解] `db_fields` 与旧 `field_definitions` 的语义重叠已由正式 decision 消解（不合并 + 各自隔离口径），不是「留给后续技术债 sprint」。**`decisions` 表在 Brain（cecelia）库 `public.decisions`，zenithjoy/zenithjoy_test 两库都没有这张表**（`\dt *.decisions` 实测），故本条走 `BRAIN_DATABASE_URL` 或 Brain API，**禁止**用 `$E2E_DATABASE_URL`/`$DATABASE_URL` 查它（那样恒 FAIL）
  Test: manual:bash -c 'fail(){ echo "FAIL: $1"; exit 1; }; Q="SELECT count(*) FROM public.decisions WHERE category IN (\$\$rec\$\$, \$\$invariant\$\$) AND (to_jsonb(decisions.*)::text) LIKE \$\$%1ae57f1a%\$\$ AND (to_jsonb(decisions.*)::text) LIKE \$\$%field_definitions%\$\$"; if [ -n "${BRAIN_DATABASE_URL:-}" ]; then C=$(psql "$BRAIN_DATABASE_URL" -t -A -c "$Q") || fail "BRAIN_DATABASE_URL 连不上 Brain 库"; else C=$(curl -sf "http://localhost:5221/api/brain/decisions?limit=1000" | jq "[.[] | select(.category == \"rec\" or .category == \"invariant\") | select((tostring | contains(\"1ae57f1a\")) and (tostring | contains(\"field_definitions\")))] | length") || fail "未设 BRAIN_DATABASE_URL 且 Brain API localhost:5221 不可达——decisions 在 Brain(cecelia) 库，不在 zenithjoy 库，不许拿 E2E_DATABASE_URL 兜"; fi; [ -n "$C" ] || fail "查询无返回"; [ "$C" -ge 1 ] || fail "decisions 无该处置记录（需 category=rec|invariant 且正文同时含 1ae57f1a 与 field_definitions）"; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-回归 [路① 资产不被打断腿] 本刀扩展 `_smoke-fake-feishu.ts` 后，路① smoke 的会话签发段仍全绿；`count-staffguard-endpoints.mjs` 仍 = 16
  Test: manual:bash -c 'bash .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh || { echo "FAIL: 路① smoke 被本刀打红"; exit 1; }; N=$(node .github/workflows/scripts/smoke/lib/count-staffguard-endpoints.mjs | tr -dc "0-9"); [ "$N" = "16" ] || { echo "FAIL: staffGuard 端点计数 $N（应 16，路③ 端点误挂）"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 员工在 windows-latest 干净 VM 的真浏览器里走完 Golden Path，截图可视化验证
  Screenshots:
    - 01-empty-workbench.png   期望：空工作台，≥2 张开箱模板卡片可见（A7）
    - 02-create-table.png      期望：建表表单已填 8 类字段各一 + 可见性选择器可见，提交按钮可点（A6）
    - 03-table-in-list.png     期望：新表出现在本组织工作台列表，字段数 = 8（A6）
    - 04-delete-confirm.png    期望：删表二次确认弹窗要求输入表名，输错时删除按钮禁用（A9）
    - 05-trash-restored.png    期望：回收站还原后表回到列表，字段定义与建表时逐字相同（A9/A30①）
  期望：所有截图与期望描述一致，Claude Read 图自验通过；截图 `LastWriteTime` 晚于脚本启动（防历史产物冒充）
  路径格式：sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/screenshots/<step>.png
