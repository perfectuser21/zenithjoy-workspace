# Sprint Contract Draft — 多组织切换第一刀 · 核心 active_org 解析 + 前端切换器

**Sprint**: 08221800-org-context-switch-core
**journey_type**: user_facing
**target_environment**: windows_cloud
**上位 GP**: line11 员工知识中枢 / 横切件 组织与权限底座·多组织切换（`9eb535b2-be3a-4383-b179-3a7dbb0717c8`，contract v2 已签）
**门禁断言（本刀 delta）**: A1 / A3 / A4 / A5 / A6 / A7 / A8 / A10（域=路③+新增 org 中间件，**不含 agent-context**）/ A11 / A12。变异证明 7 条：A1 / A4 / A7 / A10 / A11 / A12（双向）。**不在本刀**：A2（works 家族旁门注入，随命门③ 路由迁移落）/ A9（agent-context 机器通道，随命门④ 落）。

---

## GP-Anchor

GP-Anchor: line11/org_context_switch#step1

---

## Response Schema（推导来源: gp-contract-v2.json fr_summary + 同族既有端点口径）

本刀新增 org 上下文端点（session-only，独立挂 /api/knowledge/org，避开 workbench blanket 鉴权闸），
以及命门①② 两闸的受控反转态。字段命名跟同族既有端点口径（`org_id` / `active_org_id`）。

### Endpoint 1: GET /api/knowledge/org

**Success (HTTP 200)**:
```json
{"success": true, "data": {"orgs": [{"org_id": "<uuid>", "name": "<string>", "role": "<string>"}], "active_org_id": "<uuid|null>", "needs_selection": false}, "timestamp": "<iso>"}
```
- `orgs`: 本人全部归属企业（DISTINCT，带企业名 + 角色）；`active_org_id`: 当前选中企业（单企业透明=那一家 / 多企业未选或失效=null）；`needs_selection`: orgs≥2 且未选。
- 401 SESSION_REQUIRED（无会话）/ 403 NO_TENANT（0 家）/ 503 LEDGER_UNREACHABLE（查库失败）。

### Endpoint 2: POST /api/knowledge/org/switch

**Body**: `{"org_id": "<uuid>"}`（切换目标；服务端随后校验 ∈ 成员集合，绝不信任为身份来源）
**Success (HTTP 200)**: `{"success": true, "data": {"active_org_id": "<uuid>"}, "timestamp": "<iso>"}`
- 403 ORG_FORBIDDEN（目标不归属，绝不切换，产 resolve_deny 审计）/ 400 VALIDATION_FAILED（缺 org_id）/ 401。

### Endpoint 3: POST /api/admin/org/grant（J8 admin 供给，super-admin 鉴权，独立挂 /api/admin/org）

**Body**: `{"feishu_user_id": "<string>", "org_id": "<uuid>", "role?": "<string>"}` → 200 幂等补一条 tenant_members 行；400 VALIDATION_FAILED / 400 ORG_NOT_FOUND。

### 两闸受控反转态（命门①② workbenchAuthGuard / knowledgeAuthGuard，五态）

- 401 SESSION_REQUIRED / 403 NO_TENANT / **409 ORG_SELECTION_REQUIRED**（≥2 家未选，反转自旧 409 MULTI_ORG_MEMBER / knowledge LIMIT1）/ **403 ORG_FORBIDDEN**（active_org 伪造或成员从选中企业被移出，当次挡并清 active_org + deny 审计）/ 503 LEDGER_UNREACHABLE。错误体形状 `{success:false, data:null, error:{code,message}, timestamp}`，前端 knowledgeFetch 解析器两路共用。

---

## 已知约束（来自回归测试 + 累积 FR）

- [A8 零回归] 单企业账号（active_org=null 或=其唯一归属）透明解析，绝不弹选择器、绝不强加选择步骤；路③ relations/rows/views 三套基座（59 用例）+ 路① 不得回退。
- [反枚举同形] 跨组织不可达与不存在返逐字节同形 404（notFoundBody() 不带 timestamp）——本刀在 active_org 解析正确的前提下沿用路③ 既有 404 口径。
- [身份 session-only] org 归属只来自服务端会话态 active_org，绝不从请求头/体取；引入 X-Org-Id 类请求头或从 req.body/query 取 org 身份维度当场触 A10 报红。
- [Gate 0 四处同刀] A30-2 归属唯一放开 / A11 单组织自检反转成 A12 维度自检 / workbenchAuthGuard / selfHealOwnerMember 退役——只改前三处会漏出 self-heal 在迁移窗口按 license LIMIT1 写错企业归属行。

## 禁 mock 边清单

- `middleware/active-org.ts` / 两闸 ↔ `routes/org-context.ts`：真调，禁 vi.mock 顶替。
- 代码 ↔ `zenithjoy.tenant_members` / `public.session`(activeOrg) / `zenithjoy.org_audit` / `zenithjoy.db_*`：真 INSERT 真 SELECT，active_org 真落 session、审计真落库、跨企业隔离真验。
- 两闸 / org 端点 ↔ 真 better-auth 会话：走真 `/api/staff/feishu-login` 签的真会话 cookie（含跨两企业成员 dave），不伪造 cookie 串。
- 唯一允许 mock 的边：飞书 OAuth 上游（FEISHU_API_BASE 指向本地假上游，端点重定向非代码分支）。

---

## Golden Path

[员工归属多家企业登录后看到全部归属企业主动选定] → [选中企业下建表录数读写严格落这家] → [随时切换到另一家、旧企业数据即刻不可见] → [active_org 缺失/伪造全挡·成员被移出实时重校] → [越权/切换必产审计行] → [单企业账号零回归透明进入] → [多组织合法启动·维度缺失拒启动] → [org 源码零身份头零 req.body 取 org·A10 机检] → [真浏览器走完选定→切换全链]

### Step 1: 员工归属两家企业登录后看到全部归属企业并主动选定（≥2 未选停下让选，绝不自动挑）
**来源**: `[FROM_CONTRACT]` — gp-contract-v2 fr_summary#1 + A4

**可观测行为**: dave（admin/手动供给两条归属行）登录 → 响应/GET /api/knowledge/org 返 orgs=2、active_org_id=null、needs_selection=true；未选前调数据端点 → 409 ORG_SELECTION_REQUIRED（非静默取一个）。选定 A → active_org_id=A、数据端点放行。真浏览器阻断式选择界面（org-selection-required）+ 选定后顶部「当前企业：A」标识。

**验证命令**:
```bash
PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo "FAIL: 缺 PG"; exit 1; }
(cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts \
  ../../sprints/08221800-org-context-switch-core/tests/org-context-resolve.test.ts --reporter=dot) || exit 1
```
**硬阈值**: resolve 套件全绿；登录 orgs=2/active=null/needs_selection；未选 409 ORG_SELECTION_REQUIRED；选定后放行。UI 见 `## E2E 验收`（截图 01/02）。

---

### Step 2: 选中企业下读写严格落这家（A3 正向 psql tenant_id=A / A5 第二家 B 完整 / A1 反枚举同形 404）
**来源**: `[FROM_CONTRACT]` — fr_summary#2 + A1/A3/A5

**可观测行为**: dave 选定 A 建表 → psql 查回该表 org_id 全=A（A3）；切到 B 建表录行 → 落 org_id=B、A 会话读不到（A5）；active_org=A 时 GET B 的真实表 id 与随机不存在 id 逐字节同形 404、无 timestamp（A1）。

**验证命令**:
```bash
PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo "FAIL: 缺 PG"; exit 1; }
(cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts \
  ../../sprints/08221800-org-context-switch-core/tests/org-context-isolation.test.ts --reporter=dot) || exit 1
```
**硬阈值**: isolation 套件全绿；A3 psql tenant_id=A；A5 tenant_id=B 且 A 读不到；A1 逐字节同形 404 无 timestamp。

---

### Step 3: 随时切换、旧企业数据即刻不可见（A6 原子切换 / A7 LIVE 重校 / A11 审计）
**来源**: `[FROM_CONTRACT]` — fr_summary#3 + A6/A7/A11

**可观测行为**: A→B 切换后同会话立即 GET A 的表 id → 404、切回又 200（A6，原子重解析旧数据即刻不可见）；active_org=A 有效期间删 dave 的 A 归属行 → 下一请求当次挡 ORG_FORBIDDEN 并清 active_org（A7，LIVE 非登录快照）；越权/切换各产 resolve_deny/switch 审计行（A11 中间件自动副作用）。真浏览器切换下拉切到 B → 顶部标识变「当前企业：B」。

**验证命令**:
```bash
PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo "FAIL: 缺 PG"; exit 1; }
(cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts \
  ../../sprints/08221800-org-context-switch-core/tests/org-context-live-audit.test.ts --reporter=dot) || exit 1
```
**硬阈值**: live-audit 套件全绿；A6 切走 404/切回 200；A7 删归属行当次挡并清；A11 deny/switch 审计行出现。UI 见 `## E2E 验收`（截图 03）。

---

### Step 4: 单企业零回归 + 多组织合法启动/维度缺失拒启动（A8 / A12 双向）
**来源**: `[FROM_CONTRACT]` — A8 + A12

**可观测行为**: alice 单企业 → active_org_id=那一家、needs_selection=false、数据端点无需选择即放行、真浏览器不弹选择器无切换下拉（A8）；多组织成员+维度齐备（真 session 有 activeOrg 列）→ apps/api 正常启动，多组织成员+维度缺失→拒启动抛 A12-DIMENSION-MISSING（A12 双向）。

**验证命令**:
```bash
PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo "FAIL: 缺 PG"; exit 1; }
(cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts \
  ../../sprints/08221800-org-context-switch-core/tests/org-context-resolve.test.ts -t "A8" --reporter=dot) || exit 1
(cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts \
  ../../sprints/08221800-org-context-switch-core/tests/org-context-dimension.test.ts --reporter=dot) || exit 1
```
**硬阈值**: A8 单企业透明放行；A12 维度齐备启动/维度缺失拒启动。UI 见 `## E2E 验收`（截图 04）。

---

### Step 5: A10 静态守卫 + 7 变异 proven-to-fire
**来源**: `[FROM_CONTRACT]` — A10 + success_and_close 变异要求

**可观测行为**: org 中间件/端点/两闸源码零身份头（含 X-Org-Id）、零 req.body/query 取 org 身份维度、扫描域 <4 项即 exit 1；注入 7 个缺陷（A1 404 带 timestamp / A4 ≥2 未选静默取第一个 / A7 信任陈旧 active_org / A10 从 req.body 取 org / A11 审计不落库 / A12 维度缺失也放行 · 多组织即退出）各让对应段转红、复原转绿。

**验证命令**:
```bash
PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo "FAIL: 缺 PG"; exit 1; }
export E2E_DATABASE_URL="$PG" DATABASE_URL="$PG"
S=.github/workflows/scripts/smoke/org-context-switch-smoke.sh
bash "$S" --a10-only || exit 1
prove(){ bash "$S" --mutation-apply "$1"; if bash "$S" "$2" >/dev/null 2>&1; then bash "$S" --mutation-revert "$1"; echo "FAIL: $1 未转红"; exit 1; fi; bash "$S" --mutation-revert "$1"; }
prove A1-404-timestamp --a1-only; prove A4-silent-first --a4-only; prove A7-trust-stale --a7-only
prove A11-no-audit --a11-only; prove A12-nocheck --a12-only; prove A12-reject-multiorg --a12-only
bash "$S" --mutation-apply A10-body-org-read; bash "$S" --a10-only >/dev/null 2>&1 && { bash "$S" --mutation-revert A10-body-org-read; echo "FAIL: A10 未报红"; exit 1; }; bash "$S" --mutation-revert A10-body-org-read
echo OK
```
**硬阈值**: a10 正常绿；7 变异全部 proven-to-fire。

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud
**接线**：**不新建 workflow**——接入既有 `e2e-knowledge-hub-path3.yml`：paths 加 org spec/config/smoke/sprint 目录；linux job 加 `test:org-context` + org smoke a10/7 变异；windows job（**A33(c)：不许加 job 级 if**）加真调 `sprints/08221800-org-context-switch-core/e2e-org-switch-run.ps1 -Grep @org-` 的 step + `org-switch-screenshots` upload。

> 下面 bash 块是 **evaluator 模式B 的 final-e2e**：真浏览器跑在 GitHub Actions windows-latest 上，本地无从复现，判据 = 那个 windows job 的 conclusion + 本刀 org step 的 conclusion + 从 artifact 真取回本轮截图。

```bash
#!/bin/bash
set -uo pipefail
WF=e2e-knowledge-hub-path3.yml
B=$(git rev-parse --abbrev-ref HEAD)
R=$(gh run list --workflow "$WF" --branch "$B" --limit 1 --json databaseId,headSha,conclusion,url) || { echo "FAIL: gh run list"; exit 1; }
echo "$R" | jq -e 'length > 0' >/dev/null || { echo "FAIL: 分支 $B 上无 $WF 运行记录 —— 本刀 spec 成了孤儿"; exit 1; }
ID=$(echo "$R" | jq -r '.[0].databaseId'); echo "run=$(echo "$R" | jq -r '.[0].url')"
[ "$(echo "$R" | jq -r '.[0].headSha')" = "$(git rev-parse HEAD)" ] || { echo "FAIL: 陈旧 run（headSha != HEAD）"; exit 1; }
J=$(gh run view "$ID" --json jobs)
echo "$J" | jq -e '[.jobs[] | select(.name | test("windows")) | select(.conclusion == "success")] | length > 0' >/dev/null \
  || { echo "FAIL: windows job 未成功"; echo "$J" | jq -r '.jobs[] | "  job=\(.name) conclusion=\(.conclusion)"'; exit 1; }
echo "$J" | jq -e '[.jobs[] | select(.name | test("windows")) | .steps[] | select(.name | test("多组织切换|org")) | select(.conclusion == "success")] | length > 0' >/dev/null \
  || { echo "FAIL: windows job 里没有跑本刀 org 切换那一段"; exit 1; }
echo "$J" | jq -e '[.jobs[] | select(.name | test("linux")) | select(.conclusion == "success")] | length > 0' >/dev/null \
  || { echo "FAIL: linux job 未成功"; exit 1; }
D=$(mktemp -d)
gh run download "$ID" -n org-switch-screenshots -D "$D" || { echo "FAIL: 下不到本刀截图 artifact org-switch-screenshots"; exit 1; }
N=$(find "$D" -name '*.png' | wc -l | tr -d ' ')
[ "$N" -ge 3 ] || { echo "FAIL: artifact 里只有 $N 张截图（需 >=3）"; exit 1; }
for f in $(find "$D" -name '*.png'); do [ -s "$f" ] || { echo "FAIL: 空截图 $f"; exit 1; }; done
DST=sprints/08221800-org-context-switch-core/screenshots; mkdir -p "$DST"; find "$D" -name '*.png' -exec cp {} "$DST"/ \;
echo "OK: 多组织切换 Golden Path 真浏览器全链通过，截图 $N 张已落 $DST"
```

### 交付物规格：`sprints/08221800-org-context-switch-core/e2e-org-switch-run.ps1`（已产出）
复用 Sprint B 的 `e2e-rows-lib.ps1`（Set-DbEnvFromUrl / New-TwoTenantSeed / Invoke-Psql / Start-Api / Get-SessionCookie / Clear-Port / Wait-Port / Stop-Procs），在双租户种子上加跨两企业成员 dave；起真 apps/api + 真 hub（**不走 VITE_SKIP_AUTH**，验真 AuthContext 会话恢复→拉企业→切换器）；spec 禁 `page.route()`；ASCII 标签 `@org-`；截图晚于脚本启动（防历史产物冒充）。

### 交付物规格：`apps/staff-hub/e2e/org-context-switch.spec.ts`（已产出）
变体C 死规则：零 `page.route()`、全打真 apps/api + 真 PG；cookie 由 ps1 注入浏览器上下文；ASCII 标签。覆盖：
- `@org-switch-flow`：dave 未选阻断选择（org-selection-required）→ 选定A（current-org-label 含A名）→ 切换下拉切到B（current-org-label 含B名）→ 截图 01/02/03
- `@org-single-transparent`：alice 单企业透明进入、无 org-switcher-trigger（A8）→ 截图 04

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 组织解析与选定（A4/A8/orgs/switch） | `tests/org-context-resolve.test.ts` | `Step1`、`A4 缺失`、`A4 伪造`、`A8` | 端点缺/解析未反转 → red |
| 跨企业隔离与原子切换（A1/A3/A5/A6） | `tests/org-context-isolation.test.ts` | `A1`、`A3`、`A5`、`A6` | active_org 未落/隔离未成 → red |
| LIVE 重校 + 审计（A7/A11） | `tests/org-context-live-audit.test.ts` | `A7`、`A11 deny`、`A11 switch` | 登录快照/审计缺 → red |
| A12 维度自检（真库双向） | `tests/org-context-dimension.test.ts` | `维度齐备通过`、`维度缺失拒启动` | 自检未反转 → red |
