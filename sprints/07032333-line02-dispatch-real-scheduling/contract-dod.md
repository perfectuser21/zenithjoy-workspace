---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: buildAssignments 真调度（在线+负载最少优先 + 待派发重试）

**范围**: `acquisition-dispatch.ts` buildAssignments 升级为在线感知 + 最少负载调度 + pending_dispatch 重试；DB migration 新增 `dispatch_reason` 列和 `pending_dispatch` status
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] DB migration 文件存在，含 `dispatch_reason` 列 ADD 和 check constraint 更新（含 'pending_dispatch'）
  Test: node -e "const fs=require('fs'),path=require('path');const files=fs.readdirSync('apps/api/db/migrations').filter(f=>f.includes('dispatch'));const latest=files.sort().pop();if(!latest){process.exit(1);}const c=fs.readFileSync(path.join('apps/api/db/migrations',latest),'utf8');if(!c.includes('dispatch_reason'))process.exit(1);if(!c.includes('pending_dispatch'))process.exit(1);console.log('OK migration:'+latest)"

- [ ] [ARTIFACT] `buildAssignments` 函数签名保持兼容，`BuildResult` 新增 `pending: number` 字段
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/acquisition-dispatch.ts','utf8');if(!c.includes('pending'))process.exit(1);if(!c.includes('pending_dispatch'))process.exit(1);if(!c.includes('dispatch_reason'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `buildAssignments` burner 查询联接 `agents.last_heartbeat_at` 并按在线状态+当天负载排序
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/acquisition-dispatch.ts','utf8');if(!c.includes('last_heartbeat_at'))process.exit(1);if(!c.includes('2 minutes')||!c.includes('INTERVAL'))process.exit(1);console.log('OK heartbeat join')"

- [ ] [ARTIFACT] `tests/buildAssignments-dispatch.test.ts` 存在，含4组新场景的 it() 块
  Test: node -e "const c=require('fs').readFileSync('sprints/07032333-line02-dispatch-real-scheduling/tests/buildAssignments-dispatch.test.ts','utf8');['least_load','pending_dispatch','retry','tenant isolation'].forEach(kw=>{if(!c.includes(kw)){console.error('MISSING:',kw);process.exit(1);}});console.log('OK tests')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

### B1: API 端点返回 pending 字段（schema 字段值验证）

- [ ] [BEHAVIOR] POST /dispatch/build 响应 data 含 `pending` 字段，类型为 number
  Test: manual:bash -c 'RESP=$(curl -sf -X POST http://localhost:3000/api/acquisition/dispatch/build -H "X-Tenant-Id: e2e-dod-test" -H "Content-Type: application/json" 2>/dev/null || echo "{}"); echo "$RESP" | jq -e ".data.pending | type == \"number\"" || { echo "FAIL: pending field missing or wrong type"; exit 1; }; echo OK'
  期望: OK

### B2: 在线小号按负载排序，dispatch_reason='least_load'（核心行为验证）

- [ ] [BEHAVIOR] 有在线小号时，dm_assignments 新行含 `dispatch_reason='least_load'` 且 status='queued'
  Test: manual:bash -c 'C=$(psql "${DATABASE_URL:-postgresql://localhost/zenithjoy}" -t -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE dispatch_reason='"'"'least_load'"'"' AND status='"'"'queued'"'"' AND created_at > NOW() - interval '"'"'10 minutes'"'"'" | tr -d " "); echo "least_load_queued_count=$C"; [ "$C" -ge 1 ] || { echo "FAIL: no least_load rows"; exit 1; }; echo OK'
  期望: OK（需先运行 E2E Scenario 1 seeding）

### B3: 全部小号离线时写 pending_dispatch，assigned=0，pending≥1（状态值 + 不丢数据）

- [ ] [BEHAVIOR] 全离线场景：data.assigned=0, data.pending≥1，DB 中 pending_dispatch status 行存在
  Test: manual:bash -c 'C=$(psql "${DATABASE_URL:-postgresql://localhost/zenithjoy}" -t -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE status='"'"'pending_dispatch'"'"' AND created_at > NOW() - interval '10 minutes'" | tr -d " "); echo "pending_dispatch_count=$C"; [ "$C" -ge 1 ] || { echo "FAIL: no pending_dispatch rows"; exit 1; }; echo OK'
  期望: OK（需先运行 E2E Scenario 2 seeding）

### B4: 离线小号不出现在 queued 行的 account_label 中（禁用字段反向/负向验证）

- [ ] [BEHAVIOR] 全离线场景中，离线小号的 account_label 不出现在 status='queued' 的 dm_assignments 中
  Test: manual:bash -c 'OFFLINE_BURNER="${E2E_OFFLINE_BURNER:-burner-c-offline-test}"; Q=$(psql "${DATABASE_URL:-postgresql://localhost/zenithjoy}" -t -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE account_label='"'"'$OFFLINE_BURNER'"'"' AND status='"'"'queued'"'"'" | tr -d " "); echo "offline_queued=$Q"; [ "$Q" = "0" ] || { echo "FAIL: offline burner in queued"; exit 1; }; echo OK'
  期望: OK（OFFLINE_BURNER 环境变量注入测试时实际 burner label）

### B5: pending_dispatch 重试补派 — 下周期有可用小号时升级为 queued（完整行为链路）

- [ ] [BEHAVIOR] Scenario 3 运行后：pending_dispatch 行数=0，升级为 queued 的行 updated_at 在近 2 分钟内
  Test: manual:bash -c 'STILL=$(psql "${DATABASE_URL:-postgresql://localhost/zenithjoy}" -t -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE status='"'"'pending_dispatch'"'"' AND tenant_id LIKE '"'"'e2e-retry-%'"'"'" | tr -d " "); echo "still_pending=$STILL"; [ "$STILL" = "0" ] || { echo "FAIL: still $STILL pending_dispatch after retry scenario"; exit 1; }; echo OK'
  期望: OK（需先运行 E2E Scenario 3）

### B6: error path — 无租户上下文返 401

- [ ] [BEHAVIOR] POST /dispatch/build 无 X-Tenant-Id 返 401 + error.code='NO_TENANT'
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/acquisition/dispatch/build -H "Content-Type: application/json"); [ "$CODE" = "401" ] || { echo "FAIL: HTTP $CODE != 401"; exit 1; }; echo OK'
  期望: OK

### B7: keys 完整性 — data 字段集包含所有必填字段

- [ ] [BEHAVIOR] POST /dispatch/build 成功响应 data 同时含 assigned/skipped_dedup/skipped_budget/burners/pending
  Test: manual:bash -c 'RESP=$(curl -sf -X POST http://localhost:3000/api/acquisition/dispatch/build -H "X-Tenant-Id: e2e-keys-check" -H "Content-Type: application/json" 2>/dev/null || echo "{}"); for KEY in assigned skipped_dedup skipped_budget burners pending; do echo "$RESP" | jq -e ".data | has(\"$KEY\")" > /dev/null || { echo "FAIL: missing key $KEY"; exit 1; }; done; echo OK'
  期望: OK

### B8: 租户隔离 — Tenant A 的 pending 积压不影响 Tenant B

- [ ] [BEHAVIOR] Scenario 4 运行后：Tenant B 的 dm_assignments 无 pending_dispatch 行
  Test: manual:bash -c 'C=$(psql "${DATABASE_URL:-postgresql://localhost/zenithjoy}" -t -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE status='"'"'pending_dispatch'"'"' AND tenant_id LIKE '"'"'e2e-iso-b-%'"'"'" | tr -d " "); echo "tenant_b_pending=$C"; [ "$C" = "0" ] || { echo "FAIL: cross-tenant contamination pending=$C"; exit 1; }; echo OK'
  期望: OK（需先运行 E2E Scenario 4）
