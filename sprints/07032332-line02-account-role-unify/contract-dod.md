---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: 角色数据模型统一 & 账号管理页加绑定机器列

**范围**: GET /api/agent/burner/sessions 加 agent_hostname/agent_nickname（LEFT JOIN）；AcquisitionAccountsPage 加"绑定机器"列（含单元格值断言）；删除 DouyinBurnerBindPage + AreaHubPage 链接清理；DB migration + 迁移脚本（dry-run + cutover 三值映射）
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/agent-burner.ts` GET /sessions SQL 使用 LEFT JOIN 查询别名 `a.hostname AS agent_hostname, a.nickname AS agent_nickname, a.status AS agent_status`（不再输出裸 hostname/nickname）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/agent-burner.ts','utf8');if(!c.includes('agent_hostname'))process.exit(1);if(!c.includes('agent_nickname'))process.exit(1);if(!c.includes('agent_status'))process.exit(1);if(!c.toUpperCase().includes('LEFT JOIN'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx` BurnerSession 接口含 `agent_hostname?: string | null` + `agent_nickname?: string | null` + `agent_status?: string | null`，表格含"绑定机器"列，单元格含 `data-testid="machine-hostname-cell"`，离线时含 `data-testid="machine-status-offline"`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionAccountsPage.tsx','utf8');if(!c.includes('agent_hostname'))process.exit(1);if(!c.includes('agent_status'))process.exit(1);if(!c.includes('绑定机器'))process.exit(1);if(!c.includes('machine-hostname-cell'))process.exit(1);if(!c.includes('machine-status-offline'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/DouyinBurnerBindPage.tsx` 文件已物理删除
  Test: node -e "const fs=require('fs');if(fs.existsSync('apps/dashboard/src/pages/DouyinBurnerBindPage.tsx'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 无 `DouyinBurnerBind` + 无 `douyin-burner-bind` 路径引用
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(c.includes('DouyinBurnerBind'))process.exit(1);if(c.includes('douyin-burner-bind'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/AreaHubPage.tsx` 移除 `/dashboard/douyin-burner-bind` 链接（问题5修复：已列入受影响文件）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/AreaHubPage.tsx','utf8');if(c.includes('douyin-burner-bind'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/tests/p2-sprint-b1-ws5/douyin-burner-bind-page.test.tsx` 文件已物理删除
  Test: node -e "const fs=require('fs');if(fs.existsSync('apps/dashboard/tests/p2-sprint-b1-ws5/douyin-burner-bind-page.test.tsx'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] DB migration 文件 `apps/api/db/migrations/*_account_role_unify.sql` 存在，含 health→status 映射 SQL + 停写标记
  Test: node -e "const fs=require('fs'),g=require('glob');const f=g.sync('apps/api/db/migrations/*account_role_unify*');if(f.length===0)process.exit(1);const c=fs.readFileSync(f[0],'utf8');if(!c.includes('line02_account_sessions'))process.exit(1)"

- [ ] [ARTIFACT] `apps/api/scripts/account-role-migrate.js` 迁移脚本存在，支持 `--dry-run` 参数，含三值映射逻辑（ok→active/expired→expired/unknown→pending）
  Test: node -e "const c=require('fs').readFileSync('apps/api/scripts/account-role-migrate.js','utf8');if(!c.includes('dry-run')&&!c.includes('dryRun'))process.exit(1);if(!c.includes('active'))process.exit(1);if(!c.includes('pending'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/e2e/line02-account-role-unify.spec.ts` Playwright 测试存在，不含 `page.route(`，含 `machine-hostname-cell` 断言
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/line02-account-role-unify.spec.ts','utf8');if(c.includes('page.route('))process.exit(1);if(!c.includes('绑定机器'))process.exit(1);if(!c.includes('machine-hostname-cell'))process.exit(1)"

- [ ] [ARTIFACT] `.github/workflows/e2e-line02-account-role-unify-windows.yml` workflow 文件存在，含 `windows-latest` runner
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-line02-account-role-unify-windows.yml','utf8');if(!c.includes('windows-latest'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `sprints/07032332-line02-account-role-unify/e2e-verify.ps1` 存在，含 API server 启动（port 3000）+ Playwright 调用
  Test: node -e "const c=require('fs').readFileSync('sprints/07032332-line02-account-role-unify/e2e-verify.ps1','utf8');if(!c.includes('ApiPort'))process.exit(1);if(!c.includes('playwright'))process.exit(1);if(!c.includes('3000'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 直接跑）

- [ ] [BEHAVIOR] GET /api/agent/burner/sessions 响应 success=true 且 sessions 为数组（schema 基础验）
  Test: manual:bash -c 'RESP=$(curl -sf -H "X-Tenant-Id: ${TEST_TENANT_ID:-test-tenant}" localhost:3000/api/agent/burner/sessions) || { echo "FAIL: 端点不可达"; exit 1; }; echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }; echo "$RESP" | jq -e ".data.sessions | type == \"array\"" || { echo "FAIL: sessions 非数组"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 有 burner session 时，响应含 `agent_hostname` key、`agent_nickname` key、`agent_status` key（值可 null）、`role=="burner"`、`account_label`、`status`，且无裸 `hostname` key
  Test: manual:bash -c 'export TS=$(date +%s); export TNAME="dod-test-$TS"; export TID=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('"'"'$TNAME'"'"','"'"'key-$TS'"'"','"'"'free'"'"') RETURNING id" | tr -d " \n"); export AID=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "INSERT INTO zenithjoy.agents(tenant_id,machine_id,hostname,nickname,status) VALUES('"'"'$TID'"'"','"'"'mac-$TS'"'"','"'"'host-dod'"'"','"'"'DOD机器'"'"','"'"'online'"'"') RETURNING id" | tr -d " \n"); psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "INSERT INTO zenithjoy.agent_platform_sessions(agent_id,platform,account_label,role,status,created_at,bound_at) VALUES('"'"'$AID'"'"','"'"'douyin'"'"','"'"'dod-label'"'"','"'"'burner'"'"','"'"'active'"'"',NOW(),NOW())"; RESP=$(curl -sf -H "X-Tenant-Id: $TID" localhost:3000/api/agent/burner/sessions); echo "$RESP" | jq -e ".data.sessions[0] | has(\"agent_hostname\")" || { echo "FAIL: 缺 agent_hostname"; exit 1; }; echo "$RESP" | jq -e ".data.sessions[0] | has(\"agent_nickname\")" || { echo "FAIL: 缺 agent_nickname"; exit 1; }; echo "$RESP" | jq -e ".data.sessions[0] | has(\"agent_status\")" || { echo "FAIL: 缺 agent_status"; exit 1; }; echo "$RESP" | jq -e ".data.sessions[0].role == \"burner\"" || { echo "FAIL: role != burner"; exit 1; }; echo "$RESP" | jq -e ".data.sessions[0] | has(\"account_label\")" || { echo "FAIL: 缺 account_label"; exit 1; }; echo "$RESP" | jq -e ".data.sessions[0] | has(\"status\")" || { echo "FAIL: 缺 status"; exit 1; }; echo "$RESP" | jq -e ".data.sessions[0] | has(\"hostname\") | not" || { echo "FAIL: 禁用字段 hostname 出现"; exit 1; }; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='"'"'$AID'"'"'"; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.agents WHERE id='"'"'$AID'"'"'"; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.tenants WHERE id='"'"'$TID'"'"'"; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/agent/burner/sessions 响应中不出现裸 `nickname` key（禁用字段反向检查）
  Test: manual:bash -c 'export TS=$(date +%s); export TID=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('"'"'nick-test-$TS'"'"','"'"'nk-$TS'"'"','"'"'free'"'"') RETURNING id" | tr -d " \n"); RESP=$(curl -sf -H "X-Tenant-Id: $TID" localhost:3000/api/agent/burner/sessions); ZERO=$(echo "$RESP" | jq ".data.sessions | length"); if [ "$ZERO" -gt 0 ]; then echo "$RESP" | jq -e ".data.sessions[0] | has(\"nickname\") | not" || { echo "FAIL: 禁用字段 nickname 出现"; exit 1; }; fi; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.tenants WHERE id='"'"'$TID'"'"'"; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 多租户隔离：租户 B 的 GET /sessions 不返回租户 A 的数据
  Test: manual:bash -c 'export TS=$(date +%s); TA=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('"'"'iso-a-$TS'"'"','"'"'ka-$TS'"'"','"'"'free'"'"') RETURNING id" | tr -d " \n"); TB=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('"'"'iso-b-$TS'"'"','"'"'kb-$TS'"'"','"'"'free'"'"') RETURNING id" | tr -d " \n"); AID=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "INSERT INTO zenithjoy.agents(tenant_id,machine_id,hostname,status) VALUES('"'"'$TA'"'"','"'"'mac-iso-$TS'"'"','"'"'host-a'"'"','"'"'online'"'"') RETURNING id" | tr -d " \n"); psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "INSERT INTO zenithjoy.agent_platform_sessions(agent_id,platform,account_label,role,status,created_at,bound_at) VALUES('"'"'$AID'"'"','"'"'douyin'"'"','"'"'iso-label'"'"','"'"'burner'"'"','"'"'active'"'"',NOW(),NOW())"; RESP=$(curl -sf -H "X-Tenant-Id: $TB" localhost:3000/api/agent/burner/sessions); CNT=$(echo "$RESP" | jq ".data.sessions | length"); [ "$CNT" -eq 0 ] || { echo "FAIL: 跨租户泄露 B 看到 $CNT 条"; exit 1; }; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='"'"'$AID'"'"'"; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.agents WHERE id='"'"'$AID'"'"'"; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.tenants WHERE id IN ('"'"'$TA'"'"','"'"'$TB'"'"')"; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 无鉴权请求（无 X-Tenant-Id + 无 session）返回 401
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/agent/burner/sessions); [ "$CODE" = "401" ] || { echo "FAIL: 无鉴权返回 $CODE 期望 401"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 迁移脚本 `--dry-run` 退出码 0 并输出可读日志
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:-postgresql://localhost/cecelia}" node apps/api/scripts/account-role-migrate.js --dry-run > /tmp/migrate-dod.log 2>&1; EC=$?; [ $EC -eq 0 ] || { echo "FAIL: dry-run exit=$EC"; cat /tmp/migrate-dod.log; exit 1; }; grep -qE "dry.run|conflict|ok|complete|0 row|完成" /tmp/migrate-dod.log || { echo "FAIL: 日志无可识别内容"; cat /tmp/migrate-dod.log; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] cutover 正式执行后，三值 health→status 映射写入 agent_platform_sessions（带时间窗防造假）
  Test: manual:bash -c 'TS=$(date +%s); CTID=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('"'"'cut-dod-$TS'"'"','"'"'ck-$TS'"'"','"'"'free'"'"') RETURNING id" | tr -d " \n"); CAID=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "INSERT INTO zenithjoy.agents(tenant_id,machine_id,hostname,status) VALUES('"'"'$CTID'"'"','"'"'mac-c-$TS'"'"','"'"'ch'"'"','"'"'online'"'"') RETURNING id" | tr -d " \n"); psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "INSERT INTO zenithjoy.line02_account_sessions(agent_id,platform,account_label,health,tenant_id) VALUES('"'"'$CAID'"'"','"'"'douyin'"'"','"'"'ok-$TS'"'"','"'"'ok'"'"','"'"'$CTID'"'"'),('"'"'$CAID'"'"','"'"'douyin'"'"','"'"'ex-$TS'"'"','"'"'expired'"'"','"'"'$CTID'"'"'),('"'"'$CAID'"'"','"'"'douyin'"'"','"'"'un-$TS'"'"','"'"'unknown'"'"','"'"'$CTID'"'"')"; DATABASE_URL="${DATABASE_URL:-postgresql://localhost/cecelia}" node apps/api/scripts/account-role-migrate.js > /tmp/cut-dod.log 2>&1 || { echo "FAIL: cutover exit non-zero"; cat /tmp/cut-dod.log; exit 1; }; C_OK=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='"'"'$CAID'"'"' AND account_label='"'"'ok-$TS'"'"' AND status='"'"'active'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$C_OK" -eq 1 ] || { echo "FAIL: ok→active count=$C_OK"; exit 1; }; C_EXP=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='"'"'$CAID'"'"' AND account_label='"'"'ex-$TS'"'"' AND status='"'"'expired'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$C_EXP" -eq 1 ] || { echo "FAIL: expired→expired count=$C_EXP"; exit 1; }; C_UNK=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='"'"'$CAID'"'"' AND account_label='"'"'un-$TS'"'"' AND status='"'"'pending'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$C_UNK" -eq 1 ] || { echo "FAIL: unknown→pending count=$C_UNK"; exit 1; }; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='"'"'$CAID'"'"'" 2>/dev/null; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.line02_account_sessions WHERE agent_id='"'"'$CAID'"'"'" 2>/dev/null; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.agents WHERE id='"'"'$CAID'"'"'" 2>/dev/null; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.tenants WHERE id='"'"'$CTID'"'"'" 2>/dev/null; echo OK'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing — Mode B final-e2e，windows-latest Playwright）

- [ ] [BEHAVIOR:E2E] 管理员打开账号管理页，"绑定机器"列头可见，单元格渲染 hostname 或"—"（真实后端，无 stub）
  Screenshots:
    - 01-initial.png         期望：账号管理页加载完成，顶部有账号列表区域，表头可见
    - 02-accounts-table.png  期望："绑定机器"列头文字可见，表格行单元格显示 hostname 文字或"—"，非空
    - 03-old-route-gone.png  期望：访问旧路由后不再显示 DouyinBurnerBindPage 内容，URL 已离开
  期望：所有截图与描述一致，evaluator 完成后截图复制到 screenshots/

---

## 自查核验记录（Round 7 proposer 完成）

1. Response Schema 9 字段：`agent_hostname` / `agent_nickname` / `agent_status`（PRD 明确）；`account_label` / `role` / `status` / `bound_at` / `created_at` / `account_nickname`（现有代码字段）✅
2. jq -e 断言对齐 Response Schema 全字段 — `has("agent_hostname")` / `has("agent_nickname")` / `has("agent_status")` / `role == "burner"` / `has("account_label")` / `has("status")` 全部在 BEHAVIOR 2 manual:bash 中 ✅（Round 6 问题2修复：BEHAVIOR 2 已补 `has("agent_nickname")` 和 `has("agent_status")`）
3. 禁用字段 `hostname`/`nickname` 均有 `has(...) | not` 反向检查 ✅
4. [BEHAVIOR] 数量：7 条 ≥ 4 ✅（schema 字段含三新字段 + 禁用字段反向 + 多租户隔离 + 鉴权 error path + dry-run + cutover 三值映射）
5. 假绿自查：BEHAVIOR 2 若 generator 未实现 agent_status 字段 → has("agent_status") FAIL；若 agent_nickname 未实现 → has("agent_nickname") FAIL；cutover 若脚本不存在 → MODULE_NOT_FOUND FAIL ✅
6. Golden Path 溯源：所有 7 条 BEHAVIOR 对应 Golden Path 步骤 ✅；无 MOCK_* / page.route() ✅
7. Round 7 修复核验：(a) BEHAVIOR 2 title 更新包含 agent_nickname/agent_status；(b) BEHAVIOR 2 manual:bash 补 `has("agent_nickname")` + `has("agent_status")` 两行（Round 6 问题2修复）；(c) Response Schema 加 `agent_status` 字段 + 描述；(d) ARTIFACT 两处（agent-burner.ts + AcquisitionAccountsPage.tsx）检查均已加 agent_status；(e) Step 3 Playwright 加离线标记断言 data-testid="machine-status-offline"；(f) Scenario 1 smoke 加 `has("agent_status")`。净增：断言 ≈ 6 行，0 行删除 ✅
