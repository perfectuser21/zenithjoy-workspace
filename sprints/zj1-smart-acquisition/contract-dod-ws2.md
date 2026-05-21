---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 路由实现 + app.ts 挂载

**范围**: `apps/api/src/routes/acquisition.ts`（新增）+ `apps/api/src/app.ts`（挂载）
**大小**: S（~55 行净增，2 文件）
**依赖**: Workstream 1（smoke test 先写）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/acquisition.ts` 路由文件存在
  Test: node -e "const fs=require('fs');if(!fs.existsSync('apps/api/src/routes/acquisition.ts'))process.exit(1);console.log('ok')"

- [ ] [ARTIFACT] `apps/api/src/routes/acquisition.ts` 包含 `GET /overview` 路由定义
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/acquisition.ts','utf8');if(!c.includes('/overview')&&!c.includes('router.get'))process.exit(1);console.log('ok')"

- [ ] [ARTIFACT] `apps/api/src/app.ts` 挂载 acquisitionRouter 到 `/api/acquisition`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/app.ts','utf8');if(!c.includes('/api/acquisition'))process.exit(1);console.log('ok')"

- [ ] [ARTIFACT] 路由文件包含 `smart_acquisition` feature 字面量（禁止变体）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/acquisition.ts','utf8');if(!c.includes('smart_acquisition'))process.exit(1);if(c.includes('smartAcquisition')||c.includes('smart-acquisition'))process.exit(1);console.log('ok')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 无 license 时返回 HTTP 401 + error 字段存在（PRD error path）
  Test: manual:bash -c 'API_PORT="${API_PORT:-3000}"; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${API_PORT}/api/acquisition/overview"); [ "$CODE" = "401" ] || { echo "FAIL: status=$CODE"; exit 1; }; BODY=$(curl -s "http://localhost:${API_PORT}/api/acquisition/overview"); echo "$BODY" | jq -e '"'"'has("error")'"'"' || { echo "FAIL: 无 error 字段"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 有效 license → HTTP 200 + enabled == true（PRD 字面字段名）
  Test: manual:bash -c 'API_PORT="${API_PORT:-3000}"; INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-internal-dev-token}"; LK=$(curl -fs -X POST "http://localhost:${API_PORT}/api/admin/license" -H "X-Internal-Token: $INTERNAL_TOKEN" -H "Content-Type: application/json" -d '"'"'{"tier":"basic","customer_name":"dod-ws2-b2"}'"'"' | jq -r '"'"'.data.license_key // empty'"'"'); [ -n "$LK" ] || { echo "FAIL: no license"; exit 1; }; RESP=$(curl -sf -H "Authorization: Bearer $LK" "http://localhost:${API_PORT}/api/acquisition/overview"); echo "$RESP" | jq -e '"'"'.enabled == true'"'"' || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] feature 字段值精确等于 "smart_acquisition"（禁止变体漂移）
  Test: manual:bash -c 'API_PORT="${API_PORT:-3000}"; INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-internal-dev-token}"; LK=$(curl -fs -X POST "http://localhost:${API_PORT}/api/admin/license" -H "X-Internal-Token: $INTERNAL_TOKEN" -H "Content-Type: application/json" -d '"'"'{"tier":"basic","customer_name":"dod-ws2-b3"}'"'"' | jq -r '"'"'.data.license_key // empty'"'"'); [ -n "$LK" ] || { echo "FAIL: no license"; exit 1; }; RESP=$(curl -sf -H "Authorization: Bearer $LK" "http://localhost:${API_PORT}/api/acquisition/overview"); echo "$RESP" | jq -e '"'"'.feature == "smart_acquisition"'"'"' || { echo "FAIL: feature 字段值错误"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Schema 完整性 — 顶层 keys 完全等于 ["capabilities","enabled","feature","version"]（jq 字母序）
  Test: manual:bash -c 'API_PORT="${API_PORT:-3000}"; INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-internal-dev-token}"; LK=$(curl -fs -X POST "http://localhost:${API_PORT}/api/admin/license" -H "X-Internal-Token: $INTERNAL_TOKEN" -H "Content-Type: application/json" -d '"'"'{"tier":"basic","customer_name":"dod-ws2-b4"}'"'"' | jq -r '"'"'.data.license_key // empty'"'"'); [ -n "$LK" ] || { echo "FAIL: no license"; exit 1; }; RESP=$(curl -sf -H "Authorization: Bearer $LK" "http://localhost:${API_PORT}/api/acquisition/overview"); echo "$RESP" | jq -e '"'"'keys == ["capabilities","enabled","feature","version"]'"'"' || { echo "FAIL: keys 不匹配"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 "data" 不存在（PRD 禁用清单反向检查）
  Test: manual:bash -c 'API_PORT="${API_PORT:-3000}"; INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-internal-dev-token}"; LK=$(curl -fs -X POST "http://localhost:${API_PORT}/api/admin/license" -H "X-Internal-Token: $INTERNAL_TOKEN" -H "Content-Type: application/json" -d '"'"'{"tier":"basic","customer_name":"dod-ws2-b5"}'"'"' | jq -r '"'"'.data.license_key // empty'"'"'); [ -n "$LK" ] || { echo "FAIL: no license"; exit 1; }; RESP=$(curl -sf -H "Authorization: Bearer $LK" "http://localhost:${API_PORT}/api/acquisition/overview"); echo "$RESP" | jq -e '"'"'has("data") | not'"'"' || { echo "FAIL: 禁用字段 data 出现"; exit 1; }; echo "$RESP" | jq -e '"'"'has("result") | not'"'"' || { echo "FAIL: 禁用字段 result 出现"; exit 1; }; echo "$RESP" | jq -e '"'"'has("payload") | not'"'"' || { echo "FAIL: 禁用字段 payload 出现"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] capabilities 字段类型为 array 且 enabled=true 时含默认三项能力
  Test: manual:bash -c 'API_PORT="${API_PORT:-3000}"; INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-internal-dev-token}"; LK=$(curl -fs -X POST "http://localhost:${API_PORT}/api/admin/license" -H "X-Internal-Token: $INTERNAL_TOKEN" -H "Content-Type: application/json" -d '"'"'{"tier":"basic","customer_name":"dod-ws2-b6"}'"'"' | jq -r '"'"'.data.license_key // empty'"'"'); [ -n "$LK" ] || { echo "FAIL: no license"; exit 1; }; RESP=$(curl -sf -H "Authorization: Bearer $LK" "http://localhost:${API_PORT}/api/acquisition/overview"); echo "$RESP" | jq -e '"'"'.capabilities | type == "array"'"'"' || { echo "FAIL: capabilities 非 array"; exit 1; }; echo "$RESP" | jq -e '"'"'.capabilities | contains(["platform_binding","content_generation","auto_publish"])'"'"' || { echo "FAIL: 默认三项缺失"; exit 1; }; echo OK'
  期望: OK
