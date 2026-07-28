---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 作战窗 Agent Panel 刀2/安卓获客(line02)打点+可见性

**范围**: `POST /api/agent/burner/panel-event`（新端点，line02 事件写入 panel_events）+ `GET /api/agent/burner/panel-active-tasks`（新端点，中台看门狗计算）+ `services/agent` 桥接模块（真实 ingest 进本地 PanelEventBus）+ `apps/agent-panel` line02 泳道渲染回归 + `golden-path-2-smoke.sh` Step 31
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] `POST /api/agent/burner/panel-event` 端点代码存在于 `apps/api/src/routes/agent-burner.ts`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/agent-burner.ts','utf8');if(!c.includes('panel-event'))process.exit(1)"

- [x] [ARTIFACT] `GET /api/agent/burner/panel-active-tasks` 端点代码存在
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/agent-burner.ts','utf8');if(!c.includes('panel-active-tasks'))process.exit(1)"

- [x] [ARTIFACT] 3 分钟看门狗阈值为命名常量，不是裸魔法数（Invariant 禁止写死环境假设值）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/agent-burner.ts','utf8');if(!/const\s+\w*STUCK\w*_?(MS|THRESHOLD)/i.test(c))process.exit(1)"

- [x] [ARTIFACT] `services/agent` 新增 line02 桥接模块存在
  Test: node -e "require('fs').accessSync('services/agent/src/shared/panel-line02-bridge.ts')"

- [x] [ARTIFACT] `golden-path-2-smoke.sh` 新增 Step 31（line02 panel_events 打点回归）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-2-smoke.sh','utf8');if(!c.includes('Step 31'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] task_started 事件写入 panel_events，line=line02，tenant_id 为服务端反查值
  Test: manual:bash -c '
TID="dod-scan-$(date +%s)";
RESP=$(curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"task_started\",\"task_id\":\"$TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"progress\":[1,3]}");
echo "$RESP" | jq -e ".ok == true" || exit 1;
ROW=$(psql "$DB" -At -c "SELECT tenant_id||'"'"'|'"'"'||event||'"'"'|'"'"'||line FROM zenithjoy.panel_events WHERE task_id='"'"'$TID'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'");
[ "$ROW" = "${TENANT_ID}|task_started|line02" ] || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] step 事件 progress 字段正确写入
  Test: manual:bash -c '
TID="dod-step-$(date +%s)";
curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"task_started\",\"task_id\":\"$TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"progress\":[1,3]}" > /dev/null;
curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"step\",\"task_id\":\"$TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"progress\":[2,3]}" | jq -e ".ok==true" || exit 1;
PROG=$(psql "$DB" -At -c "SELECT progress FROM zenithjoy.panel_events WHERE task_id='"'"'$TID'"'"' AND event='"'"'step'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'");
echo "$PROG" | grep -qE "\[2, ?3\]" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] activeTasks 里 title/progress 字段确实透传（Reviewer round1 问题3）
  Test: manual:bash -c '
TID="dod-passthrough-$(date +%s)";
curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"task_started\",\"task_id\":\"$TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"passthrough-title\",\"progress\":[1,3]}" > /dev/null;
RESP=$(curl -sf -H "X-Tenant-Id: ${TENANT_ID}" "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-active-tasks?line=line02");
echo "$RESP" | jq -e --arg tid "$TID" ".activeTasks[] | select(.task_id==\$tid) | .title == \"passthrough-title\"" || exit 1;
echo "$RESP" | jq -e --arg tid "$TID" ".activeTasks[] | select(.task_id==\$tid) | .progress == [1,3]" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] 3分钟无新事件（时间窗口回填模拟）→ 中台看门狗计算 state=stuck
  Test: manual:bash -c '
STID="dod-stuck-$(date +%s)";
psql "$DB" -c "INSERT INTO zenithjoy.panel_events (tenant_id, task_id, event, line, device, title, progress, created_at) VALUES ('"'"'${TENANT_ID}'"'"', '"'"'$STID'"'"', '"'"'task_started'"'"', '"'"'line02'"'"', '"'"'RMX3478-c3d4'"'"', '"'"'x'"'"', '"'"'[1,3]'"'"', NOW() - interval '"'"'4 minutes'"'"')" > /dev/null;
RESP=$(curl -sf -H "X-Tenant-Id: ${TENANT_ID}" "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-active-tasks?line=line02");
echo "$RESP" | jq -e --arg tid "$STID" ".activeTasks[] | select(.task_id==\$tid) | .state == \"stuck\"" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] stuck 任务收到新事件后自动脱离 stuck（PRD 边界情况：无需人工干预）
  Test: manual:bash -c '
STID="dod-recover-$(date +%s)";
psql "$DB" -c "INSERT INTO zenithjoy.panel_events (tenant_id, task_id, event, line, device, title, progress, created_at) VALUES ('"'"'${TENANT_ID}'"'"', '"'"'$STID'"'"', '"'"'task_started'"'"', '"'"'line02'"'"', '"'"'RMX3478-c3d4'"'"', '"'"'x'"'"', '"'"'[1,3]'"'"', NOW() - interval '"'"'4 minutes'"'"')" > /dev/null;
curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"step\",\"task_id\":\"$STID\",\"line\":\"line02\",\"device\":\"RMX3478-c3d4\",\"title\":\"x\",\"progress\":[2,3]}" > /dev/null;
RESP=$(curl -sf -H "X-Tenant-Id: ${TENANT_ID}" "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-active-tasks?line=line02");
echo "$RESP" | jq -e --arg tid "$STID" ".activeTasks[] | select(.task_id==\$tid) | .state != \"stuck\"" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] done 事件后任务从 activeTasks 消失，出现在 recentCompleted
  Test: manual:bash -c '
TID="dod-done-$(date +%s)";
curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"task_started\",\"task_id\":\"$TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"progress\":[1,1]}" > /dev/null;
curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"done\",\"task_id\":\"$TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\"}" | jq -e ".ok==true" || exit 1;
RESP=$(curl -sf -H "X-Tenant-Id: ${TENANT_ID}" "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-active-tasks?line=line02");
echo "$RESP" | jq -e --arg tid "$TID" "[.activeTasks[] | select(.task_id==\$tid)] | length == 0" || exit 1;
echo "$RESP" | jq -e --arg tid "$TID" ".recentCompleted[] | select(.task_id==\$tid) | .state == \"done\"" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] failed 事件 detail 携带 error_code，severity=error
  Test: manual:bash -c '
TID="dod-fail-$(date +%s)";
curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"failed\",\"task_id\":\"$TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"detail\":\"OPEN_PANEL_FAILED\",\"severity\":\"error\"}" | jq -e ".ok==true" || exit 1;
ROW=$(psql "$DB" -At -c "SELECT detail||'"'"'|'"'"'||severity FROM zenithjoy.panel_events WHERE task_id='"'"'$TID'"'"' AND event='"'"'failed'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'");
[ "$ROW" = "OPEN_PANEL_FAILED|error" ] || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] error path — 缺 agent_id 返回 400 MISSING_AGENT_ID，不写库
  Test: manual:bash -c '
CODE=$(curl -s -o /tmp/dod_resp.json -w "%{http_code}" -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"event\":\"task_started\",\"task_id\":\"x\",\"line\":\"line02\",\"device\":\"x\",\"title\":\"x\"}");
[ "$CODE" = "400" ] || exit 1;
cat /tmp/dod_resp.json | jq -e ".error == \"MISSING_AGENT_ID\"" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] error path — line 不是 line02 返回 400 INVALID_LINE
  Test: manual:bash -c '
CODE=$(curl -s -o /tmp/dod_resp2.json -w "%{http_code}" -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"task_started\",\"task_id\":\"x\",\"line\":\"line99\",\"device\":\"x\",\"title\":\"x\"}");
[ "$CODE" = "400" ] || exit 1;
cat /tmp/dod_resp2.json | jq -e ".error == \"INVALID_LINE\"" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-1（租户隔离）— agent_id 不存在时不得写入任意 tenant，返回 404 AGENT_NOT_FOUND
  Test: manual:bash -c '
CODE=$(curl -s -o /tmp/dod_resp3.json -w "%{http_code}" -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"00000000-0000-0000-0000-000000000000\",\"event\":\"task_started\",\"task_id\":\"x\",\"line\":\"line02\",\"device\":\"x\",\"title\":\"x\"}");
[ "$CODE" = "404" ] || exit 1;
cat /tmp/dod_resp3.json | jq -e ".error == \"AGENT_NOT_FOUND\"" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-1（租户隔离）— 跨租户 panel-active-tasks 查询互不可见
  Test: manual:bash -c '
OTHER_TENANT=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('"'"'dod-other-tenant'"'"', '"'"'ZJ-F-dod-other'"'"', '"'"'free'"'"') RETURNING id");
TID="dod-isolation-$(date +%s)";
curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"task_started\",\"task_id\":\"$TID\",\"line\":\"line02\",\"device\":\"x\",\"title\":\"x\",\"progress\":[1,1]}" > /dev/null;
RESP=$(curl -sf -H "X-Tenant-Id: ${OTHER_TENANT}" "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-active-tasks?line=line02");
echo "$RESP" | jq -e --arg tid "$TID" "[.activeTasks[] | select(.task_id==\$tid)] | length == 0" || exit 1;
psql "$DB" -c "DELETE FROM zenithjoy.tenants WHERE id='"'"'${OTHER_TENANT}'"'"'" > /dev/null; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-2（端点鉴权）— GET panel-active-tasks 缺 X-Tenant-Id 返回 400
  Test: manual:bash -c '
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-active-tasks?line=line02");
[ "$CODE" = "400" ] || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-8（多设备类型UI区分）— 同型号两台设备并发扫描不合并显示
  Test: manual:bash -c '
DEV2_AGENT=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ('"'"'${TENANT_ID}'"'"', '"'"'dod-dev2-'"'"'||extract(epoch from now()), '"'"'android-2'"'"', '"'"'online'"'"') RETURNING id");
T1="dod-multidev-a-$(date +%s)"; T2="dod-multidev-b-$(date +%s)";
curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$AGENT_ID\",\"event\":\"task_started\",\"task_id\":\"$T1\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"progress\":[1,1]}" > /dev/null;
curl -sf -X POST "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-event" -H "Content-Type: application/json" -d "{\"agent_id\":\"$DEV2_AGENT\",\"event\":\"task_started\",\"task_id\":\"$T2\",\"line\":\"line02\",\"device\":\"RMX3478-a1f2\",\"title\":\"x\",\"progress\":[1,1]}" > /dev/null;
RESP=$(curl -sf -H "X-Tenant-Id: ${TENANT_ID}" "${API_BASE:-http://localhost:5200}/api/agent/burner/panel-active-tasks?line=line02");
D1=$(echo "$RESP" | jq -r --arg tid "$T1" ".activeTasks[] | select(.task_id==\$tid) | .device");
D2=$(echo "$RESP" | jq -r --arg tid "$T2" ".activeTasks[] | select(.task_id==\$tid) | .device");
[ -n "$D1" ] && [ -n "$D2" ] && [ "$D1" != "$D2" ] || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] services/agent 桥接模块真实调用 PanelEventBus.ingest（真 bus，mock fetch 边界）
  Test: manual:bash -c 'cd services/agent && npx vitest run src/shared/__tests__/panel-line02-bridge.test.ts --reporter=verbose'
  期望: exit 0，全部测试通过

- [x] [BEHAVIOR] panel-events-route CONNECTED_LINES 回归（现有断言从 line02:false 反转为动态判定）
  Test: manual:bash -c 'cd services/agent && npx vitest run src/handlers/__tests__/panel-events-route.test.ts --reporter=verbose'
  期望: exit 0

- [x] [BEHAVIOR] apps/agent-panel line02 泳道渲染回归（与 line04 物理隔离 + 设备名格式）
  Test: manual:bash -c 'cd apps/agent-panel && npx vitest run src/components/ExpandedPanel.test.tsx src/components/CollapsedStrip.test.tsx --reporter=verbose'
  期望: exit 0

## BEHAVIOR:E2E 条目（Mode B final-e2e 跑，local_api）

- [x] [BEHAVIOR:E2E] golden-path-2-smoke.sh Step 31 全绿（服务端段真链路：task_started→step→stuck回填→done/failed→多设备隔离）
  Test: manual:bash -c 'API_BASE=http://localhost:5200 DB_URL="$DATABASE_URL" bash .github/workflows/scripts/smoke/golden-path-2-smoke.sh'
  期望: exit 0

- [ ] [BEHAVIOR:E2E] Android 真机段（DeviceAccountScanService/AgentService 真实按状态机节奏调用上报接口）
  期望: **logic-done-pending**（本 sprint target_environment=local_api 是 ubuntu-latest CI 容器，无真实 Android 设备，未真验，见 contract-draft.md「未覆盖真实链路清单」；不得标 done，待 Android 真机通道接管复跑）
