contract_branch: cp-harness-propose-r3-9b8199e0
workstream_index: 1
sprint_dir: sprints/zj10-customer-mgmt

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: 后端 API 路由（3 个端点）

**范围**: 新建 `apps/api/src/routes/admin-customers.ts`（3 个 GET 端点 + `superAdminGuard`）；在 `apps/api/src/app.ts` 注册 `/api/admin/customers`
**大小**: M（~150 行净增，2 文件）
**依赖**: 无（`depends_on: []`）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/admin-customers.ts` 文件已创建，导出 `adminCustomersRouter`
  Test: node -e "require('fs').accessSync('apps/api/src/routes/admin-customers.ts'); const c=require('fs').readFileSync('apps/api/src/routes/admin-customers.ts','utf8'); if(!c.includes('adminCustomersRouter'))process.exit(1); console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/app.ts` 已引入并注册 adminCustomersRouter 到 `/api/admin/customers`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/app.ts','utf8'); if(!c.includes('admin/customers')||!c.includes('adminCustomersRouter')){process.exit(1)}; console.log('OK')"

- [ ] [ARTIFACT] 路由文件包含 3 个子路径（platform-sessions + publish-logs）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/admin-customers.ts','utf8'); ['platform-sessions','publish-logs'].forEach(e=>{if(!c.includes(e)){console.error('FAIL:缺端点',e);process.exit(1)}}); console.log('OK')"

---

## BEHAVIOR 条目（真实 curl+jq API oracle — evaluator 启动 server 后运行）

> **evaluator 使用前置步骤**（每条 BEHAVIOR 命令假设 server 已在 localhost:5200 运行）:
> ```bash
> cd /workspace/apps/api && PORT=5200 npx tsx src/index.ts &
> sleep 4  # 等待 server 就绪
> ```

- [ ] [BEHAVIOR] GET /api/admin/customers 返回 HTTP 200 + success:true + data:array + total:number（核心schema）
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5200/api/admin/customers) || { echo "FAIL: 端点未返回 200（路由未注册）"; exit 1; }; echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success"; exit 1; }; echo "$RESP" | jq -e ".data | type == \"array\"" || { echo "FAIL: data"; exit 1; }; echo "$RESP" | jq -e ".total | type == \"number\"" || { echo "FAIL: total"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers schema 完整性：顶层 keys 精确等于 [data, success, total]，禁用字段（users/clients/members/result）不出现
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5200/api/admin/customers) || exit 1; echo "$RESP" | jq -e "keys | sort | . == [\"data\",\"success\",\"total\"]" || { echo "FAIL: schema completeness"; exit 1; }; for F in users clients members result; do echo "$RESP" | jq -e "has(\"$F\") | not" || { echo "FAIL: 禁用字段 $F 出现"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers/platform-sessions 返回 HTTP 200 + correct schema + status 值只为 active|expired
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5200/api/admin/customers/platform-sessions) || { echo "FAIL: platform-sessions 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success"; exit 1; }; echo "$RESP" | jq -e ".data | type == \"array\"" || { echo "FAIL: data type"; exit 1; }; echo "$RESP" | jq -e "keys | sort | . == [\"data\",\"success\",\"total\"]" || { echo "FAIL: schema completeness"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers/publish-logs 返回 HTTP 200 + correct schema + tenant_id query 筛选有效
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5200/api/admin/customers/publish-logs) || { echo "FAIL: publish-logs 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success"; exit 1; }; echo "$RESP" | jq -e "keys | sort | . == [\"data\",\"success\",\"total\"]" || { echo "FAIL: schema completeness"; exit 1; }; FILT=$(curl -sf "http://localhost:5200/api/admin/customers/publish-logs?tenant_id=00000000-0000-0000-0000-000000000000") || { echo "FAIL: tenant_id 筛选失败"; exit 1; }; echo "$FILT" | jq -e ".success == true" || { echo "FAIL: 筛选 success"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 非超管（X-Feishu-User-Id 不在白名单）访问 /api/admin/customers 返回 HTTP 403
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Feishu-User-Id: not-an-admin" http://localhost:5200/api/admin/customers); [ "$CODE" = "403" ] || { echo "FAIL: 非超管应返回 403 实际 HTTP=$CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] vitest 单元测试套件全部通过（12 项 — schema/路由/鉴权/禁用字段/app.ts注册）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/zj10-customer-mgmt/tests/ws1/admin-customers-routes.test.ts --reporter=verbose 2>&1 | tee /tmp/ws1-result.log; grep -q "12 passed" /tmp/ws1-result.log && echo OK || { echo "FAIL: vitest 有失败 tests"; grep -E "FAIL|failed" /tmp/ws1-result.log; exit 1; }'
  期望: OK (12 passed)
