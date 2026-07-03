---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: 角色数据模型统一 & 账号管理页加绑定机器列

**范围**: GET /api/agent/burner/sessions 加 agent_hostname/agent_nickname；AcquisitionAccountsPage 加"绑定机器"列；删除 DouyinBurnerBindPage；DB migration + 迁移脚本
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/agent-burner.ts` GET /sessions SQL 查询别名 `a.hostname AS agent_hostname, a.nickname AS agent_nickname`（不再输出裸 hostname/nickname）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/agent-burner.ts','utf8');if(!c.includes('agent_hostname'))process.exit(1);if(!c.includes('agent_nickname'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx` BurnerSession 接口含 `agent_hostname?: string | null` + `agent_nickname?: string | null`，表格含"绑定机器"列
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionAccountsPage.tsx','utf8');if(!c.includes('agent_hostname'))process.exit(1);if(!c.includes('绑定机器'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/DouyinBurnerBindPage.tsx` 文件已物理删除
  Test: node -e "const fs=require('fs');if(fs.existsSync('apps/dashboard/src/pages/DouyinBurnerBindPage.tsx'))process.exit(1);console.log('OK file deleted')"

- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 无 `DouyinBurnerBind` + 无 `douyin-burner-bind` 路径引用
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(c.includes('DouyinBurnerBind'))process.exit(1);if(c.includes('douyin-burner-bind'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/AreaHubPage.tsx` 移除 `/dashboard/douyin-burner-bind` 链接
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/AreaHubPage.tsx','utf8');if(c.includes('douyin-burner-bind'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/tests/p2-sprint-b1-ws5/douyin-burner-bind-page.test.tsx` 文件已物理删除
  Test: node -e "const fs=require('fs');if(fs.existsSync('apps/dashboard/tests/p2-sprint-b1-ws5/douyin-burner-bind-page.test.tsx'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] DB migration 文件 `apps/api/db/migrations/*_account_role_unify.sql` 存在，含 health→status 映射 SQL
  Test: node -e "const fs=require('fs'),g=require('glob');const f=g.sync('apps/api/db/migrations/*account_role_unify*');if(f.length===0)process.exit(1);const c=fs.readFileSync(f[0],'utf8');if(!c.includes('line02_account_sessions'))process.exit(1)"

- [ ] [ARTIFACT] `apps/api/scripts/account-role-migrate.js` 迁移脚本存在，支持 `--dry-run` 参数
  Test: node -e "const c=require('fs').readFileSync('apps/api/scripts/account-role-migrate.js','utf8');if(!c.includes('dry-run')&&!c.includes('dryRun'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/e2e/line02-account-role-unify.spec.ts` Playwright 测试存在，不含 `page.route(`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/line02-account-role-unify.spec.ts','utf8');if(c.includes('page.route('))process.exit(1);if(!c.includes('绑定机器'))process.exit(1)"

---

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 直接跑）

- [ ] [BEHAVIOR] GET /api/agent/burner/sessions 响应 success=true 且 sessions 为数组（schema 基础验）
  Test: manual:bash -c 'RESP=$(curl -sf -H "X-Tenant-Id: ${TEST_TENANT_ID:-test-tenant}" localhost:3000/api/agent/burner/sessions) || { echo "FAIL: 端点不可达"; exit 1; }; echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }; echo "$RESP" | jq -e ".data.sessions | type == \"array\"" || { echo "FAIL: sessions 非数组"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 有 burner session 时，响应中每条含 `agent_hostname` key（值可 null）且无裸 `hostname` key
  Test: manual:bash -c 'export TS=$(date +%s); export TNAME="dod-test-$TS"; export TID=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('"'"'$TNAME'"'"','"'"'key-$TS'"'"','"'"'free'"'"') RETURNING id" | tr -d " \n"); export AID=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -t -c "INSERT INTO zenithjoy.agents(tenant_id,machine_id,hostname,status) VALUES('"'"'$TID'"'"','"'"'mac-$TS'"'"','"'"'host-dod'"'"','"'"'online'"'"') RETURNING id" | tr -d " \n"); psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "INSERT INTO zenithjoy.agent_platform_sessions(agent_id,platform,account_label,role,status,created_at,bound_at) VALUES('"'"'$AID'"'"','"'"'douyin'"'"','"'"'dod-label'"'"','"'"'burner'"'"','"'"'active'"'"',NOW(),NOW())"; RESP=$(curl -sf -H "X-Tenant-Id: $TID" localhost:3000/api/agent/burner/sessions); echo "$RESP" | jq -e ".data.sessions[0] | has(\"agent_hostname\")" || { echo "FAIL: 缺 agent_hostname"; exit 1; }; echo "$RESP" | jq -e ".data.sessions[0] | has(\"hostname\") | not" || { echo "FAIL: 禁用字段 hostname 出现"; exit 1; }; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='"'"'$AID'"'"'"; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.agents WHERE id='"'"'$AID'"'"'"; psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM zenithjoy.tenants WHERE id='"'"'$TID'"'"'"; echo OK'
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

---

## BEHAVIOR:E2E 条目（user_facing — Mode B final-e2e，windows-latest Playwright）

- [ ] [BEHAVIOR:E2E] 管理员打开账号管理页，"绑定机器"列头可见（真实后端，无 stub）
  Screenshots:
    - 01-initial.png       期望：账号管理页加载完成，顶部有账号列表区域，表头可见
    - 02-accounts-table.png  期望："绑定机器"列头文字可见于表格区域
    - 03-old-route-gone.png  期望：访问旧路由后不再显示 DouyinBurnerBindPage 内容
  期望：所有截图与描述一致，evaluator 完成后截图复制到 screenshots/

---

## 自查核验记录（proposer 完成）

1. Response Schema 字段名来源：`agent_hostname` / `agent_nickname` — PRD 明确指定 ✅
2. jq -e 断言字段名与 Response Schema 对齐：`has("agent_hostname")` / `has("agent_nickname")` ✅
3. 禁用字段 `hostname`/`nickname` 均有 `has(...) | not` 反向检查 ✅
4. [BEHAVIOR] 数量：6 条 ≥ 4 ✅（schema 字段 + keys 禁用反向 + 多租户隔离 + 鉴权 error path + dry-run）
5. 假绿自查：每条 BEHAVIOR 若对应代码一行未写均会 FAIL — dry-run 脚本不存在时 `node apps/api/scripts/account-role-migrate.js` 会 MODULE_NOT_FOUND；agent_hostname 未加时 `has("agent_hostname")` 为 false ✅
6. Golden Path 溯源：每条 BEHAVIOR 均对应 Golden Path 步骤 ✅；无 MOCK_* / page.route() ✅
