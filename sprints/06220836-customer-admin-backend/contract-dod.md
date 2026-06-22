---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: 客户管理后台（公司名 / 子账号 / 客服-PC 绑定 / 诊断报告页）

**范围**: 公司名 CRUD（复用 tenants.name）/ 子账号 CRUD（含 role + plan 配额）/ 客服-PC 绑定（1:1 双唯一 + 机器配额）/ 诊断报告展示（复用 module-health）/ 软删 / 轻量审计 / 租户隔离。不动注册、计费、RBAC、登录鉴权。
**大小**: L

> **验证环境约定**：后端 BEHAVIOR 打**真实 ZenithJoy API** `API_BASE`（默认 `http://localhost:5200`，见 admin-customers-smoke.sh）+ **真实 Postgres**（PGHOST/PGUSER/PGDATABASE/PGPASSWORD，默认 cecelia）。**不是** Brain 5221（本 sprint 是 ZenithJoy 产品，非 Cecelia harness）。UI 行为见 ## BEHAVIOR:E2E（windows_cloud Playwright）。

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 建 tenant_sub_accounts / service_agents 表 + 双唯一 + 软删字段
  Test: node -e "const fs=require('fs'),g=require('child_process').execSync('ls apps/api/db/migrations/').toString();const f=g.split('\n').find(x=>/customer_admin_backend\.sql$/.test(x));if(!f)process.exit(1);const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');if(!/tenant_sub_accounts/.test(c)||!/service_agents/.test(c)||!/deleted_at/.test(c)||!/UNIQUE/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] 新路由文件含 4 个新端点 + superAdminGuard
  Test: node -e "const fs=require('fs');const cand=['apps/api/src/routes/tenant-admin.ts','apps/api/src/routes/customer-admin.ts','apps/api/src/routes/admin-customers.ts'];const c=cand.filter(p=>fs.existsSync(p)).map(p=>fs.readFileSync(p,'utf8')).join('\n');if(!/accounts/.test(c)||!/service-agents/.test(c)||!/bind-device/.test(c)||!/superAdminGuard/.test(c))process.exit(1)"

- [ ] [ARTIFACT] Dashboard 客户管理页含公司/子账号/绑定/诊断 4 区
  Test: node -e "const{execSync}=require('child_process');const o=execSync('grep -rl \"service-agents\\|bind-device\\|module-health\" apps/dashboard/src/pages apps/dashboard/src/api 2>/dev/null || true').toString();if(!o.trim())process.exit(1)"

- [ ] [ARTIFACT] smoke 脚本 + Playwright spec + e2e-verify.ps1 存在
  Test: node -e "const fs=require('fs');['.github/workflows/scripts/smoke/customer-admin-backend-smoke.sh','apps/dashboard/e2e/customer-admin-backend.spec.ts','sprints/06220836-customer-admin-backend/e2e-verify.ps1'].forEach(p=>{if(!fs.existsSync(p))process.exit(1)})"

## BEHAVIOR 条目（内嵌可执行 manual:bash，打真实 API+真库，user_facing 模式A）

- [ ] [BEHAVIOR] Step1 改公司名落库 — PUT /api/tenant/:id 改 tenants.name，DB 实际更新
  Test: manual:bash -c 'set -e; A="${API_BASE:-http://localhost:5200}"; PH="${PGHOST:-localhost}";PU="${PGUSER:-cecelia}";PD="${PGDATABASE:-cecelia}";export PGPASSWORD="${PGPASSWORD:-cecelia}"; TID=$(psql -h $PH -U $PU -d $PD -tAc "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES(\"Personal-old\",\"lk-\"||substr(md5(random()::text),1,12),\"matrix\") RETURNING id"); R=$(curl -sf -X PUT "$A/api/tenant/$TID" -H "Content-Type: application/json" -d "{\"name\":\"晨悦传媒\"}"); echo "$R" | jq -e ".success==true and .data.name==\"晨悦传媒\"" >/dev/null; N=$(psql -h $PH -U $PU -d $PD -tAc "SELECT name FROM zenithjoy.tenants WHERE id=\"$TID\"" | tr -d " "); [ "$N" = "晨悦传媒" ]; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step2 建子账号带 role — POST /api/tenant/:id/accounts，5 分钟内 DB 新增 service_agent 行
  Test: manual:bash -c 'set -e; A="${API_BASE:-http://localhost:5200}"; PH="${PGHOST:-localhost}";PU="${PGUSER:-cecelia}";PD="${PGDATABASE:-cecelia}";export PGPASSWORD="${PGPASSWORD:-cecelia}"; TID=$(psql -h $PH -U $PU -d $PD -tAc "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES(\"T2\",\"lk-\"||substr(md5(random()::text),1,12),\"matrix\") RETURNING id"); R=$(curl -sf -X POST "$A/api/tenant/$TID/accounts" -H "Content-Type: application/json" -d "{\"email\":\"svc@t2.test\",\"display_name\":\"客服\",\"role\":\"service_agent\"}"); AID=$(echo "$R" | jq -r ".data.account_id"); echo "$R" | jq -e ".success==true and .data.role==\"service_agent\"" >/dev/null; C=$(psql -h $PH -U $PU -d $PD -tAc "SELECT count(*) FROM zenithjoy.tenant_sub_accounts WHERE id=\"$AID\" AND tenant_id=\"$TID\" AND role=\"service_agent\" AND deleted_at IS NULL AND created_at > NOW() - interval \"5 minutes\"" | tr -d " "); [ "$C" = "1" ]; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step2-err 非法 role 拒绝 — role=boss → 4xx INVALID_ROLE，DB 无行
  Test: manual:bash -c 'set -e; A="${API_BASE:-http://localhost:5200}"; PH="${PGHOST:-localhost}";PU="${PGUSER:-cecelia}";PD="${PGDATABASE:-cecelia}";export PGPASSWORD="${PGPASSWORD:-cecelia}"; TID=$(psql -h $PH -U $PU -d $PD -tAc "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES(\"T3\",\"lk-\"||substr(md5(random()::text),1,12),\"matrix\") RETURNING id"); CODE=$(curl -s -o /tmp/r.json -w "%{http_code}" -X POST "$A/api/tenant/$TID/accounts" -H "Content-Type: application/json" -d "{\"email\":\"x@t3.test\",\"display_name\":\"x\",\"role\":\"boss\"}"); case "$CODE" in 400|409) : ;; *) echo "FAIL code=$CODE"; exit 1;; esac; jq -e ".success==false and (.error.code|type==\"string\")" /tmp/r.json >/dev/null; C=$(psql -h $PH -U $PU -d $PD -tAc "SELECT count(*) FROM zenithjoy.tenant_sub_accounts WHERE tenant_id=\"$TID\" AND created_at > NOW() - interval \"5 minutes\"" | tr -d " "); [ "$C" = "0" ]; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step3 绑定落库 + 双唯一拒绝 — bind 写 service_agents；重复绑同客服/PC → 409 无新行
  Test: manual:bash -c 'set -e; A="${API_BASE:-http://localhost:5200}"; PH="${PGHOST:-localhost}";PU="${PGUSER:-cecelia}";PD="${PGDATABASE:-cecelia}";export PGPASSWORD="${PGPASSWORD:-cecelia}"; TID=$(psql -h $PH -U $PU -d $PD -tAc "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES(\"T4\",\"lk-\"||substr(md5(random()::text),1,12),\"matrix\") RETURNING id"); AID=$(curl -sf -X POST "$A/api/tenant/$TID/accounts" -H "Content-Type: application/json" -d "{\"email\":\"svc@t4.test\",\"display_name\":\"客服\",\"role\":\"service_agent\"}" | jq -r ".data.account_id"); MID="pc-$(date +%s)"; curl -sf -X POST "$A/api/tenant/$TID/service-agents/$AID/bind-device" -H "Content-Type: application/json" -d "{\"machine_id\":\"$MID\"}" | jq -e ".success==true" >/dev/null; C=$(psql -h $PH -U $PU -d $PD -tAc "SELECT count(*) FROM zenithjoy.service_agents WHERE account_id=\"$AID\" AND machine_id=\"$MID\" AND deleted_at IS NULL AND created_at > NOW() - interval \"5 minutes\"" | tr -d " "); [ "$C" = "1" ]; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$A/api/tenant/$TID/service-agents/$AID/bind-device" -H "Content-Type: application/json" -d "{\"machine_id\":\"$MID\"}"); [ "$CODE" = "409" ] || { echo "FAIL dup code=$CODE"; exit 1; }; C2=$(psql -h $PH -U $PU -d $PD -tAc "SELECT count(*) FROM zenithjoy.service_agents WHERE account_id=\"$AID\" AND deleted_at IS NULL AND created_at > NOW() - interval \"5 minutes\"" | tr -d " "); [ "$C2" = "1" ]; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step5 配额超限硬拒 — 建满 limit 后第 limit+1 个 4xx「配额 N/M」且 DB 行数==limit
  Test: manual:bash -c 'set -e; A="${API_BASE:-http://localhost:5200}"; PH="${PGHOST:-localhost}";PU="${PGUSER:-cecelia}";PD="${PGDATABASE:-cecelia}";export PGPASSWORD="${PGPASSWORD:-cecelia}"; TID=$(psql -h $PH -U $PU -d $PD -tAc "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES(\"T5\",\"lk-\"||substr(md5(random()::text),1,12),\"basic\") RETURNING id"); LIM=$(curl -sf "$A/api/tenant/$TID/accounts" | jq -r ".quota.limit"); [ "$LIM" -ge 1 ] || { echo "FAIL limit=$LIM"; exit 1; }; i=0; while [ "$i" -lt "$LIM" ]; do curl -sf -X POST "$A/api/tenant/$TID/accounts" -H "Content-Type: application/json" -d "{\"email\":\"f$i@t5.test\",\"display_name\":\"f$i\",\"role\":\"operator\"}" >/dev/null; i=$((i+1)); done; CODE=$(curl -s -o /tmp/q.json -w "%{http_code}" -X POST "$A/api/tenant/$TID/accounts" -H "Content-Type: application/json" -d "{\"email\":\"over@t5.test\",\"display_name\":\"o\",\"role\":\"operator\"}"); case "$CODE" in 409|400|403) : ;; *) echo "FAIL over code=$CODE"; exit 1;; esac; jq -e ".error.message | test(\"配额\") and test(\"/\")" /tmp/q.json >/dev/null; C=$(psql -h $PH -U $PU -d $PD -tAc "SELECT count(*) FROM zenithjoy.tenant_sub_accounts WHERE tenant_id=\"$TID\" AND deleted_at IS NULL AND created_at > NOW() - interval \"5 minutes\"" | tr -d " "); [ "$C" = "$LIM" ]; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step6 租户隔离 + 软删 — A 账号不入 B 列表；软删后列表不含、deleted_at 置位、物理行保留
  Test: manual:bash -c 'set -e; A="${API_BASE:-http://localhost:5200}"; PH="${PGHOST:-localhost}";PU="${PGUSER:-cecelia}";PD="${PGDATABASE:-cecelia}";export PGPASSWORD="${PGPASSWORD:-cecelia}"; TIDA=$(psql -h $PH -U $PU -d $PD -tAc "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES(\"TA\",\"lk-\"||substr(md5(random()::text),1,12),\"matrix\") RETURNING id"); TIDB=$(psql -h $PH -U $PU -d $PD -tAc "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES(\"TB\",\"lk-\"||substr(md5(random()::text),1,12),\"matrix\") RETURNING id"); AID=$(curl -sf -X POST "$A/api/tenant/$TIDA/accounts" -H "Content-Type: application/json" -d "{\"email\":\"iso@ta.test\",\"display_name\":\"iso\",\"role\":\"operator\"}" | jq -r ".data.account_id"); CROSS=$(curl -sf "$A/api/tenant/$TIDB/accounts" | jq -r "[.data[].email]|map(select(test(\"@ta.test\")))|length"); [ "$CROSS" = "0" ] || { echo "FAIL leak=$CROSS"; exit 1; }; curl -sf -X DELETE "$A/api/tenant/$TIDA/accounts/$AID" >/dev/null; IN=$(curl -sf "$A/api/tenant/$TIDA/accounts" | jq -r "[.data[].account_id]|index(\"$AID\") // \"gone\""); [ "$IN" = "gone" ]; DEL=$(psql -h $PH -U $PU -d $PD -tAc "SELECT count(*) FROM zenithjoy.tenant_sub_accounts WHERE id=\"$AID\" AND deleted_at IS NOT NULL" | tr -d " "); [ "$DEL" = "1" ]; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step4 诊断端点 schema 复用 — GET /api/agent/module-health 返 {ok, data:array}
  Test: manual:bash -c 'set -e; A="${API_BASE:-http://localhost:5200}"; R=$(curl -s "$A/api/agent/module-health" -H "Authorization: Bearer ${E2E_LICENSE_TOKEN:-test-lic}"); echo "$R" | jq -e "has(\"ok\") and (.data|type==\"array\")" >/dev/null; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error-path 非超管 403 — X-Feishu-User-Id: not-an-admin 访问新端点 → 403
  Test: manual:bash -c 'set -e; A="${API_BASE:-http://localhost:5200}"; CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Feishu-User-Id: not-an-admin" "$A/api/tenant/00000000-0000-0000-0000-000000000000/accounts"); [ "$CODE" = "403" ] || { echo "FAIL code=$CODE"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e windows_cloud Playwright 跑）

- [ ] [BEHAVIOR:E2E] 管理员在 Dashboard 真走完 Golden Path，截图可视化验证
  Screenshots:
    - 01-customers-page.png   期望：「客户管理」页加载，公司列表可见，4 区入口（公司/子账号/绑定/诊断）可见
    - 02-company-named.png     期望：设公司名提交后，列表/详情显示新公司名（非 Personal-邮箱）
    - 03-accounts.png          期望：建 3 个子账号后列表出现 3 行，含 1 个 service_agent role 标签
    - 04-bound.png             期望：绑定后显示「客服 X @ PC Y ● 在线/离线」行
    - 05-diagnosis.png         期望：诊断区显示该机模块矩阵表格（✅/❌+原因+时间），或空态「该机暂无上报，请确认 Agent 已连中台」
  路径格式：sprints/06220836-customer-admin-backend/screenshots/<step>.png
  期望：evaluator 完成后截图已复制到 sprints/06220836-customer-admin-backend/screenshots/，每张与期望描述一致，Claude Read 图自验通过
