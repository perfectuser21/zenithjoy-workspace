---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: Line04 中台 AI-native CRM·客户列表页（第一块）

**范围**: 中台客户列表页（姓名/微信号/状态A1-A5下拉/最后联系/接管开关）+ 接管开关写 whitelist + 状态持久化 + 手动加客户 + 修「未登录」写接口 bug + 补读接口租户闸。被测系统 = `apps/api`(:5200) + `zenithjoy.*` postgres + `apps/dashboard`(:5174)。
**大小**: M

> 环境变量（smoke / evaluator 注入，默认见右）：`API_BASE`(http://localhost:5200) `PSQL_HOST`(localhost) `PSQL_USER`(cecelia) `PSQL_DB`(cecelia) `PSQL_PASS`(cecelia)。`COOKIE`=登录管理员 better-auth cookie 文件；`CS_WECHAT_ID`/`CONTACT`/`COOKIE_B`(第二租户) 由 smoke bootstrap 真造，不写死。

## ARTIFACT 条目

- [ ] [ARTIFACT] 客户列表读接口（租户闸）存在于 crm 路由
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/crm.ts','utf8');if(!c.includes('/customers')||!/req\.tenantId/.test(c))process.exit(1)"

- [ ] [ARTIFACT] crm_customers 迁移含 A1-A5 CHECK + 租户列
  Test: node -e "const fs=require('fs');const f=fs.readdirSync('apps/api/db/migrations').find(n=>n.includes('crm_customers'));if(!f)process.exit(1);const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');if(!c.includes('crm_customers')||!c.includes(\"'A1','A2','A3','A4','A5'\")||!c.includes('tenant_id'))process.exit(1)"

- [ ] [ARTIFACT] dashboard 客户列表页**所有** CRM 读/写接口 fetch 都带凭据（修「未登录」bug，覆盖 manage/status/POST/GET，非仅一处）
  Test: node -e "const fs=require('fs');const cl=fs.readFileSync('apps/dashboard/src/pages/CustomerListPage.tsx','utf8');['/api/crm/customers/manage','/api/crm/customers/status'].forEach(e=>{if(!cl.includes(e))process.exit(1)});const usesHelper=/adminFetch|crmFetch|apiFetch/.test(cl);const crmCalls=(cl.match(/(^|[^A-Za-z])fetch\([^)]*\/api\/crm/g)||[]).length;const creds=(cl.match(/credentials:\s*['\\\"]include['\\\"]/g)||[]).length;if(!usesHelper && (crmCalls===0 || creds<crmCalls))process.exit(1);const pc=fs.readFileSync('apps/dashboard/src/pages/PerCsConfigPage.tsx','utf8');if(!/credentials:\s*['\\\"]include['\\\"]/.test(pc))process.exit(1)"

- [ ] [ARTIFACT] cookie 接缝真验证脚本存在：真后端真 cookie 浏览器 leg，无 page.route stub / 无 VITE_SKIP_AUTH
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/crm-cookie-seam.spec.ts','utf8');if(c.includes('page.route'))process.exit(1);if(!c.includes('addCookies'))process.exit(1);if(!c.includes('/api/crm/customers/manage'))process.exit(1)"

- [ ] [ARTIFACT] smoke 接入 CI（line04-crm-customer-list-smoke.sh 存在且含真 psql + 双租户 + cookie 接缝 leg 编排）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/line04-crm-customer-list-smoke.sh','utf8');if(!c.includes('psql')||!c.includes('/api/crm/customers')||!c.includes('CROSS_TENANT'))process.exit(1);if(!c.includes('crm-cookie-seam')||!c.includes('REAL_SESSION_COOKIE'))process.exit(1)"

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 直跑；真后端 :5200 + psql zenithjoy）

- [ ] [BEHAVIOR] GET /api/crm/customers 返回租户内客户数组 + PRD 字段（Golden Path Step 1）
  Test: manual:bash -c 'RESP=$(curl -sf -b "$COOKIE" "${API_BASE}/api/crm/customers"); echo "$RESP" | jq -e ".customers | type == \"array\"" || exit 1; echo "$RESP" | jq -e ".customers[0] | has(\"name\") and has(\"wechat_id\") and has(\"status\") and has(\"last_contact_at\") and has(\"managed\")" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET 客户行禁用字段反向（drift 信号不得出现）（Step 1）
  Test: manual:bash -c 'curl -sf -b "$COOKIE" "${API_BASE}/api/crm/customers" | jq -e ".customers[0] | (has(\"rating\") or has(\"is_managed\") or has(\"enabled\")) | not" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 接管开关 PUT → 200「保存成功」+ whitelist 真写入（5 分钟时间窗）（Step 2）
  Test: manual:bash -c 'curl -sf -b "$COOKIE" -X PUT "${API_BASE}/api/crm/customers/manage" -H "Content-Type: application/json" -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":true}" | jq -e ".success==true and .managed==true and .message==\"保存成功\"" || exit 1; IN=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc "SELECT (whitelist @> to_jsonb('"'"'$CONTACT'"'"'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='"'"'$CS_WECHAT_ID'"'"' AND updated_at > NOW() - interval '"'"'5 minutes'"'"'"); [ "$IN" = "t" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 白名单 gate should_reply 命中/未命中/空 三例（Step 3，纯函数逻辑）
  Test: manual:bash -c 'python3 -c "import sys; sys.path.insert(0,\"services/agent/wechat-rpa\"); from cs_config_gate import should_reply; assert should_reply({\"whitelist\":[\"张三\"]},\"张三\") is True; assert should_reply({\"whitelist\":[\"张三\"]},\"李四\") is False; assert should_reply({\"whitelist\":[]},\"张三\") is False; print(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 状态 A3 持久化 + 刷新仍 A3（5 分钟时间窗）（Step 4）
  Test: manual:bash -c 'curl -sf -b "$COOKIE" -X PUT "${API_BASE}/api/crm/customers/status" -H "Content-Type: application/json" -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}" | jq -e ".success==true and .status==\"A3\"" || exit 1; ST=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc "SELECT status FROM zenithjoy.crm_customers WHERE cs_wechat_id='"'"'$CS_WECHAT_ID'"'"' AND contact='"'"'$CONTACT'"'"' AND updated_at > NOW() - interval '"'"'5 minutes'"'"'"); [ "$ST" = "A3" ] || exit 1; curl -sf -b "$COOKIE" "${API_BASE}/api/crm/customers" | jq -e --arg c "$CONTACT" ".customers[] | select(.contact==\$c) | .status==\"A3\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — status 非 A1-A5 返 400（Step 4）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" -X PUT "${API_BASE}/api/crm/customers/status" -H "Content-Type: application/json" -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A9\"}"); [ "$CODE" = "400" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] +加客户 POST → 入册 source=manual + 列表可见（Step 5）
  Test: manual:bash -c 'NC="测试客户_$$"; curl -sf -b "$COOKIE" -X POST "${API_BASE}/api/crm/customers" -H "Content-Type: application/json" -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"name\":\"$NC\",\"contact\":\"$NC\"}" | jq -e ".success==true and .customer.status==\"A1\" and .customer.managed==false" || exit 1; C=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc "SELECT count(*) FROM zenithjoy.crm_customers WHERE cs_wechat_id='"'"'$CS_WECHAT_ID'"'"' AND contact='"'"'$NC'"'"' AND source='"'"'manual'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'"); [ "$C" = "1" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 跨租户隔离 — 租户 B 读不到 A 的客户 + 跨写 403 CROSS_TENANT（Step 6）
  Test: manual:bash -c 'curl -sf -b "$COOKIE_B" "${API_BASE}/api/crm/customers" | jq -e --arg a "$CONTACT" "all(.customers[]; .contact != \$a)" || exit 1; CODE=$(curl -s -o /tmp/xt.json -w "%{http_code}" -b "$COOKIE_B" -X PUT "${API_BASE}/api/crm/customers/manage" -H "Content-Type: application/json" -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":true}"); [ "$CODE" = "403" ] || exit 1; jq -e ".error.code==\"CROSS_TENANT\"" /tmp/xt.json || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 登录态修复 — 无 cookie 写接口 401，带 cookie 不再 401（Step 7，未登录 bug）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${API_BASE}/api/crm/customers/manage" -H "Content-Type: application/json" -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":true}"); [ "$CODE" = "401" ] || exit 1; CODE2=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" -X PUT "${API_BASE}/api/crm/customers/manage" -H "Content-Type: application/json" -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":true}"); [ "$CODE2" != "401" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] managed 字段实时一致 whitelist（防前端臆测假绿）（Step 8）
  Test: manual:bash -c 'curl -sf -b "$COOKIE" -X PUT "${API_BASE}/api/crm/customers/manage" -H "Content-Type: application/json" -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":false}" | jq -e ".managed==false" || exit 1; curl -sf -b "$COOKIE" "${API_BASE}/api/crm/customers" | jq -e --arg c "$CONTACT" ".customers[] | select(.contact==\$c) | .managed==false" || exit 1; OUT=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc "SELECT (whitelist @> to_jsonb('"'"'$CONTACT'"'"'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='"'"'$CS_WECHAT_ID'"'"'"); [ "$OUT" = "f" ] || exit 1; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e windows_cloud 跑）

> **windows_cloud 限界声明（诚实标注，对齐 reviewer 问题1）**：windows_cloud 干净 VM **无真后端**，下方 Playwright 用 `page.route` stub + `VITE_SKIP_AUTH` 注入超管身份——它**只验 UI 渲染/交互/文案**，**不验** cookie 接缝（真浏览器向真 :5200 发 better-auth session cookie）。cookie 接缝的真验证在下面 `[BEHAVIOR:E2E:COOKIE-SEAM]`（linux CI 真后端 leg）。

- [ ] [BEHAVIOR:E2E] 用户走完客户列表 Golden Path，截图可视化验证（windows_cloud，UI 层）
  Screenshots:
    - 01-initial.png   期望：客户列表页加载，≥1 客户行（crm-customer-row）含姓名、状态下拉（crm-status-select）、接管开关（crm-manage-toggle）可见
    - 02-action.png    期望：勾接管开关后出现「保存成功」，无「登录已失效」提示（UI 文案层，非真后端）
    - 03-result.png    期望：状态下拉改 A3、刷新后该行状态仍显示 A3（持久化）
  期望：所有截图与期望描述一致，Claude Read 图自验通过；evaluator 验收后截图复制到 ${SPRINT_DIR}/screenshots/

- [ ] [BEHAVIOR:E2E:COOKIE-SEAM] **cookie 接缝真目标验证**（linux CI 真后端 + 真 better-auth cookie 注入浏览器，无 page.route stub / 无 VITE_SKIP_AUTH）
  说明：在能起真 :5200 + 真 postgres + dashboard preview（vite proxy /api→:5200）的 linux CI 跑 `apps/dashboard/e2e/crm-cookie-seam.spec.ts`：真登录拿真 session cookie → `context.addCookies` 注入浏览器 → goto /customers（真 GET）→ 点接管开关 → 浏览器 fetch 带 credentials:'include' → 真后端真收 cookie → 真 200。断言「保存成功」可见、「登录已失效」count=0，并经 psql 复核 whitelist 真写入该 contact（5 分钟时间窗，证明 cookie 真到达后端触发真写）。
  gate-allow: env_missing/playwright cookie 接缝真后端 leg 仅在 line04-crm-customer-list-smoke.sh（linux CI）内跑，REAL_SESSION_COOKIE 由真登录 bootstrap 导出；下方 ${REAL_SESSION_COOKIE:-} 兜底 + spec 内 test.skip 降级 logic-done-pending，非环境真缺失，故豁免 playwright env 检测。
  Test: manual:bash -c 'set -e; cd apps/dashboard; REAL_SESSION_COOKIE="${REAL_SESSION_COOKIE:-}"; E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:5174}" E2E_REAL_SESSION_COOKIE="$REAL_SESSION_COOKIE" npx playwright test e2e/crm-cookie-seam.spec.ts --reporter=line; IN=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc "SELECT (whitelist @> to_jsonb('"'"'$CONTACT'"'"'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='"'"'$CS_WECHAT_ID'"'"' AND updated_at > NOW() - interval '"'"'5 minutes'"'"'"); [ "$IN" = "t" ] || { echo "FAIL: cookie 接缝—点开关后 whitelist 无真写入，cookie 未真到达后端"; exit 1; }; echo OK'
  期望: OK
  **done 判定**：本条 PASS 才算 cookie 接缝真 done。若 CI 暂不具备真后端 leg 而本条未跑 → cookie 接缝标 `logic-done-pending`（逻辑/UI 已绿，真接缝待补），**不得**用 windows_cloud stub 绿或 ARTIFACT 静态 grep 冒充 done。
