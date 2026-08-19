---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: 员工知识中枢 路① 第一刀（G4 第零刀 + S1 最小闭环）

**范围**: `feishu-login` 签发服务端会话 + 按员工目录声明组织入驻；员工目录（分组 env + `STAFF_ORG_MAP`）+ A30 启动自检四项；`knowledgeAuthGuard`（只信会话、零 header 回落）；经验录入 API + 「最近沉淀」页；zenithjoy 只读投影表 schema + 只读读端；A27 静态守卫；smoke 落盘并进 baseline。
**不在范围**: S2 问答/检索/embedding、S3 注入、cecelia `learnings` schema 改造与存量回填、A31 企业B 双向断言、部门与角色三层。
**大小**: L

**执行前置**（evaluator 跑下列命令前必须已具备）：
- 真 Postgres 可达，连接串在 `$PGURL`（CI 里由 postgres service 提供，本地默认 `postgresql://postgres@localhost:5432/cecelia`）
- `apps/api` 已 `npm run build`，`apps/api/db/migrations/*.sql` 已全部执行
- 两家企业的 `zenithjoy.tenants` 行已建，id 分别在 `$ORGA_TENANT_ID` / `$ORGB_TENANT_ID`
- API 进程已起在 `$API_PORT`，`FEISHU_API_BASE` 指向假飞书上游，会话 cookie 已存进 `/tmp/kh-cookie.txt`
- 上述环境由 `## E2E 验收` 段第一个 bash 块的 0-4 步统一建立；单跑某条 [BEHAVIOR] 时先跑该段前置

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `knowledgeAuthGuard` 中间件存在且源码零身份头名（A27 扫描目标本体）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/middleware/knowledge-auth.ts','utf8');if(/x-user-email|x-feishu-user-id/i.test(c))process.exit(1);if(!c.includes('knowledgeAuthGuard'))process.exit(1)"

- [ ] [ARTIFACT] 员工目录模块存在且实现四项自检标识（A30-1a / A30-1b / A30-2 / A30-3）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/staff-directory.ts','utf8');for(const k of ['A30-1a','A30-1b','A30-2','A30-3','STAFF_ORG_MAP'])if(!c.includes(k))process.exit(1)"

- [ ] [ARTIFACT] 投影表 migration 存在于 `apps/api/db/migrations/`，含 `org_id` 且 NOT NULL，DDL 幂等
  Test: node -e "const fs=require('fs');const d='apps/api/db/migrations';const f=fs.readdirSync(d).find(n=>n.includes('knowledge_entries_projection'));if(!f)process.exit(1);const c=fs.readFileSync(d+'/'+f,'utf8');if(!/org_id\s+uuid\s+NOT NULL/i.test(c))process.exit(1);if(!/IF NOT EXISTS/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] 前端知识面用独立 `knowledgeFetch`（只带 cookie，零身份头），且不复用 `adminFetch`
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('apps/staff-hub/src/lib/knowledgeFetch.ts','utf8');if(/X-User-Email|X-Feishu-User-Id/i.test(c))process.exit(1);if(!c.includes(\"credentials\"))process.exit(1);for(const p of ['apps/staff-hub/src/pages/KnowledgeNewPage.tsx','apps/staff-hub/src/pages/KnowledgeRecentPage.tsx']){const s=fs.readFileSync(p,'utf8');if(s.includes('adminFetch'))process.exit(1)}"

- [ ] [ARTIFACT] smoke 脚本落盘且**已登记进 baseline**（未登记 = 只 warning 不闸，仓库实测 C11）
  Test: node -e "const fs=require('fs');if(!fs.existsSync('.github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh'))process.exit(1);const b=fs.readFileSync('.github/workflows/scripts/smoke-baseline.txt','utf8').split('\n').map(s=>s.trim());if(!b.includes('knowledge-hub-path1-smoke.sh'))process.exit(1)"

- [ ] [ARTIFACT] windows_cloud 车道入口 `e2e-verify.ps1` 存在，且 UI spec 禁 `page.route()`
  Test: node -e "const fs=require('fs');const d='sprints/08192114-员工知识中枢-路-经验沉淀与问答-ade79e4e';if(!fs.existsSync(d+'/e2e-verify.ps1'))process.exit(1);const s=fs.readFileSync('apps/staff-hub/e2e/knowledge-hub-path1.spec.ts','utf8');if(s.includes('page.route('))process.exit(1)"

- [ ] [ARTIFACT] 假飞书上游带生产门禁（`NODE_ENV=production` 一律 404），沿用本仓既有 `_smoke-fake-*` 模式
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/_smoke-fake-feishu.ts','utf8');if(!/production/.test(c))process.exit(1);if(!/404/.test(c))process.exit(1)"

---

## BEHAVIOR 条目

### Golden Path Step 1 — A30 员工目录一致性自检（fail-closed 启动闸）

- [ ] [BEHAVIOR] 四项成立时 API 起得来，**且启动日志证明自检真跑过**（只验"服务起来了"是假绿——没实现自检时服务照样起）
  Test: manual:bash -c 'curl -sf "http://localhost:$API_PORT/api/health" >/dev/null || { echo "FAIL: A30 四项成立但服务未起"; exit 1; }; grep -q "A30 staff-directory selfcheck passed" /tmp/kh-api.log || { echo "FAIL: 启动日志无 A30 自检通过标记，自检根本没跑"; exit 1; }; for k in A30-1a A30-1b A30-2 A30-3; do grep -q "$k" /tmp/kh-api.log || { echo "FAIL: 启动日志未列出检查项 $k"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] A30 四条变异各自报红且日志指明违规项（proven-to-fire，缺一条不算）
  Test: manual:bash -c 'set -u; P=$((API_PORT+100)); mut(){ n="$1"; shift; l="/tmp/dod-a30-$n.log"; rc=0; env "$@" PORT=$P timeout 40 node -r dotenv/config apps/api/dist/index.js > "$l" 2>&1 || rc=$?; [ "$rc" -ne 0 ] || { echo "FAIL: $n 未报红"; exit 1; }; [ "$rc" -ne 124 ] || { echo "FAIL: $n 服务起来了被 timeout 杀掉"; exit 1; }; grep -q "$n" "$l" || { echo "FAIL: $n 报红但未指明违规项"; exit 1; }; }; mut A30-1a STAFF_FEISHU_OPENIDS__ORGA="$ORGA_OPENID,ou_dod_ghost"; mut A30-1b STAFF_FEISHU_OPENIDS="$ORGA_OPENID,$NOORG_OPENID,ou_dod_orphan"; mut A30-2 STAFF_FEISHU_OPENIDS__ORGB="$ORGB_OPENID,$ORGA_OPENID"; mut A30-3 STAFF_ORG_MAP="ORGA:00000000-0000-4000-8000-000000000000,ORGB:$ORGB_TENANT_ID"; echo OK'
  期望: OK

### Golden Path Step 2 — 登录签会话 + 按声明组织入驻（A29 ①②③）

- [ ] [BEHAVIOR] 白名单员工登录 → `Set-Cookie` 三属性齐全（httpOnly / Secure / SameSite=Lax）
  Test: manual:bash -c 'curl -sf -D /tmp/dod-login-hdr.txt -c /tmp/kh-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/feishu-login" -H "Content-Type: application/json" -d "{\"code\":\"e2e-code-orga\"}" -o /dev/null || { echo "FAIL: 登录失败"; exit 1; }; for a in HttpOnly Secure SameSite=Lax; do grep -i "^set-cookie:" /tmp/dod-login-hdr.txt | grep -qi "$a" || { echo "FAIL: cookie 缺 $a"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 成员行挂在**声明组织**下、未落 Personal-% 租户、登录未新建租户
  Test: manual:bash -c 'M=$(psql "$PGURL" -t -A -c "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id='"'"'$ORGA_OPENID'"'"'"); [ "$M" = "$ORGA_TENANT_ID" ] || { echo "FAIL: 挂错组织 got=$M want=$ORGA_TENANT_ID"; exit 1; }; P=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_members tm JOIN zenithjoy.tenants t ON t.id=tm.tenant_id WHERE tm.feishu_user_id='"'"'$ORGA_OPENID'"'"' AND t.name LIKE '"'"'Personal-%'"'"'"); [ "$P" = "0" ] || { echo "FAIL: 命中 Personal-% count=$P"; exit 1; }; echo OK'
  期望: OK

### Golden Path Step 3 — 无归属声明拒绝登录（禁止默认组织兜底）

- [ ] [BEHAVIOR] 员工目录无归属声明的账号 → 403 NO_ORG_ASSIGNMENT，无 Set-Cookie，零成员行
  Test: manual:bash -c 'C=$(curl -s -o /tmp/dod-noorg.json -D /tmp/dod-noorg-hdr.txt -w "%{http_code}" -X POST "http://localhost:$API_PORT/api/staff/feishu-login" -H "Content-Type: application/json" -d "{\"code\":\"e2e-code-noorg\"}"); [ "$C" = "403" ] || { echo "FAIL: 期望 403 得到 $C"; exit 1; }; jq -e ".error.code == \"NO_ORG_ASSIGNMENT\"" /tmp/dod-noorg.json >/dev/null || { echo "FAIL: 错误码不符"; exit 1; }; if grep -qi "^set-cookie:" /tmp/dod-noorg-hdr.txt; then echo "FAIL: 拒绝路径仍签会话"; exit 1; fi; N=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_members WHERE feishu_user_id='"'"'$NOORG_OPENID'"'"'"); [ "$N" = "0" ] || { echo "FAIL: 拒绝路径写了成员行 count=$N"; exit 1; }; echo OK'
  期望: OK

### Golden Path Step 4 — 身份只来自会话（三种文案各不相同 / 伪造头无效）

- [ ] [BEHAVIOR] 无会话调知识端点 → 401 SESSION_REQUIRED，文案「登录已失效，请重新登录」
  Test: manual:bash -c 'C=$(curl -s -o /tmp/dod-401.json -w "%{http_code}" "http://localhost:$API_PORT/api/staff/knowledge/recent"); [ "$C" = "401" ] || { echo "FAIL: 期望 401 得到 $C"; exit 1; }; jq -e ".error.code == \"SESSION_REQUIRED\"" /tmp/dod-401.json >/dev/null || { echo "FAIL: 错误码不符"; exit 1; }; M=$(jq -r ".error.message" /tmp/dod-401.json); [ "$M" = "登录已失效，请重新登录" ] || { echo "FAIL: 文案不符 got=$M"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 伪造 `X-User-Email` + `X-Feishu-User-Id` 头调录入 → 判定不变（仍 401）且账本零新增（本 GP 命门）
  Test: manual:bash -c 'B=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings"); C=$(curl -s -o /dev/null -w "%{http_code}" -H "X-User-Email: $ORGA_EMAIL" -H "X-Feishu-User-Id: $ORGA_OPENID" -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" -H "Content-Type: application/json" -d "{\"trigger_condition\":\"forged\",\"conclusion\":\"forged\",\"evidence_url\":\"https://example.com/forged\"}"); [ "$C" = "401" ] || { echo "FAIL: 伪造头改变判定 got=$C"; exit 1; }; A=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings"); [ "$B" = "$A" ] || { echo "FAIL: 伪造头写进账本 $B -> $A"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 有会话但无成员行 → 403 NO_TENANT，文案「没有权限」，与 401 文案不同
  Test: manual:bash -c 'psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenant_members WHERE feishu_user_id='"'"'$ORGA_OPENID'"'"'"; C=$(curl -s -o /tmp/dod-403.json -w "%{http_code}" -b /tmp/kh-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/recent"); psql "$PGURL" -q -c "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('"'"'$ORGA_TENANT_ID'"'"','"'"'$ORGA_OPENID'"'"','"'"'member'"'"') ON CONFLICT DO NOTHING"; [ "$C" = "403" ] || { echo "FAIL: 期望 403 得到 $C"; exit 1; }; jq -e ".error.code == \"NO_TENANT\"" /tmp/dod-403.json >/dev/null || { echo "FAIL: 错误码不符"; exit 1; }; M=$(jq -r ".error.message" /tmp/dod-403.json); [ "$M" = "没有权限" ] || { echo "FAIL: 文案不符 got=$M"; exit 1; }; echo OK'
  期望: OK

### Golden Path Step 5 — 录入落 Cecelia 账本带归属 / 缺组织即拒写

- [ ] [BEHAVIOR] 录入成功 → 201，`data.org_id` 等于声明组织，账本本轮真有该行且带 org_id 与 author_member_id
  Test: manual:bash -c 'T0=$(psql "$PGURL" -t -A -c "SELECT now()"); U="https://github.com/perfectuser21/zenithjoy-workspace/pull/dod-$(date +%s)"; R=$(curl -s -o /tmp/dod-entry.json -w "%{http_code}" -b /tmp/kh-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" -H "Content-Type: application/json" -d "{\"trigger_condition\":\"DoD 触发条件\",\"conclusion\":\"DoD 结论\",\"evidence_url\":\"$U\"}"); [ "$R" = "201" ] || { echo "FAIL: 期望 201 得到 $R"; exit 1; }; jq -e --arg o "$ORGA_TENANT_ID" ".data.org_id == \$o" /tmp/dod-entry.json >/dev/null || { echo "FAIL: org_id 不等于声明组织"; exit 1; }; E=$(jq -r ".data.entry_id" /tmp/dod-entry.json); N=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings WHERE id='"'"'$E'"'"' AND metadata->>'"'"'org_id'"'"'='"'"'$ORGA_TENANT_ID'"'"' AND metadata->>'"'"'author_member_id'"'"' IS NOT NULL AND created_at > '"'"'$T0'"'"'"); [ "$N" = "1" ] || { echo "FAIL: 账本无本轮带归属行 count=$N"; exit 1; }; echo "$E" > /tmp/dod-entry-id.txt; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 录入响应 schema 完整且禁用字段一个不出现（防语义漂移）
  Test: manual:bash -c 'jq -e "keys == [\"data\",\"success\"]" /tmp/dod-entry.json >/dev/null || { echo "FAIL: 顶层 keys 不完整"; exit 1; }; jq -e ".data | keys == [\"created_at\",\"entry_id\",\"org_id\"]" /tmp/dod-entry.json >/dev/null || { echo "FAIL: data 层 keys 不完整"; exit 1; }; for k in tenant_id learning_id user_email feishu_user_id; do jq -e "(has(\$k) or (.data|has(\$k))) | not" --arg k "$k" /tmp/dod-entry.json >/dev/null || { echo "FAIL: 出现禁用字段 $k"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 缺组织上下文 → 403 NO_ORG_CONTEXT 且账本零新增（fail-closed，不写无归属行）
  Test: manual:bash -c 'B=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings"); psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenant_members WHERE feishu_user_id='"'"'$ORGA_OPENID'"'"'"; C=$(curl -s -o /tmp/dod-noctx.json -w "%{http_code}" -b /tmp/kh-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" -H "Content-Type: application/json" -d "{\"trigger_condition\":\"no-org\",\"conclusion\":\"no-org\",\"evidence_url\":\"https://example.com/no-org\"}"); psql "$PGURL" -q -c "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('"'"'$ORGA_TENANT_ID'"'"','"'"'$ORGA_OPENID'"'"','"'"'member'"'"') ON CONFLICT DO NOTHING"; [ "$C" = "403" ] || { echo "FAIL: 期望 403 得到 $C"; exit 1; }; K=$(jq -r ".error.code" /tmp/dod-noctx.json); case "$K" in NO_ORG_CONTEXT|NO_TENANT) : ;; *) echo "FAIL: 错误码非法 got=$K"; exit 1 ;; esac; A=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings"); [ "$B" = "$A" ] || { echo "FAIL: 仍写入账本 $B -> $A"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 非法 `evidence_url`（非 http/https）→ 400，且账本零新增（error path + 输入对抗面）
  Test: manual:bash -c 'B=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings"); C=$(curl -s -o /tmp/dod-badurl.json -w "%{http_code}" -b /tmp/kh-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" -H "Content-Type: application/json" -d "{\"trigger_condition\":\"x\",\"conclusion\":\"y\",\"evidence_url\":\"javascript:alert(1)\"}"); [ "$C" = "400" ] || { echo "FAIL: 期望 400 得到 $C"; exit 1; }; jq -e ".error.code | type == \"string\"" /tmp/dod-badurl.json >/dev/null || { echo "FAIL: 缺 error.code"; exit 1; }; A=$(psql "$PGURL" -t -A -c "SELECT count(*) FROM public.learnings"); [ "$B" = "$A" ] || { echo "FAIL: 非法输入写进账本"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 请求体里塞 `org_id` 想覆盖归属 → 被忽略，落库归属仍为会话声明组织（越权指令拒绝）
  Test: manual:bash -c 'R=$(curl -s -b /tmp/kh-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" -H "Content-Type: application/json" -d "{\"trigger_condition\":\"override\",\"conclusion\":\"override\",\"evidence_url\":\"https://example.com/ov\",\"org_id\":\"$ORGB_TENANT_ID\"}"); E=$(echo "$R" | jq -r ".data.entry_id"); [ -n "$E" ] && [ "$E" != "null" ] || { echo "FAIL: 录入未成功 $R"; exit 1; }; G=$(psql "$PGURL" -t -A -c "SELECT metadata->>'"'"'org_id'"'"' FROM public.learnings WHERE id='"'"'$E'"'"'"); [ "$G" = "$ORGA_TENANT_ID" ] || { echo "FAIL: 请求体覆盖了归属 got=$G want=$ORGA_TENANT_ID"; exit 1; }; psql "$PGURL" -q -c "DELETE FROM public.learnings WHERE id='"'"'$E'"'"'"; echo OK'
  期望: OK

### Golden Path Step 6 — 「最近沉淀」30 秒内可见 + 跨企业隔离

- [ ] [BEHAVIOR] 提交后 30 秒内在「最近沉淀」读到**那一条**（按 entry_id 精确命中，非"列表非空"）且证据链接逐字回读
  Test: manual:bash -c 'E=$(cat /tmp/dod-entry-id.txt); U=$(jq -r ".data.evidence_url // empty" /tmp/dod-entry.json); T0=$(date +%s); F=0; for i in $(seq 1 30); do L=$(curl -sf -b /tmp/kh-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/recent" || true); if [ -n "$L" ] && echo "$L" | jq -e --arg id "$E" "[.data.items[] | select(.entry_id == \$id)] | length == 1" >/dev/null 2>&1; then F=1; echo "$L" > /tmp/dod-recent.json; break; fi; sleep 1; done; EL=$(( $(date +%s) - T0 )); [ "$F" = "1" ] || { echo "FAIL: 30 秒内未读到 $E"; exit 1; }; [ "$EL" -le 30 ] || { echo "FAIL: 可见耗时 ${EL}s > 30s"; exit 1; }; jq -e --arg id "$E" "[.data.items[] | select(.entry_id == \$id) | select(.evidence_url | startswith(\"https://\"))] | length == 1" /tmp/dod-recent.json >/dev/null || { echo "FAIL: 证据链接缺失或非 https"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 「最近沉淀」列表零跨组织条目，且响应 schema keys 完整（跨企业硬隔离）
  Test: manual:bash -c 'jq -e "keys == [\"data\",\"success\"]" /tmp/dod-recent.json >/dev/null || { echo "FAIL: 顶层 keys 不完整"; exit 1; }; jq -e ".data | keys == [\"count\",\"items\"]" /tmp/dod-recent.json >/dev/null || { echo "FAIL: data 层 keys 不完整"; exit 1; }; X=$(jq --arg o "$ORGA_TENANT_ID" "[.data.items[] | select(.org_id != \$o)] | length" /tmp/dod-recent.json); [ "$X" = "0" ] || { echo "FAIL: 混入非本组织条目 count=$X"; exit 1; }; jq -e ".data.count == (.data.items | length)" /tmp/dod-recent.json >/dev/null || { echo "FAIL: count 与 items 长度不一致"; exit 1; }; echo OK'
  期望: OK

### Golden Path Step 7 — A27 静态守卫 proven-to-fire

- [ ] [BEHAVIOR] A27 守卫正向通过；往 `knowledgeAuthGuard` 加回一行读头后必须报红，且源码已还原
  Test: manual:bash -c 'S=".github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh"; KA="apps/api/src/middleware/knowledge-auth.ts"; bash "$S" --a27-only >/dev/null 2>&1 || { echo "FAIL: A27 正向未通过"; exit 1; }; cp "$KA" /tmp/dod-ka.bak; printf "\nexport const _a27Probe = (h: Record<string,string>) => h[\"x-user-email\"];\n" >> "$KA"; if bash "$S" --a27-only >/dev/null 2>&1; then cp /tmp/dod-ka.bak "$KA"; echo "FAIL: A27 变异未报红（守卫是空的）"; exit 1; fi; cp /tmp/dod-ka.bak "$KA"; git diff --exit-code -- "$KA" >/dev/null || { echo "FAIL: 变异后源码未还原"; exit 1; }; echo OK'
  期望: OK

### Golden Path Step 8 — A31 前置保护（既有 16 端点不被误伤）

- [ ] [BEHAVIOR] `adminFetch` 仍拼两个身份头、`staffGuard` 相对 base_sha 零 diff、端点计数字面等于 16
  Test: manual:bash -c 'grep -q "X-User-Email" apps/staff-hub/src/lib/adminFetch.ts || { echo "FAIL: adminFetch 摘除 X-User-Email"; exit 1; }; grep -q "X-Feishu-User-Id" apps/staff-hub/src/lib/adminFetch.ts || { echo "FAIL: adminFetch 摘除 X-Feishu-User-Id"; exit 1; }; git diff --exit-code 2fb21d5fed95d9d154e4c90df0fcdddf96b981c1 -- apps/api/src/middleware/staff.ts >/dev/null || { echo "FAIL: staffGuard 被改动"; exit 1; }; N=$(node .github/workflows/scripts/count-staffguard-endpoints.mjs); [ "$N" = "16" ] || { echo "FAIL: staffGuard 端点计数 $N != 16"; exit 1; }; echo OK'
  期望: OK

---

## Invariant 覆盖条目（GP 合同 lifelines 逐条映射）

- [ ] [BEHAVIOR] INV-1 [身份来自会话] 同一请求，只换 cookie 不换头 → 判定跟着会话走；只换头不换 cookie → 判定纹丝不动
  Test: manual:bash -c 'A=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/kh-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/recent"); B=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/kh-cookie.txt -H "X-User-Email: attacker@evil.local" -H "X-Feishu-User-Id: ou_attacker" "http://localhost:$API_PORT/api/staff/knowledge/recent"); [ "$A" = "$B" ] || { echo "FAIL: 加身份头改变了判定 $A -> $B"; exit 1; }; C=$(curl -s -o /dev/null -w "%{http_code}" -H "X-User-Email: $ORGA_EMAIL" -H "X-Feishu-User-Id: $ORGA_OPENID" "http://localhost:$API_PORT/api/staff/knowledge/recent"); [ "$C" = "401" ] || { echo "FAIL: 无会话仅凭头就拿到判定 got=$C"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-2 [跨企业硬隔离] 用企业B 会话读「最近沉淀」→ 看不到企业A 那条，且其列表零企业A 条目
  Test: manual:bash -c 'curl -sf -c /tmp/dod-cookie-b.txt -X POST "http://localhost:$API_PORT/api/staff/feishu-login" -H "Content-Type: application/json" -d "{\"code\":\"e2e-code-orgb\"}" -o /dev/null || { echo "FAIL: 企业B 登录失败"; exit 1; }; E=$(cat /tmp/dod-entry-id.txt); L=$(curl -sf -b /tmp/dod-cookie-b.txt "http://localhost:$API_PORT/api/staff/knowledge/recent"); echo "$L" | jq -e --arg id "$E" "[.data.items[] | select(.entry_id == \$id)] | length == 0" >/dev/null || { echo "FAIL: 企业B 看到了企业A 的条目"; exit 1; }; X=$(echo "$L" | jq --arg o "$ORGA_TENANT_ID" "[.data.items[] | select(.org_id == \$o)] | length"); [ "$X" = "0" ] || { echo "FAIL: 企业B 列表含企业A 条目 count=$X"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-5 [SSOT 单向] 投影表**只读读端真的存在**（GET 200）而写端点不存在（POST 404/405），源码级零写入语句
  Test: manual:bash -c 'G=$(curl -s -o /tmp/dod-proj.json -w "%{http_code}" -b /tmp/kh-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/projection"); [ "$G" = "200" ] || { echo "FAIL: 投影表只读读端不存在 got=$G（未实现则本条必红，不是假绿）"; exit 1; }; jq -e ".success == true" /tmp/dod-proj.json >/dev/null || { echo "FAIL: 读端响应形状不符"; exit 1; }; W=$(grep -rInE "(INSERT|UPDATE|DELETE)[[:space:]]+(INTO[[:space:]]+)?(zenithjoy\.)?knowledge_entries_projection" apps/api/src --include=*.ts | grep -v "__tests__" | wc -l | tr -d " "); [ "$W" = "0" ] || { echo "FAIL: 投影表存在写入路径 count=$W"; exit 1; }; P=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/kh-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/knowledge/projection" -H "Content-Type: application/json" -d "{}"); case "$P" in 404|405) : ;; *) echo "FAIL: 投影表疑似有写端点 got=$P"; exit 1 ;; esac; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-12 [不静默降级] 账本不可达时读端回 503 LEDGER_UNREACHABLE，绝不返回空列表冒充「库里还没有」
  Test: manual:bash -c 'psql "$PGURL" -q -c "ALTER TABLE public.learnings RENAME TO learnings_dod_hidden"; C=$(curl -s -o /tmp/dod-degraded.json -w "%{http_code}" -b /tmp/kh-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/recent"); psql "$PGURL" -q -c "ALTER TABLE public.learnings_dod_hidden RENAME TO learnings"; [ "$C" = "503" ] || { echo "FAIL: 账本不可达期望 503 得到 $C（疑似静默降级成空列表）"; exit 1; }; jq -e ".error.code == \"LEDGER_UNREACHABLE\"" /tmp/dod-degraded.json >/dev/null || { echo "FAIL: 错误码不是 LEDGER_UNREACHABLE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-G [守卫非空] A27 与 A30 合计五条变异全部 proven-to-fire（本 sprint 合入前置，GP 合同 stages 硬要求）
  Test: manual:bash -c 'grep -q -- "--a27-only" .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh || { echo "FAIL: smoke 缺 --a27-only 子模式"; exit 1; }; for k in A30-1a A30-1b A30-2 A30-3; do grep -q "$k" .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh || { echo "FAIL: smoke 缺变异项 $k"; exit 1; }; done; bash .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh || { echo "FAIL: knowledge smoke 整体未通过"; exit 1; }; echo OK'
  期望: OK

### 其余 lifeline 的 N/A 声明（逐条显式，不得静默消失）

- lifeline#3 [信息卫生 fail-closed] — N/A：闸函数与 `learnings` BEFORE INSERT trigger 属 cecelia Sprint A，PRD 范围限定明确排除
- lifeline#4 [注入池纯净] — N/A：S3 注入不在本 sprint（PRD 不做清单）
- lifeline#6 [不出网] — N/A：本 sprint 零 embedding、零外部推理调用，经验正文不离开自有基础设施
- lifeline#7 [标废时效] — N/A：标废与修订属 S2
- lifeline#8 [注入留痕] — N/A：S3 注入台账不在本 sprint
- lifeline#9 [可还原] — N/A：A18 导出还原演练属后续 sprint
- lifeline#10 [授权来自会话] — N/A：`knowledge_admin` 角色与标废/人审入口属 S2；其前提「身份来自会话」已由 INV-1 提前钉住
- lifeline#11 [kill switch 不静默] — N/A：`LEARNING_INJECT_ENABLED` 属 S3
- lifeline#13 [成本 cap] — N/A：本 sprint 无第三方支出
- lifeline#14 [覆盖率闸] — N/A：embedding 覆盖率属 S2 对外开放前置
- area 级 88 条 harness 流程 invariant — N/A：非本路产品铁律（PRD 已注明「已加载但不逐条抄录」）

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 在 windows_cloud 跑）

- [ ] [BEHAVIOR:E2E] 员工在真实浏览器走完 Golden Path：登录 → 录入 → 「最近沉淀」页看到本人这条带证据链接（**真派发真跑 windows_cloud 车道**，不是静态 grep）
  Test: manual:bash -c 'set -uo pipefail; D="sprints/08192114-员工知识中枢-路-经验沉淀与问答-ade79e4e"; BR=$(git rev-parse --abbrev-ref HEAD); gh workflow run e2e-windows.yml -f task_id="${TASK_ID:-dod-e2e}" -f sprint_dir="$D" -f pr_branch="$BR" || { echo "FAIL: 派发 e2e-windows.yml 失败"; exit 1; }; sleep 25; RID=$(gh run list --workflow=e2e-windows.yml --branch "$BR" --limit 1 --json databaseId -q ".[0].databaseId"); [ -n "$RID" ] || { echo "FAIL: 拿不到 run id"; exit 1; }; gh run watch "$RID" --exit-status >/dev/null || { echo "FAIL: e2e-windows run=$RID 未成功"; gh run view "$RID" --log-failed | tail -40; exit 1; }; gh run view "$RID" --json conclusion | jq -e ".conclusion == \"success\"" >/dev/null || { echo "FAIL: conclusion 非 success"; exit 1; }; L=$(gh run view "$RID" --log); echo "$L" | grep -q "KH-E2E screenshots-fresh: 3" || { echo "FAIL: 无三张本轮新截图的证明（mtime 闸未跑或未过）"; exit 1; }; UI=$(echo "$L" | grep -o "KH-E2E ui-entry-id=[0-9a-fA-F-]*" | tail -1 | cut -d= -f2); LG=$(echo "$L" | grep -o "KH-E2E ledger-verified entry_id=[0-9a-fA-F-]*" | tail -1 | cut -d= -f2); [ -n "$UI" ] || { echo "FAIL: 日志无 UI 可见条目 entry_id"; exit 1; }; [ "$UI" = "$LG" ] || { echo "FAIL: UI 可见条目与账本回读不是同一条 ui=$UI ledger=$LG"; exit 1; }; echo OK'
  期望: OK
  Screenshots:
    - 01-initial.png   期望：录入界面初始状态，三个输入框（触发条件 / 结论 / 证据链接）与提交按钮可见
    - 02-action.png    期望：提交后过渡状态，成功提示可见（或失败时带原因码文案，二者文案不同）
    - 03-result.png    期望：「最近沉淀」页出现本人刚提交那条，结论文字与证据链接可见且链接 href 等于提交值
  路径格式：sprints/08192114-员工知识中枢-路-经验沉淀与问答-ade79e4e/screenshots/<step>.png
  期望：三张截图 LastWriteTime 均晚于 `e2e-verify.ps1` 启动时刻（防历史截图冒充）——该要求已 codify：ps1 逐张比对后打印 `KH-E2E screenshots-fresh: 3`，上方 Test 在 run 日志里断言该行存在，缺一张即整段红

---

## 交付状态标注（接缝清单未真验项一律 logic-done-pending）

| 能力 | 状态 |
|---|---|
| A30 员工目录一致性自检（四项 + 四变异）| **done**（CI 真跑真起真停）|
| A27 静态守卫（正向 + 变异）| **done**（CI 真跑）|
| `knowledgeAuthGuard` 只信会话 | **done**（真会话 + 真伪造头 + 真 PG）|
| 按声明组织入驻 + Personal-% 零命中 | **logic-done-pending**（S-1：真飞书上游未验，CI 走假上游）|
| 录入落 Cecelia 账本带归属 | **logic-done-pending**（S-2：生产同库拓扑未实测，运行时 preflight 兜底）|
| 「最近沉淀」30 秒可见（UI）| **done**（S-3：windows_cloud 真浏览器真验）|
| 既有 16 端点不被误伤 | **logic-done-pending**（S-4：A31 真双向断言属后续 sprint）|
