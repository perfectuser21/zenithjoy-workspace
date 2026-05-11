---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: License register endpoint 双 schema + 新 error code

**范围**：register endpoint 改造 + license.service 增加新字段输出
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] apps/api/src/routes/agent.ts register 处理函数含 LICENSE_DEVICE_LIMIT_EXCEEDED 字面量
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/agent.ts','utf8');if(!c.includes('LICENSE_DEVICE_LIMIT_EXCEEDED'))process.exit(1)"

- [ ] [ARTIFACT] apps/api/src/services/license.service.ts RegisterSuccess interface 含 success/agent_id/license_tier/device_count/device_limit
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/license.service.ts','utf8');for(const k of ['success','agent_id','license_tier','device_count','device_limit']){if(!c.includes(k))process.exit(1)}"

- [ ] [ARTIFACT] license.service.ts RegisterFailure interface 含 success/error/current_count/limit
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/license.service.ts','utf8');for(const k of ['error: \\'LICENSE_DEVICE_LIMIT_EXCEEDED\\'','current_count','limit:']){if(!c.includes(k))process.exit(1)}"

## BEHAVIOR 条目（manual:bash 真启 server 真发 curl 真验 schema）

- [ ] [BEHAVIOR] register 第 1 个 agent 返 200，body 同时含老字段 ok+license_id+tier+max_machines + 新字段 success+agent_id(UUID)+license_tier+device_count=1+device_limit=1
  Test: manual:bash -c 'cd apps/api && npm run build 2>&1 | tail -3 && node -r dotenv/config -e "require(\"./dist/index.js\")" > /tmp/h1-ws1-srv.log 2>&1 & SPID=$!; sleep 3; TS=$(date +%s); EMAIL=h1ws1-$TS@example.com; SR=$(curl -fsS -X POST http://localhost:5200/api/auth/sign-up/email -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"H1ws1!2026\",\"name\":\"H1ws1\"}"); UID=$(echo "$SR" | jq -r .user.id); LK=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%$UID%' OR notes LIKE '%$UID%' ORDER BY created_at DESC LIMIT 1"); R1=$(curl -fsS -X POST http://localhost:5200/api/agent/register -H "Content-Type: application/json" -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1-$TS-a\",\"hostname\":\"ws1a\",\"version\":\"0.1.0\"}"); kill $SPID 2>/dev/null; echo "$R1" | jq -e ".ok==true and .success==true and .device_count==1 and .device_limit==1 and (.agent_id|test(\"^[0-9a-f]{8}-\")) and .license_tier==\"free\" and .tier==\"free\" and .max_machines==1"'
  期望: jq -e exit 0

- [ ] [BEHAVIOR] register 第 2 个 agent 同 license 不同 machine_id 返 HTTP 403，body 含 error=LICENSE_DEVICE_LIMIT_EXCEEDED + current_count=1 + limit=1 + 老 code=QUOTA_EXCEEDED
  Test: manual:bash -c 'cd apps/api && npm run build > /dev/null 2>&1 && node -r dotenv/config -e "require(\"./dist/index.js\")" > /tmp/h1-ws1b-srv.log 2>&1 & SPID=$!; sleep 3; TS=$(date +%s); EMAIL=h1ws1b-$TS@example.com; SR=$(curl -fsS -X POST http://localhost:5200/api/auth/sign-up/email -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"H1ws1b!2026\",\"name\":\"H1ws1b\"}"); UID=$(echo "$SR" | jq -r .user.id); LK=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%$UID%' OR notes LIKE '%$UID%' ORDER BY created_at DESC LIMIT 1"); curl -fsS -X POST http://localhost:5200/api/agent/register -H "Content-Type: application/json" -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1b-$TS-a\",\"hostname\":\"ws1ba\",\"version\":\"0.1.0\"}" > /dev/null; HC=$(curl -s -o /tmp/h1ws1b-r2.json -w "%{http_code}" -X POST http://localhost:5200/api/agent/register -H "Content-Type: application/json" -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1b-$TS-b\",\"hostname\":\"ws1bb\",\"version\":\"0.1.0\"}"); kill $SPID 2>/dev/null; [ "$HC" = "403" ] && jq -e ".error==\"LICENSE_DEVICE_LIMIT_EXCEEDED\" and .current_count==1 and .limit==1 and .code==\"QUOTA_EXCEEDED\" and .success==false and .ok==false" /tmp/h1ws1b-r2.json'
  期望: HTTP 403 + jq -e exit 0

- [ ] [BEHAVIOR] register 同 machine_id 第 2 次（reconnect）不增 device_count，仍返 200 + device_count=1
  Test: manual:bash -c 'cd apps/api && npm run build > /dev/null 2>&1 && node -r dotenv/config -e "require(\"./dist/index.js\")" > /tmp/h1ws1c-srv.log 2>&1 & SPID=$!; sleep 3; TS=$(date +%s); EMAIL=h1ws1c-$TS@example.com; SR=$(curl -fsS -X POST http://localhost:5200/api/auth/sign-up/email -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"H1ws1c!2026\",\"name\":\"H1ws1c\"}"); UID=$(echo "$SR" | jq -r .user.id); LK=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%$UID%' OR notes LIKE '%$UID%' ORDER BY created_at DESC LIMIT 1"); MID="ws1c-$TS-same"; R1=$(curl -fsS -X POST http://localhost:5200/api/agent/register -H "Content-Type: application/json" -d "{\"license_key\":\"$LK\",\"machine_id\":\"$MID\",\"hostname\":\"h\",\"version\":\"0.1.0\"}"); R2=$(curl -fsS -X POST http://localhost:5200/api/agent/register -H "Content-Type: application/json" -d "{\"license_key\":\"$LK\",\"machine_id\":\"$MID\",\"hostname\":\"h\",\"version\":\"0.1.0\"}"); kill $SPID 2>/dev/null; echo "$R1" | jq -e ".success==true and .device_count==1" && echo "$R2" | jq -e ".success==true and .device_count==1"'
  期望: 两个 jq -e 都 exit 0

- [ ] [BEHAVIOR] success response 含禁用字段 device_quota / installed_count / max_devices / data / payload 反向不存在
  Test: manual:bash -c 'cd apps/api && npm run build > /dev/null 2>&1 && node -r dotenv/config -e "require(\"./dist/index.js\")" > /tmp/h1ws1d-srv.log 2>&1 & SPID=$!; sleep 3; TS=$(date +%s); EMAIL=h1ws1d-$TS@example.com; SR=$(curl -fsS -X POST http://localhost:5200/api/auth/sign-up/email -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"H1ws1d!2026\",\"name\":\"H1ws1d\"}"); UID=$(echo "$SR" | jq -r .user.id); LK=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%$UID%' OR notes LIKE '%$UID%' ORDER BY created_at DESC LIMIT 1"); R=$(curl -fsS -X POST http://localhost:5200/api/agent/register -H "Content-Type: application/json" -d "{\"license_key\":\"$LK\",\"machine_id\":\"ws1d-$TS\",\"hostname\":\"h\",\"version\":\"0.1.0\"}"); kill $SPID 2>/dev/null; echo "$R" | jq -e "(has(\"device_quota\")|not) and (has(\"installed_count\")|not) and (has(\"max_devices\")|not) and (has(\"data\")|not) and (has(\"payload\")|not)"'
  期望: jq -e exit 0
