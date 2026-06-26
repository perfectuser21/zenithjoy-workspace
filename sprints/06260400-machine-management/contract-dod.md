---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: 机器管理模块（机器列表 + 主副命名 + 机器下管抖音号 + 在机器上加号）

**范围**: 中台「机器管理」页 — 机器列表（名称/hostname/在线/版本/主副角色/号数）+ 机器详情（其抖音号 role/有效性）+ 改名 + 主副角色持久化（migration: agents 加 nickname + machine_role）+ 在机器上派 qr-bind 加号（复用 agent-burner，fake-agent 经真路由回写）+ 离线标红 + session 失效标记 + 导航入口。被测系统 = `apps/api`(:5200) + `zenithjoy.*` postgres + `apps/dashboard`(:5174)。
**大小**: M

> 环境变量（smoke / evaluator 注入，默认见右）：`API_BASE`(http://localhost:5200) `PSQL_HOST`(localhost) `PSQL_USER`(cecelia) `PSQL_DB`(cecelia) `PSQL_PASS`(cecelia)。`COOKIE`=登录运营 better-auth cookie 文件；`TENANT`/`AGENT_ID`/`MACHINE_ID`/`OFFLINE_MACHINE_ID`/`COOKIE_B`(第二租户) 由 smoke bootstrap 真造（真插 `zenithjoy.agents` + `agent_platform_sessions` 行），不写死。

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 给 agents 加 nickname + machine_role（含 CHECK main|sub）
  Test: node -e "const fs=require('fs');const f=fs.readdirSync('apps/api/db/migrations').find(n=>/agents.*(nickname|machine_role)/.test(n));if(!f)process.exit(1);const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');if(!c.includes('nickname')||!c.includes('machine_role')||!c.includes(\"'main','sub'\"))process.exit(1)"

- [ ] [ARTIFACT] machines 路由含三端点（GET 列表 + GET 详情 + PUT 改名）且带租户闸
  Test: node -e "const fs=require('fs');const cands=['apps/api/src/routes/agent.ts','apps/api/src/routes/agent-machines.ts'];const c=cands.filter(p=>fs.existsSync(p)).map(p=>fs.readFileSync(p,'utf8')).join('\n');if(!c.includes('/machines'))process.exit(1);if(!/req\.tenantId/.test(c))process.exit(1);if(!c.includes('machine_role'))process.exit(1)"

- [ ] [ARTIFACT] dashboard 机器管理页存在且所有 machines fetch 带凭据（credentials include）
  Test: node -e "const fs=require('fs');const f=fs.readdirSync('apps/dashboard/src/pages').find(n=>/Machine/i.test(n)&&/\.tsx$/.test(n));if(!f)process.exit(1);const c=fs.readFileSync('apps/dashboard/src/pages/'+f,'utf8');const calls=(c.match(/\/api\/agent\/machines/g)||[]).length;if(calls===0)process.exit(1);if(!/credentials:\s*['\\\"]include['\\\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 导航入口接入「智能获客」板块（navigation.config 含机器管理路由）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!/machine/i.test(c)||!c.includes('机器'))process.exit(1)"

- [ ] [ARTIFACT] windows_cloud Playwright 脚本存在（UI 层，含显式断言）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/machine-management.spec.ts','utf8');if(!c.includes('/api/agent/machines'))process.exit(1);if(!/toBeVisible|toHaveText/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 直跑；真后端 :5200 + psql zenithjoy）

- [ ] [BEHAVIOR] GET /api/agent/machines 返回租户机器数组 + PRD 7 字段（Golden Path Step 1）
  Test: manual:bash -c 'RESP=$(curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines"); echo "$RESP" | jq -e ".machines | type == \"array\"" || exit 1; echo "$RESP" | jq -e ".machines[0] | has(\"id\") and has(\"hostname\") and has(\"nickname\") and has(\"status\") and has(\"machine_role\") and has(\"version\") and has(\"douyin_account_count\")" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 机器行字段值正确：machine_role ∈ {main,sub}、status ∈ {online,offline}、count 为 number（Step 1）
  Test: manual:bash -c 'curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines" | jq -e ".machines[0] | ((.machine_role==\"main\") or (.machine_role==\"sub\")) and ((.status==\"online\") or (.status==\"offline\")) and (.douyin_account_count|type==\"number\")" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 机器行禁用字段反向（drift 信号不得出现：role/is_main/machineRole/accountCount）（Step 1）
  Test: manual:bash -c 'curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines" | jq -e ".machines[0] | (has(\"role\") or has(\"is_main\") or has(\"machineRole\") or has(\"accountCount\")) | not" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 列表 key 是 machines 不是 agents（禁用列表 key 反向）（Step 1）
  Test: manual:bash -c 'curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines" | jq -e "has(\"machines\") and (has(\"agents\")|not)" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] PUT 改名 + 标主副 → 200 success + DB 真写入（5 分钟时间窗）+ 刷新持久化（Step 2）
  Test: manual:bash -c 'curl -sf -b "$COOKIE" -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" -H "Content-Type: application/json" -d "{\"nickname\":\"主控机A\",\"machine_role\":\"main\"}" | jq -e ".success==true and .machine.nickname==\"主控机A\" and .machine.machine_role==\"main\"" || exit 1; N=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc "SELECT count(*) FROM zenithjoy.agents WHERE id='"'"'$MACHINE_ID'"'"' AND nickname='"'"'主控机A'"'"' AND machine_role='"'"'main'"'"' AND updated_at > NOW() - interval '"'"'5 minutes'"'"'"); [ "$N" = "1" ] || exit 1; curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines" | jq -e --arg m "$MACHINE_ID" ".machines[] | select(.id==\$m) | .nickname==\"主控机A\" and .machine_role==\"main\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 改名为空 返 400 INVALID_INPUT（Step 2 / 边界）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/mm_empty.json -w "%{http_code}" -b "$COOKIE" -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" -H "Content-Type: application/json" -d "{\"nickname\":\"\",\"machine_role\":\"main\"}"); [ "$CODE" = "400" ] || exit 1; jq -e ".error.code==\"INVALID_INPUT\"" /tmp/mm_empty.json || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 角色非法值 返 400 INVALID_INPUT（Step 2 / 边界）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" -H "Content-Type: application/json" -d "{\"nickname\":\"x\",\"machine_role\":\"boss\"}"); [ "$CODE" = "400" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/agent/machines/:id 返回 {machine, accounts}，号含 role/valid(boolean)（Step 3）
  Test: manual:bash -c 'RESP=$(curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines/${MACHINE_ID}"); echo "$RESP" | jq -e ".machine.id != null" || exit 1; echo "$RESP" | jq -e ".accounts | type == \"array\"" || exit 1; echo "$RESP" | jq -e ".accounts[0] | has(\"account_label\") and has(\"role\") and has(\"status\") and has(\"nickname\") and (.valid|type==\"boolean\")" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 详情禁用字段反向（号列表 key 是 accounts 不是 sessions；号字段不得驼峰 isValid）（Step 3）
  Test: manual:bash -c 'RESP=$(curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines/${MACHINE_ID}"); echo "$RESP" | jq -e "has(\"accounts\") and (has(\"sessions\")|not)" || exit 1; echo "$RESP" | jq -e "(.accounts[0]|has(\"isValid\"))|not" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 在机器上加号 — 派 qr-bind → fake-agent 经真路由回写 → 新 burner session 真写入 + 现身机器详情（Step 4）
  Test: manual:bash -c 'L="小号_$$"; TID=$(curl -sf -b "$COOKIE" -X POST "${API_BASE}/api/agent/burner/qr-bind" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"tenant_id\":\"$TENANT\",\"account_label\":\"$L\"}" | jq -r ".data.task_id"); [ -n "$TID" ] && [ "$TID" != "null" ] || exit 1; curl -sf -X POST "${API_BASE}/api/agent/burner/qr-bind-result" -H "Content-Type: application/json" -d "{\"task_id\":\"$TID\",\"agent_id\":\"$AGENT_ID\",\"qr_login\":\"success\",\"account_nickname\":\"新小号\"}" | jq -e ".success==true" || exit 1; N=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='"'"'$AGENT_ID'"'"' AND platform='"'"'douyin'"'"' AND account_label='"'"'$L'"'"' AND role='"'"'burner'"'"' AND status='"'"'active'"'"' AND bound_at > NOW() - interval '"'"'5 minutes'"'"'"); [ "$N" = "1" ] || exit 1; curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines/${MACHINE_ID}" | jq -e --arg l "$L" ".accounts[] | select(.account_label==\$l) | .role==\"burner\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 离线机器 status=offline（前端标红依据）（Step 5）
  Test: manual:bash -c 'curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines" | jq -e --arg m "$OFFLINE_MACHINE_ID" ".machines[] | select(.id==\$m) | .status==\"offline\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 失效 session valid=false（needs_rebind/expired → 可重新扫码）（Step 5）
  Test: manual:bash -c 'curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines/${MACHINE_ID}" | jq -e "[.accounts[] | select(.status==\"needs_rebind\" or .status==\"expired\")] | all(.valid==false)" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 跨租户隔离 — 租户 B 读不到 A 的机器 + 跨写 403 CROSS_TENANT（边界）
  Test: manual:bash -c 'curl -sf -b "$COOKIE_B" "${API_BASE}/api/agent/machines" | jq -e --arg m "$MACHINE_ID" "all(.machines[]; .id != \$m)" || exit 1; CODE=$(curl -s -o /tmp/mm_xt.json -w "%{http_code}" -b "$COOKIE_B" -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" -H "Content-Type: application/json" -d "{\"nickname\":\"窃改\",\"machine_role\":\"main\"}"); [ "$CODE" = "403" ] || [ "$CODE" = "404" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 登录态闸 — 无 cookie 读机器列表 401，带 cookie 不再 401（接缝 1 逻辑闸）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/agent/machines"); [ "$CODE" = "401" ] || exit 1; CODE2=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" "${API_BASE}/api/agent/machines"); [ "$CODE2" != "401" ] || exit 1; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e windows_cloud 跑）

> **windows_cloud 限界声明（诚实标注）**：windows_cloud 干净 VM **无真后端**，下方 Playwright 用 `page.route` stub + `VITE_SKIP_AUTH` 注入运营身份——它**只验 UI 渲染/交互/文案**，**不验** cookie 接缝（真浏览器向真 :5200 发 better-auth session cookie）。cookie 接缝的真验证在 `[BEHAVIOR:E2E:COOKIE-SEAM]`（linux CI 真后端 leg）。

- [ ] [BEHAVIOR:E2E] 用户走完机器管理 Golden Path，截图可视化验证（windows_cloud，UI 层）
  Screenshots:
    - 01-initial.png   期望：机器管理页加载，≥1 机器行（machine-row）含名称、在线状态、角色（主/副）、抖音号数量可见
    - 02-action.png    期望：改名输入 + 主/副切换后出现「保存成功」，刷新该机器行显示新名 + 新角色
    - 03-result.png    期望：点进机器显示抖音号列表（昵称/role/有效性）；离线机器「添加抖音号」按钮置灰
  期望：所有截图与期望描述一致，Claude Read 图自验通过；evaluator 验收后截图复制到 ${SPRINT_DIR}/screenshots/

- [ ] [BEHAVIOR:E2E:COOKIE-SEAM] **cookie 接缝真目标验证**（linux CI 真后端 + 真 better-auth cookie 注入浏览器，无 page.route stub / 无 VITE_SKIP_AUTH）
  说明：在能起真 :5200 + 真 postgres + dashboard preview（vite proxy /api→:5200）的 linux CI 跑机器管理真浏览器 leg：真登录拿真 session cookie → `context.addCookies` 注入浏览器 → goto 机器管理页（真 GET /api/agent/machines）→ 改名 + 标主副 → 浏览器 fetch 带 credentials:'include' → 真后端真收 cookie → 真 200 → psql 复核 `zenithjoy.agents` 该机器 nickname/machine_role 真写入（5 分钟时间窗，证明 cookie 真到达后端触发真写）。
  Test: manual:bash -c 'set -e; bash .github/workflows/scripts/smoke/machine-management-smoke.sh --leg=cookie-seam; N=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc "SELECT count(*) FROM zenithjoy.agents WHERE id='"'"'$MACHINE_ID'"'"' AND nickname IS NOT NULL AND updated_at > NOW() - interval '"'"'5 minutes'"'"'"); [ "$N" = "1" ] || { echo "FAIL: cookie 接缝—改名后 agents 无真写入，cookie 未真到达后端"; exit 1; }; echo OK'
  期望: OK
  **done 判定**：本条 PASS 才算 cookie 接缝（接缝清单 #1）真 done。若 CI 暂不具备真后端 leg 而本条未跑 → 接缝 1 标 `logic-done-pending`（逻辑/UI 已绿，真接缝待补），**不得**用 windows_cloud stub 绿或 ARTIFACT 静态 grep 冒充 done。
