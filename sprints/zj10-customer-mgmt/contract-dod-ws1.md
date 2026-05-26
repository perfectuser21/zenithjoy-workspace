---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Workstream 1: 后端 API 路由（3 个端点）

**范围**: 新建 `apps/api/src/routes/admin-customers.ts`（3 个 GET 端点 + `superAdminGuard`）；在 `apps/api/src/app.ts` 注册 `/api/admin/customers`
**大小**: M（~150 行净增，2 文件）
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/admin-customers.ts` 文件已创建，导出 `adminCustomersRouter`
  Test: node -e "require('fs').accessSync('apps/api/src/routes/admin-customers.ts'); const c=require('fs').readFileSync('apps/api/src/routes/admin-customers.ts','utf8'); if(!c.includes('adminCustomersRouter'))process.exit(1); console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/app.ts` 已引入并注册 adminCustomersRouter 到 `/api/admin/customers`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/app.ts','utf8'); if(!c.includes('admin/customers'))process.exit(1); if(!c.includes('adminCustomersRouter'))process.exit(1); console.log('OK')"

- [ ] [ARTIFACT] 路由实现包含三个端点路径标识：`platform-sessions` 和 `publish-logs`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/admin-customers.ts','utf8'); ['platform-sessions','publish-logs'].forEach(e=>{if(!c.includes(e)){console.error('FAIL:缺端点',e);process.exit(1)}}); console.log('OK')"

---

## BEHAVIOR 条目

### 静态结构检查（WS1 文件未创建 → readFileSync 抛异常 → FAIL ✅）

- [ ] [BEHAVIOR] GET /api/admin/customers 响应 schema 包含所有 PRD 必填字段（`tenant_id`/`email`/`license_status`/`platform_count`/`last_publish_at`/`success`/`total`）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/admin-customers.ts\",\"utf8\"); const req=[\"tenant_id\",\"email\",\"license_status\",\"platform_count\",\"last_publish_at\",\"success\",\"total\"]; req.forEach(f=>{if(!c.includes(f)){console.error(\"FAIL:缺\",f);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers 响应不含禁用字段名（`users`/`clients`/`members`/`result` 不作为顶层 key）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/admin-customers.ts\",\"utf8\"); const forbidden=[/[\"'"'"']users[\"'"'"']\s*:/,/[\"'"'"']clients[\"'"'"']\s*:/,/[\"'"'"']members[\"'"'"']\s*:/,/\bdata\s*:\s*result\b/]; forbidden.forEach((re,i)=>{if(re.test(c)){console.error(\"FAIL:含禁用字段pattern\",i);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers/platform-sessions schema 包含 `session_id`/`expires_at`；status 值不含禁用词（`valid`/`ok`/`inactive`）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/admin-customers.ts\",\"utf8\"); [\"session_id\",\"expires_at\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL:缺\",f);process.exit(1)}}); [/[\"'"'"']valid[\"'"'"']/,/[\"'"'"']inactive[\"'"'"']/].forEach((re,i)=>{if(re.test(c)){console.error(\"FAIL:含禁用status值index\",i);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers/publish-logs schema 包含 `log_id`/`work_id`/`created_at`；不使用禁用 query 名
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/admin-customers.ts\",\"utf8\"); [\"log_id\",\"work_id\",\"created_at\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL:缺\",f);process.exit(1)}}); [\"req.query.user\",\"req.query.client \",\"req.query.id\",\"req.query.t \"].forEach(f=>{if(c.includes(f)){console.error(\"FAIL:使用禁用query参数\",f);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 路由使用 `superAdminGuard` 中间件（非超管请求返回 403/401）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/admin-customers.ts\",\"utf8\"); if(!c.includes(\"superAdminGuard\")){console.error(\"FAIL:缺superAdminGuard\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `app.ts` 已正确注册 `/api/admin/customers` 路由（端点不返回 404）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/app.ts\",\"utf8\"); if(!c.includes(\"admin/customers\")||!c.includes(\"adminCustomersRouter\")){console.error(\"FAIL:路由未注册\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

### 运行时 jq-e 端点 oracle（启动 API 验证实际响应 schema）

- [ ] [BEHAVIOR] GET /api/admin/customers 运行时返回 PRD schema — `success==true`、`data` 为数组、`total` 为数字、禁用字段不在顶层
  Test: manual:bash -c '
set -e
cd /workspace/apps/api
unset ZENITHJOY_INTERNAL_TOKEN
PORT=15201 npx tsx src/index.ts &
API_PID=$!
trap "kill $API_PID 2>/dev/null" EXIT
for i in $(seq 1 20); do
  curl -sf localhost:15201/health >/dev/null 2>&1 && break
  [ $i -eq 20 ] && { echo "FAIL: 服务启动超时"; exit 1; }
  sleep 1
done
RESP=$(curl -sf localhost:15201/api/admin/customers) || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }
echo "$RESP" | jq -e ".data | type == \"array\"" || { echo "FAIL: data not array"; exit 1; }
echo "$RESP" | jq -e ".total | type == \"number\"" || { echo "FAIL: total not number"; exit 1; }
echo "$RESP" | jq -e "has(\"users\") | not" || { echo "FAIL: 含禁用字段users"; exit 1; }
echo "$RESP" | jq -e "has(\"clients\") | not" || { echo "FAIL: 含禁用字段clients"; exit 1; }
echo "$RESP" | jq -e "has(\"members\") | not" || { echo "FAIL: 含禁用字段members"; exit 1; }
DLEN=$(echo "$RESP" | jq ".data | length")
if [ "$DLEN" -gt 0 ]; then
  echo "$RESP" | jq -e ".data[0] | has(\"tenant_id\") and has(\"email\") and has(\"license_status\") and has(\"platform_count\") and has(\"last_publish_at\")" \
    || { echo "FAIL: data[0] schema 错误"; exit 1; }
fi
echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers/platform-sessions 运行时 schema — `status` 只能是 `active`/`expired`，`session_id`/`expires_at` 必须存在
  Test: manual:bash -c '
set -e
cd /workspace/apps/api
unset ZENITHJOY_INTERNAL_TOKEN
PORT=15202 npx tsx src/index.ts &
API_PID=$!
trap "kill $API_PID 2>/dev/null" EXIT
for i in $(seq 1 20); do
  curl -sf localhost:15202/health >/dev/null 2>&1 && break
  [ $i -eq 20 ] && { echo "FAIL: 服务启动超时"; exit 1; }
  sleep 1
done
RESP=$(curl -sf localhost:15202/api/admin/customers/platform-sessions) || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }
echo "$RESP" | jq -e ".data | type == \"array\"" || { echo "FAIL: data not array"; exit 1; }
DLEN=$(echo "$RESP" | jq ".data | length")
if [ "$DLEN" -gt 0 ]; then
  echo "$RESP" | jq -e ".data[0] | has(\"session_id\") and has(\"tenant_id\") and has(\"platform\") and has(\"status\") and has(\"expires_at\")" \
    || { echo "FAIL: data[0] 缺必填字段"; exit 1; }
  STATUS=$(echo "$RESP" | jq -r ".data[0].status")
  [ "$STATUS" = "active" ] || [ "$STATUS" = "expired" ] \
    || { echo "FAIL: status 值 \"$STATUS\" 不合法"; exit 1; }
fi
echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers/publish-logs 运行时 schema — `log_id`/`work_id`/`created_at` 存在，tenant_id 筛选生效
  Test: manual:bash -c '
set -e
cd /workspace/apps/api
unset ZENITHJOY_INTERNAL_TOKEN
PORT=15203 npx tsx src/index.ts &
API_PID=$!
trap "kill $API_PID 2>/dev/null" EXIT
for i in $(seq 1 20); do
  curl -sf localhost:15203/health >/dev/null 2>&1 && break
  [ $i -eq 20 ] && { echo "FAIL: 服务启动超时"; exit 1; }
  sleep 1
done
RESP=$(curl -sf localhost:15203/api/admin/customers/publish-logs) || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }
echo "$RESP" | jq -e ".data | type == \"array\"" || { echo "FAIL: data not array"; exit 1; }
echo "$RESP" | jq -e ".total | type == \"number\"" || { echo "FAIL: total not number"; exit 1; }
DLEN=$(echo "$RESP" | jq ".data | length")
if [ "$DLEN" -gt 0 ]; then
  echo "$RESP" | jq -e ".data[0] | has(\"log_id\") and has(\"work_id\") and has(\"created_at\")" \
    || { echo "FAIL: data[0] 缺必填字段"; exit 1; }
  echo "$RESP" | jq -e ".data[0].created_at | type == \"string\"" \
    || { echo "FAIL: created_at 不是 string"; exit 1; }
fi
RESP_F=$(curl -sf "localhost:15203/api/admin/customers/publish-logs?tenant_id=nonexistent") \
  || { echo "FAIL: tenant_id 筛选请求失败"; exit 1; }
echo "$RESP_F" | jq -e ".success == true" || { echo "FAIL: 筛选响应 schema 错误"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 无效 token 时 superAdminGuard 返回 401/403
  Test: manual:bash -c '
set -e
cd /workspace/apps/api
export ZENITHJOY_INTERNAL_TOKEN="test-invalid-guard"
PORT=15204 npx tsx src/index.ts &
API_PID=$!
trap "kill $API_PID 2>/dev/null; unset ZENITHJOY_INTERNAL_TOKEN" EXIT
for i in $(seq 1 20); do
  curl -sf localhost:15204/health >/dev/null 2>&1 && break
  [ $i -eq 20 ] && { echo "FAIL: 服务启动超时"; exit 1; }
  sleep 1
done
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer wrong-token" \
  localhost:15204/api/admin/customers)
[ "$CODE" = "401" ] || [ "$CODE" = "403" ] \
  || { echo "FAIL: 非超管访问返回 $CODE（期望 401 或 403）"; exit 1; }
echo OK'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] windows_cloud Playwright 跑 customer-management.spec.ts，4 个 test 全部 PASS，截图可视化验证
  Screenshots:
    - ws4-01-customers-overview.png     期望：/admin/customers 概览页正常加载，customers-table-row 可见，license_status 值显示
    - ws4-02-platform-sessions.png      期望：/admin/customers/platform-sessions 列表显示，session-status 列只有 active/expired
    - ws4-03-publish-logs.png           期望：/admin/customers/publish-logs 发布记录列表可见，tenant_id 筛选有效
    - ws4-04-forbidden.png              期望：非超管访问被拦截，error-forbidden testid 可见或页面重定向
  期望：所有截图与期望描述一致，evaluator Claude Read 图自验通过

evaluator 完成验收后必须执行：
```bash
mkdir -p ~/claude-output/harness-screenshots/
cp screenshots/01-customers-overview.png ~/claude-output/harness-screenshots/ws4-01-customers-overview.png 2>/dev/null || true
cp screenshots/02-platform-sessions.png ~/claude-output/harness-screenshots/ws4-02-platform-sessions.png 2>/dev/null || true
cp screenshots/03-publish-logs.png ~/claude-output/harness-screenshots/ws4-03-publish-logs.png 2>/dev/null || true
cp screenshots/04-forbidden.png ~/claude-output/harness-screenshots/ws4-04-forbidden.png 2>/dev/null || true
```

---

## 假绿自查（v7.12 checklist）

每条 BEHAVIOR "如果 ws1 一行代码都没写，会 FAIL 吗？"：

**静态检查组**：
- BEHAVIOR 1-6：`apps/api/src/routes/admin-customers.ts` 不存在 → `readFileSync` 抛 ENOENT → FAIL ✅

**运行时 oracle 组（防假绿核心检查）**：
- BEHAVIOR 7（/customers 运行时）：路由未注册时 `curl -sf localhost:15201/api/admin/customers` 返回 404，`-sf` flag 遇到 404 不报错但后续 `jq -e ".success == true"` 会 FAIL（404 响应体是 `{"error":"Not Found"}`，`.success` 为 null）→ FAIL ✅
  - **注意**：不能用 `jq -e '.error | type == "string"'` 当正向断言，那会假绿！本 oracle 强制要求 `.success == true` 是唯一通过条件
- BEHAVIOR 8（/platform-sessions 运行时）：同上 → FAIL ✅
- BEHAVIOR 9（/publish-logs 运行时）：同上 → FAIL ✅
- BEHAVIOR 10（error path）：路由未注册时，`ZENITHJOY_INTERNAL_TOKEN` 设置后 superAdminGuard 理应拦截请求。但如果路由根本没挂载，任何请求都走 notFoundHandler（404），而非 superAdminGuard（401/403）。所以 CODE=404，断言 `[401|403]` → FAIL ✅

## 自查 checklist 断言结果

1. PRD response 字段名（tenant_id/email/license_status/platform_count/last_publish_at/session_id/expires_at/log_id/work_id/created_at）✅ 字面用 PRD 给的 key
2. contract jq -e 字段名集合 ⊆ PRD 字段名集合 ✅
3. 禁用字段（users/clients/members/result/valid/ok/inactive）❌ 在反向检查 `has(...) | not` 中，未出现在正向断言 ✅
4. `grep -c '^\- \[ \] \[BEHAVIOR\]' contract-dod-ws1.md` = 10 ≥ 4 ✅
5. depends_on: ws1=[] ✅（ws2/ws3/ws4 在 task-plan.json 中有前置依赖）
6. 假绿自查：所有 BEHAVIOR 在 ws1 未实现时都会 FAIL ✅
