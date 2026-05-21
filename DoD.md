contract_branch: cp-05211644-ws-fc0dcc8d-ws1
workstream_index: 1
sprint_dir: sprints/zj1-smart-acquisition

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: acquisition.ts 路由实现 + app.ts 注册

**范围**: 新增 `apps/api/src/routes/acquisition.ts` + 修改 `apps/api/src/app.ts` 注册 `/api/acquisition`
**大小**: S（净增 ~35 行，2 文件）
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/acquisition.ts` 存在，含 GET /overview handler
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/acquisition.ts','utf8');if(!c.includes('/overview'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/app.ts` 含 acquisitionRouter import 与 `/api/acquisition` 路由注册
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/app.ts','utf8');if(!c.includes('acquisitionRouter'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，journey_type=autonomous）

- [ ] [BEHAVIOR] GET /api/acquisition/overview 返回 enabled=true（boolean）且 feature="smart-acquisition"（字面量精确匹配）
  Test: manual:bash -c 'API_PORT=${API_PORT:-3001}; RESP=$(curl -sf "http://localhost:$API_PORT/api/acquisition/overview"); echo "$RESP" | jq -e ".enabled == true" || { echo FAIL_enabled; exit 1; }; echo "$RESP" | jq -e ".feature == \"smart-acquisition\"" || { echo FAIL_feature; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/overview 返回 capabilities=["overview"] 且 version="1.0.0"
  Test: manual:bash -c 'API_PORT=${API_PORT:-3001}; RESP=$(curl -sf "http://localhost:$API_PORT/api/acquisition/overview"); echo "$RESP" | jq -e ".capabilities == [\"overview\"]" || { echo FAIL_capabilities; exit 1; }; echo "$RESP" | jq -e ".version == \"1.0.0\"" || { echo FAIL_version; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Schema 完整性 — 顶层 keys 完全等于 ["capabilities","enabled","feature","version"]，不多不少
  Test: manual:bash -c 'API_PORT=${API_PORT:-3001}; RESP=$(curl -sf "http://localhost:$API_PORT/api/acquisition/overview"); echo "$RESP" | jq -e "keys == [\"capabilities\",\"enabled\",\"feature\",\"version\"]" || { echo FAIL_schema_completeness; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 status/data/result/payload/info/meta 不存在于 response（反向检查）
  Test: manual:bash -c 'API_PORT=${API_PORT:-3001}; RESP=$(curl -sf "http://localhost:$API_PORT/api/acquisition/overview"); for f in status data result payload info meta; do echo "$RESP" | jq -e "has(\"$f\") | not" || { echo "FAIL: 禁用字段 $f 出现"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — GET /api/acquisition/nonexistent 返回 HTTP 404
  Test: manual:bash -c 'API_PORT=${API_PORT:-3001}; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$API_PORT/api/acquisition/nonexistent"); [ "$CODE" = "404" ] || { echo "FAIL: expected 404 got $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] HTTP 200 无鉴权 — GET /api/acquisition/overview 不带 Authorization header 也能成功（无 401/403）
  Test: manual:bash -c 'API_PORT=${API_PORT:-3001}; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$API_PORT/api/acquisition/overview"); [ "$CODE" = "200" ] || { echo "FAIL: expected 200 got $CODE"; exit 1; }; echo OK'
  期望: OK
