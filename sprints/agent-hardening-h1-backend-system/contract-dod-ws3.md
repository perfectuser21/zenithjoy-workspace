---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 3: WS routing UUID 化 + dispatcher 改读 agents.id

**范围**：agent-ws hello message 收 string agentId 自动转 UUID；agent-registry entry 加 displayName + agentId 改 UUID；dispatcher 发 WS message agent_id 字段填 UUID
**大小**: L
**依赖**: ws1 GREEN（要先有 register endpoint，但 mock client 测试可不依赖 — 实际并行）

## ARTIFACT 条目

- [ ] [ARTIFACT] apps/api/src/services/agent-db.ts 含 findOrCreateAgentUuid 函数
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/agent-db.ts','utf8');if(!c.includes('findOrCreateAgentUuid'))process.exit(1)"

- [ ] [ARTIFACT] apps/api/src/services/agent-registry.ts AgentEntry 接口含 displayName 字段
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/agent-registry.ts','utf8');if(!c.includes('displayName'))process.exit(1)"

- [ ] [ARTIFACT] apps/api/src/services/agent-ws.ts hello message handler 调用 findOrCreateAgentUuid
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/agent-ws.ts','utf8');if(!c.includes('findOrCreateAgentUuid'))process.exit(1)"

- [ ] [ARTIFACT] apps/api/src/services/task-dispatch.ts 发 WS message 时 agent_id 字段填 entry.agentId（UUID）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/task-dispatch.ts','utf8');if(!c.match(/agent_id.*entry\\.agentId|agent_id.*agent\\.agentId/))process.exit(1)"

## BEHAVIOR 条目（manual:bash 真启 ws server 真 client 真 send 真 recv）

- [ ] [BEHAVIOR] mock WS client hello payload.agentId 为 string display name 时，server 自动转换为 UUID 注册到 registry，GET /api/agent/status 返该 agent 的 agentId 字段是 UUID
  Test: manual:bash -c 'cd apps/api && npm run build > /dev/null 2>&1 && node -r dotenv/config -e "require(\"./dist/index.js\")" > /tmp/h1ws3a-srv.log 2>&1 & SPID=$!; sleep 3; TS=$(date +%s); EMAIL=h1ws3a-$TS@example.com; SR=$(curl -fsS -X POST http://localhost:5200/api/auth/sign-up/email -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"H1ws3a!2026\",\"name\":\"H1ws3a\"}"); UID=$(echo "$SR" | jq -r .user.id); LK=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%$UID%' OR notes LIKE '%$UID%' ORDER BY created_at DESC LIMIT 1"); DISPLAY="h1ws3a-display-$TS"; node -e "const W=require(\"ws\");const w=new W(\"ws://localhost:5200/agent-ws?token=$LK\");w.on(\"open\",()=>{w.send(JSON.stringify({type:\"hello\",payload:{agentId:\"$DISPLAY\",capabilities:[\"douyin\"],version:\"0.1.0\"}}));setTimeout(()=>process.exit(0),3000)});" & WSPID=$!; sleep 4; STATUS=$(curl -fsS http://localhost:5200/api/agent/status); kill $SPID $WSPID 2>/dev/null; echo "$STATUS" | jq -e ".agents | map(select(.displayName==\"$DISPLAY\" or .agentId==\"$DISPLAY\")) | length >= 1 and (map(.agentId | test(\"^[0-9a-f]{8}-[0-9a-f]{4}\")) | all)"'
  期望: jq -e exit 0（含此 displayName 的 entry 存在 + 所有 entries 的 agentId 都是 UUID）

- [ ] [BEHAVIOR] backend 派 douyin task 时 WS message 含 agent_id 字段是 UUID（不是 hostname / display name）
  Test: manual:bash -c 'cd apps/api && npm run build > /dev/null 2>&1 && node -r dotenv/config -e "require(\"./dist/index.js\")" > /tmp/h1ws3b-srv.log 2>&1 & SPID=$!; sleep 3; TS=$(date +%s); EMAIL=h1ws3b-$TS@example.com; SR=$(curl -fsS -X POST http://localhost:5200/api/auth/sign-up/email -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"H1ws3b!2026\",\"name\":\"H1ws3b\"}"); UID=$(echo "$SR" | jq -r .user.id); LK=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%$UID%' OR notes LIKE '%$UID%' ORDER BY created_at DESC LIMIT 1"); DISPLAY="h1ws3b-display-$TS"; mkdir -p /tmp/h1ws3b; > /tmp/h1ws3b/recv.jsonl; node -e "const fs=require(\"fs\");const W=require(\"ws\");const w=new W(\"ws://localhost:5200/agent-ws?token=$LK\");w.on(\"open\",()=>w.send(JSON.stringify({type:\"hello\",payload:{agentId:\"$DISPLAY\",capabilities:[\"douyin\"],version:\"0.1.0\"}})));w.on(\"message\",(r)=>fs.appendFileSync(\"/tmp/h1ws3b/recv.jsonl\",r.toString()+\"\\n\"));setTimeout(()=>process.exit(0),8000);" & WSPID=$!; sleep 3; curl -fsS -X POST http://localhost:5200/api/agent/test-publish-douyin -H "Content-Type: application/json" -d "{}" > /dev/null; sleep 4; kill $SPID $WSPID 2>/dev/null; MSG=$(grep -E "publish_request|\"task\"" /tmp/h1ws3b/recv.jsonl | head -1); [ -n "$MSG" ] && echo "$MSG" | jq -e ".agent_id | test(\"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\")"'
  期望: mock client 收到 message + agent_id 是 UUID 格式，exit 0

- [ ] [BEHAVIOR] dispatch 后 publish_tasks.agent_id 字段填 UUID 等于 agents.id（JOIN 通过）
  Test: manual:bash -c 'PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "SELECT pt.agent_id::text=a.id::text FROM zenithjoy.publish_tasks pt JOIN zenithjoy.agents a ON a.id=pt.agent_id WHERE pt.created_at > NOW() - interval \"5 minutes\" AND a.agent_id LIKE \"h1ws3%\" ORDER BY pt.created_at DESC LIMIT 1" | grep -q "^t$"'
  期望: SQL 返 t (true)，exit 0

- [ ] [BEHAVIOR] 2 个 mock client 不同 capability（douyin / feishu）— backend 派 douyin task 时只 douyin client 收，feishu client 不收
  Test: manual:bash -c 'cd apps/api && npm run build > /dev/null 2>&1 && node -r dotenv/config -e "require(\"./dist/index.js\")" > /tmp/h1ws3d-srv.log 2>&1 & SPID=$!; sleep 3; TS=$(date +%s); EMAIL=h1ws3d-$TS@example.com; SR=$(curl -fsS -X POST http://localhost:5200/api/auth/sign-up/email -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"H1ws3d!2026\",\"name\":\"H1ws3d\"}"); UID=$(echo "$SR" | jq -r .user.id); LK=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%$UID%' OR notes LIKE '%$UID%' ORDER BY created_at DESC LIMIT 1"); mkdir -p /tmp/h1ws3d; > /tmp/h1ws3d/dy.jsonl; > /tmp/h1ws3d/fs.jsonl; node -e "const fs=require(\"fs\");const W=require(\"ws\");const w=new W(\"ws://localhost:5200/agent-ws?token=$LK\");w.on(\"open\",()=>w.send(JSON.stringify({type:\"hello\",payload:{agentId:\"h1ws3d-dy-$TS\",capabilities:[\"douyin\"],version:\"0.1.0\"}})));w.on(\"message\",(r)=>fs.appendFileSync(\"/tmp/h1ws3d/dy.jsonl\",r.toString()+\"\\n\"));setTimeout(()=>process.exit(0),9000);" & PA=$!; node -e "const fs=require(\"fs\");const W=require(\"ws\");const w=new W(\"ws://localhost:5200/agent-ws?token=$LK\");w.on(\"open\",()=>w.send(JSON.stringify({type:\"hello\",payload:{agentId:\"h1ws3d-fs-$TS\",capabilities:[\"feishu\"],version:\"0.1.0\"}})));w.on(\"message\",(r)=>fs.appendFileSync(\"/tmp/h1ws3d/fs.jsonl\",r.toString()+\"\\n\"));setTimeout(()=>process.exit(0),9000);" & PB=$!; sleep 3; curl -fsS -X POST http://localhost:5200/api/agent/test-publish-douyin -H "Content-Type: application/json" -d "{}" > /dev/null; sleep 4; kill $SPID $PA $PB 2>/dev/null; DR=$(grep -cE "publish_request|\"task\"" /tmp/h1ws3d/dy.jsonl 2>/dev/null || echo 0); FR=$(grep -cE "publish_request|\"task\"" /tmp/h1ws3d/fs.jsonl 2>/dev/null || echo 0); [ "$DR" -ge 1 ] && [ "$FR" = "0" ]'
  期望: douyin recv≥1 && feishu recv=0，exit 0
