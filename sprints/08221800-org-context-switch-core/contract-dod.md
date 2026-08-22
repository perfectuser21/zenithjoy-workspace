---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 多组织切换第一刀 · 核心 active_org 解析 + 前端切换器

**范围**: 服务端会话态 active_org 维度（J7 载体=better-auth session 附加字段）+ 归属企业列表/切换/admin 供给端点 + 命门①② 两闸受控反转（workbench-auth 409 / knowledge-auth LIMIT1 → 按 active_org 解析）+ Gate 0 四处同刀（A30-2 归属唯一放开 / A11 单组织自检反转成 A12 维度自检 / workbenchAuthGuard / selfHealOwnerMember 退役）+ 每请求 LIVE 成员重校 + org 审计中间件 + apps/staff-hub 企业切换器/当前企业标识/AuthContext org 维度/多 tab 草稿拦截 + A10 静态守卫扩域（org 中间件，**不含 agent-context**）。**不在本刀**：命门③ tenant-context 三旁门 + works 家族十余路由迁移（A2）、命门④ agent-context（A9）。
**大小**: L

## ARTIFACT 条目

- [x] [ARTIFACT] **ART-1 active_org 会话载体 + org 审计表 migration** —— 20260823 migration 给 public.session 加 activeOrg 列、建 zenithjoy.org_audit 表；auth.ts session.additionalFields.activeOrg 已声明
  Test: manual:bash -c 'M=apps/api/db/migrations/20260823_000000_org_context_active_org.sql; [ -f "$M" ] || { echo FAIL: 缺 migration; exit 1; }; grep -q "session.*ADD COLUMN.*activeOrg" "$M" || { echo FAIL: 未加 session.activeOrg; exit 1; }; grep -q "org_audit" "$M" || { echo FAIL: 未建 org_audit; exit 1; }; grep -q "activeOrg" apps/api/src/auth.ts || { echo FAIL: auth.ts 未声明 additionalFields; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] **ART-2 org 解析核心 active-org.ts + 两闸受控反转** —— active-org.ts 有 resolveActiveOrg/queryMemberOrgIds/setSessionActiveOrg/auditOrgEvent；workbench-auth 与 knowledge-auth 都 import 自它、且 knowledge-auth 不再有 `ORDER BY created_at LIMIT 1` 静默取一
  Test: manual:bash -c 'A=apps/api/src/middleware/active-org.ts; [ -f "$A" ] || { echo FAIL: 缺 active-org.ts; exit 1; }; for f in resolveActiveOrg queryMemberOrgIds setSessionActiveOrg auditOrgEvent; do grep -q "export function $f\|export async function $f" "$A" || { echo "FAIL: active-org 缺 $f"; exit 1; }; done; grep -q "from .\./active-org." apps/api/src/middleware/workbench-auth.ts || { echo FAIL: workbench-auth 未用 active-org; exit 1; }; grep -q "from .\./active-org." apps/api/src/middleware/knowledge-auth.ts || { echo FAIL: knowledge-auth 未用 active-org; exit 1; }; grep -q "ORDER BY created_at LIMIT 1" apps/api/src/middleware/knowledge-auth.ts && { echo "FAIL: knowledge-auth 仍在静默取最早一条"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] **ART-3 org 端点在案且 session-only** —— GET /api/knowledge/org（列企业）+ POST /api/knowledge/org/switch（切换）挂 orgContextRouter；admin 供给 POST /api/admin/org/grant 挂独立 adminOrgRouter；app.ts 挂 orgContextRouter 在 workbenchRouter **之后**（保 A2 扫描域）
  Test: manual:bash -c 'O=apps/api/src/routes/org-context.ts; [ -f "$O" ] || { echo FAIL: 缺 org-context.ts; exit 1; }; grep -q "switch" "$O" || { echo FAIL: 缺 switch 端点; exit 1; }; [ -f apps/api/src/routes/admin-org.ts ] || { echo FAIL: 缺 admin-org.ts; exit 1; }; grep -q "app.use(.\/api\/knowledge\/org., orgContextRouter)" apps/api/src/app.ts || { echo FAIL: 未挂 orgContextRouter; exit 1; }; grep -q "app.use(.\/api\/admin\/org., adminOrgRouter)" apps/api/src/app.ts || { echo FAIL: 未挂 adminOrgRouter; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] **ART-4 Gate 0 四处同刀** —— staff-directory A30_CHECKS 不含 A30-2（归属唯一放开）；single-org-selfcheck 导出 assertActiveOrgDimensionReady（A11→A12 反转）且 index.ts 调它；tenant-context selfHealOwnerMember 已删
  Test: manual:bash -c 'grep -q "A30-2" apps/api/src/staff-directory.ts && grep -q "A30_CHECKS = .\[.A30-1a., .A30-1b., .A30-3." apps/api/src/staff-directory.ts || true; node -e "const s=require(\"fs\").readFileSync(\"apps/api/src/staff-directory.ts\",\"utf8\"); const m=s.match(/A30_CHECKS = \[([^\]]*)\]/); if(!m||/A30-2/.test(m[1])){console.error(\"FAIL: A30_CHECKS 仍含 A30-2\");process.exit(1)}"; grep -q "assertActiveOrgDimensionReady" apps/api/src/startup/single-org-selfcheck.ts || { echo FAIL: 缺 A12 自检; exit 1; }; grep -q "assertActiveOrgDimensionReady" apps/api/src/index.ts || { echo FAIL: index.ts 未调 A12 自检; exit 1; }; grep -q "selfHealOwnerMember" apps/api/src/middleware/tenant-context.ts && { echo "FAIL: selfHealOwnerMember 未退役"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] **ART-5 A10 静态守卫扩域到 org 中间件（不含 agent-context）** —— org-context-switch-smoke.sh 的 A10 扫描域含 active-org.ts/org-context.ts/两闸，禁用字面量含 X-Org-Id，且扫描域 <4 项即 exit 1；不含 agent-context
  Test: manual:bash -c 'S=.github/workflows/scripts/smoke/org-context-switch-smoke.sh; [ -f "$S" ] || { echo FAIL: 缺 org smoke; exit 1; }; grep -q "X-Org-Id" "$S" || { echo FAIL: 禁用字面量未含 X-Org-Id; exit 1; }; grep -q "active-org.ts" "$S" || { echo FAIL: A10 扫描域缺 active-org; exit 1; }; grep -q "agent-context" "$S" && { echo "FAIL: 本刀 A10 不应含 agent-context"; exit 1; }; bash "$S" --a10-only >/dev/null 2>&1 || { echo FAIL: a10 正常态未过; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] **ART-6 前端切换器 + 当前企业标识 + AuthContext org 维度 + 多 tab 草稿拦截** —— OrgSwitcher.tsx 有 current-org-label/org-switcher-trigger/org-selection-required/org-switch-draft-guard testid；AuthContext 有 switchOrg/orgs/needsOrgSelection；BroadcastChannel org-context
  Test: manual:bash -c 'C=apps/staff-hub/src/components/OrgSwitcher.tsx; [ -f "$C" ] || { echo FAIL: 缺 OrgSwitcher; exit 1; }; for t in current-org-label org-switcher-trigger org-selection-required org-switch-draft-guard; do grep -q "$t" "$C" || { echo "FAIL: OrgSwitcher 缺 testid $t"; exit 1; }; done; A=apps/staff-hub/src/contexts/AuthContext.tsx; for s in switchOrg orgs needsOrgSelection; do grep -q "$s" "$A" || { echo "FAIL: AuthContext 缺 $s"; exit 1; }; done; grep -rq "BroadcastChannel" apps/staff-hub/src/ || { echo FAIL: 无多 tab 广播; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] **ART-7 org E2E spec 存在、零请求拦截、ASCII 标签** —— org-context-switch.spec.ts 存在、零 page.route(、含 @org-switch-flow / @org-single-transparent，且断言当前企业标识 + 阻断选择
  Test: manual:bash -c 'SP=apps/staff-hub/e2e/org-context-switch.spec.ts; [ -f "$SP" ] || { echo FAIL: 缺 org spec; exit 1; }; grep -q "page.route(" "$SP" && { echo "FAIL: spec 出现请求拦截(变体C 死规则)"; exit 1; }; for T in "@org-switch-flow" "@org-single-transparent"; do grep -q "$T" "$SP" || { echo "FAIL: spec 缺标签 $T"; exit 1; }; done; grep -q "current-org-label" "$SP" || { echo FAIL: spec 未断言当前企业标识; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] **ART-8 CI 逐字接线（接入既有 path3 workflow，不重造）** —— e2e-knowledge-hub-path3.yml 的 paths 含 org spec/config/smoke/sprint 目录；linux job 含 test:org-context + org smoke a10/变异；windows job 有真调 e2e-org-switch-run.ps1 的 step + org-switch-screenshots upload；windows job 仍无 job 级事件门（A33(c) 不回退）
  Test: manual:bash -c 'WF=.github/workflows/e2e-knowledge-hub-path3.yml; for P in "org-context-switch.spec.ts" "vitest.org-context.config.ts" "org-context-switch-smoke.sh" "08221800-org-context-switch-core" "test:org-context" "e2e-org-switch-run.ps1" "org-switch-screenshots"; do grep -q "$P" "$WF" || { echo "FAIL: workflow 缺 $P"; exit 1; }; done; node -e "const y=require(\"fs\").readFileSync(\".github/workflows/e2e-knowledge-hub-path3.yml\",\"utf8\");const m=y.match(/windows-real-browser:[\s\S]*?(?=\n  [a-z]|$)/);if(!m)process.exit(1);const head=m[0].split(\"\n\").filter(l=>/^    [a-z_]+:/.test(l)).join(\"\n\");process.exit(/if:.*(workflow_dispatch|github\.event_name)/.test(head)?1:0)" || { echo "FAIL: windows job 加了事件条件门(A33c 回退)"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR 条目（真 Postgres + 真会话，evaluator 直接跑）

- [x] [BEHAVIOR] 本刀 4 个测试文件被 vitest **真收集真跑**：4 suite 全绿、用例数 15、失败 0，且跑的**恰是**本刀那 4 个文件（零收集时 vitest 自报错，不假绿）
  Test: manual:bash -c 'PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo "FAIL: 缺 E2E_DATABASE_URL/DATABASE_URL"; exit 1; }; O=/tmp/org-vitest.json; rm -f "$O"; (cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts --reporter=json --outputFile="$O") >/tmp/org-vitest.log 2>&1; [ -f "$O" ] || { echo "FAIL: vitest 未产报告(多半零收集)"; tail -30 /tmp/org-vitest.log; exit 1; }; jq -e "(.testResults|length)==4 and .numTotalTests==15 and .numFailedTests==0 and .success==true" < "$O" >/dev/null || { echo "FAIL: 收集/通过数不符"; jq -c "{files:(.testResults|length),tests:.numTotalTests,failed:.numFailedTests,ok:.success}" < "$O"; exit 1; }; jq -e "[.testResults[].name|select(test(\"org-context-(resolve|isolation|live-audit|dimension)\\\\.test\\\\.ts$\"))]|length==4" < "$O" >/dev/null || { echo "FAIL: 跑的不是本刀那 4 个文件"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] A4 缺失+伪造全挡：dave（归属 A/B 两家）未选 active_org 调数据端点 → 409 ORG_SELECTION_REQUIRED（要求先选，非静默取一个）；switch-org 到不归属的 org → 403 ORG_FORBIDDEN 且当前企业不变
  Test: manual:bash -c 'PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo FAIL: 缺 PG; exit 1; }; (cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts ../../sprints/08221800-org-context-switch-core/tests/org-context-resolve.test.ts -t "A4" --reporter=dot) || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] A1/A3/A5/A6 隔离与原子切换：dave 切到 A 建表 psql tenant_id=A（A3）；切到 B 建表落 B、A 读不到（A5）；active_org=A 时 GET B 的表 id 与随机 id 逐字节同形 404（A1）；A→B 切换后立即 GET A 的表 id → 404、切回又 200（A6）
  Test: manual:bash -c 'PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo FAIL: 缺 PG; exit 1; }; (cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts ../../sprints/08221800-org-context-switch-core/tests/org-context-isolation.test.ts --reporter=dot) || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] A7 LIVE 实时重校 + A11 org 审计：active_org=A 有效期间删 dave 的 A 归属行 → 下一请求当次挡 ORG_FORBIDDEN 并清 active_org（LIVE 非登录快照）；越权/切换各产 resolve_deny/switch 审计行
  Test: manual:bash -c 'PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo FAIL: 缺 PG; exit 1; }; (cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts ../../sprints/08221800-org-context-switch-core/tests/org-context-live-audit.test.ts --reporter=dot) || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] A8 单企业零回归：alice 单企业账号 → active_org_id 直接=那一家、needs_selection=false、数据端点无需选择即放行；路③ relations/rows/views 三套基座回归全绿（59 用例）
  Test: manual:bash -c 'PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo FAIL: 缺 PG; exit 1; }; (cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts ../../sprints/08221800-org-context-switch-core/tests/org-context-resolve.test.ts -t "A8" --reporter=dot) || exit 1; for c in rows views relations; do (cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.workbench-$c.config.ts --reporter=dot) || { echo "FAIL: 路③ $c 回归红"; exit 1; }; done; echo OK'
  期望: OK

- [x] [BEHAVIOR] A12 双向维度自检（真库）：多组织成员 + 维度齐备（真 session 有 activeOrg 列）→ 正常通过；多组织成员 + 维度缺失（指向无列的表）→ 拒绝启动抛 A12-DIMENSION-MISSING
  Test: manual:bash -c 'PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo FAIL: 缺 PG; exit 1; }; (cd apps/api && E2E_DATABASE_URL="$PG" DATABASE_URL="$PG" npx vitest run --config vitest.org-context.config.ts ../../sprints/08221800-org-context-switch-core/tests/org-context-dimension.test.ts --reporter=dot) || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] A10 静态守卫：org 中间件/端点/两闸源码零身份头（含 X-Org-Id）、零 req.body/query 取 org 维度；扫描域 <4 项即 exit 1（防空集假绿）
  Test: manual:bash -c 'bash .github/workflows/scripts/smoke/org-context-switch-smoke.sh --a10-only || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] 6+1 变异 proven-to-fire：A1(404 带 timestamp)/A4(≥2 未选静默取第一个)/A7(信任陈旧 active_org)/A10(从 req.body 取 org)/A11(审计不落库)/A12(维度缺失也放行 · 多组织即退出)——注入缺陷对应段必转红、复原后转绿
  Test: manual:bash -c 'PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; [ -n "$PG" ] || { echo FAIL: 缺 PG; exit 1; }; export E2E_DATABASE_URL="$PG" DATABASE_URL="$PG"; S=.github/workflows/scripts/smoke/org-context-switch-smoke.sh; prove(){ M="$1"; SEG="$2"; bash "$S" --mutation-apply "$M" || return 1; if bash "$S" "$SEG" >/dev/null 2>&1; then bash "$S" --mutation-revert "$M"; echo "FAIL: $M 下 $SEG 未转红"; return 1; fi; bash "$S" --mutation-revert "$M"; }; prove A1-404-timestamp --a1-only || exit 1; prove A4-silent-first --a4-only || exit 1; prove A7-trust-stale --a7-only || exit 1; prove A11-no-audit --a11-only || exit 1; prove A12-nocheck --a12-only || exit 1; prove A12-reject-multiorg --a12-only || exit 1; bash "$S" --mutation-apply A10-body-org-read; if bash "$S" --a10-only >/dev/null 2>&1; then bash "$S" --mutation-revert A10-body-org-read; echo "FAIL: A10 变异未报红"; exit 1; fi; bash "$S" --mutation-revert A10-body-org-read; echo OK'
  期望: OK

- [x] [BEHAVIOR] 前端组件测试真跑真绿：staff-hub vitest 全绿（含 OrgSwitcher/AuthContext org 逻辑），tsc 干净
  Test: manual:bash -c '(cd apps/staff-hub && npx vitest run --reporter=dot) >/tmp/hub-vitest.log 2>&1 || { echo FAIL: staff-hub 组件测试红; tail -20 /tmp/hub-vitest.log; exit 1; }; (cd apps/staff-hub && npx tsc --noEmit) || { echo FAIL: staff-hub tsc 不干净; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑 windows_cloud）

- [x] [BEHAVIOR:E2E] 用户在真浏览器走完多组织切换 Golden Path（windows-latest），本刀 org step + 截图可视化验证
  Screenshots:
    - 01-org-selection.png        期望：dave 归属两家、未选 → 阻断式企业选择界面（两个企业选项可见）
    - 02-org-selected-A.png       期望：选定企业A后 → 顶部「当前企业：{A名}」标识 + 切换下拉可见，阻断消失
    - 03-org-switched-B.png       期望：从切换下拉切到企业B后 → 顶部标识变为「当前企业：{B名}」
    - 04-org-single-transparent.png 期望：alice 单企业 → 透明进入、顶部显当前企业、**无**切换下拉（A8 零回归）
  路径格式：sprints/08221800-org-context-switch-core/screenshots/<step>.png
  期望：e2e-knowledge-hub-path3.yml 的 windows job conclusion==success + 本刀 org step（e2e-org-switch-run.ps1 -Grep @org-）success + 从 artifact org-switch-screenshots 取回 ≥3 张非空截图（判据见 contract-draft.md `## E2E 验收` bash 块）
