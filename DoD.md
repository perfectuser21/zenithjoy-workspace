contract_branch: cp-05280815-ws-70ac50db-ws2
workstream_index: 2
sprint_dir: sprints/line00-session-health-medium

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: API 4 端点 + app.ts 注册

**范围**: 新建 `apps/api/src/routes/operator-sessions.ts`（4 端点）；`apps/api/src/app.ts` 注册路由；superAdminGuard 守卫 trigger-bind/upload-cookies；POST status 用 internal-auth；upload-cookies 调 Octokit 写 {PLATFORM_UPPER}_COOKIES
**大小**: M（~175 行净增，2 文件）
**依赖**: Workstream 1 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/operator-sessions.ts` 文件存在且含 trigger-bind 路由
  Test: bash -c 'grep -q "trigger-bind" apps/api/src/routes/operator-sessions.ts && echo OK || { echo "FAIL: trigger-bind 端点未定义"; exit 1; }'

- [ ] [ARTIFACT] `apps/api/src/routes/operator-sessions.ts` 含 upload-cookies 路由
  Test: bash -c 'grep -q "upload-cookies" apps/api/src/routes/operator-sessions.ts && echo OK || { echo "FAIL: upload-cookies 端点未定义"; exit 1; }'

- [ ] [ARTIFACT] `apps/api/src/app.ts` 已注册 operator-sessions 路由（含 /api/operator 前缀）
  Test: bash -c 'grep -qE "operator.sessions|operator-sessions" apps/api/src/app.ts && echo OK || { echo "FAIL: app.ts 未注册 operator-sessions 路由"; exit 1; }'

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] POST trigger-bind 返回 202 + {ok,platform,taskId}，keys 完全等于 ["ok","platform","taskId"]
  Test: manual:bash -c 'ZJ_API=${ZJ_API_URL:-http://localhost:5200}; RESP=$(curl -sf -w "\n%{http_code}" -X POST "$ZJ_API/api/operator/sessions/trigger-bind" -H "Content-Type: application/json" -d '"'"'{"platform":"douyin"}'"'"'); HTTP_CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1); [ "$HTTP_CODE" = "202" ] || { echo "FAIL: 期望 202 got $HTTP_CODE body=$BODY"; exit 1; }; echo "$BODY" | jq -e '"'"'.ok == true'"'"' || { echo "FAIL: ok≠true"; exit 1; }; echo "$BODY" | jq -e '"'"'.taskId | type == "string"'"'"' || { echo "FAIL: taskId 非 string"; exit 1; }; echo "$BODY" | jq -e '"'"'keys == ["ok","platform","taskId"]'"'"' || { echo "FAIL: keys 不完全等于 [ok,platform,taskId]"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] trigger-bind 禁用字段反向 — response 不含 id/task/jobId/requestId
  Test: manual:bash -c 'ZJ_API=${ZJ_API_URL:-http://localhost:5200}; RESP=$(curl -sf -X POST "$ZJ_API/api/operator/sessions/trigger-bind" -H "Content-Type: application/json" -d '"'"'{"platform":"kuaishou"}'"'"') || { echo "FAIL: 端点无响应"; exit 1; }; for k in id task jobId requestId; do echo "$RESP" | jq -e "has(\"$k\") | not" || { echo "FAIL: 禁用字段 $k 出现在 response"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] trigger-bind 非法 platform 返 400 + error 字段（非 message/msg/reason）
  Test: manual:bash -c 'ZJ_API=${ZJ_API_URL:-http://localhost:5200}; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ZJ_API/api/operator/sessions/trigger-bind" -H "Content-Type: application/json" -d '"'"'{"platform":"invalid_platform_xyz"}'"'"'); [ "$CODE" = "400" ] || { echo "FAIL: 非法 platform 期望 400 got $CODE"; exit 1; }; BODY=$(curl -s -X POST "$ZJ_API/api/operator/sessions/trigger-bind" -H "Content-Type: application/json" -d '"'"'{"platform":"invalid_platform_xyz"}'"'"'); echo "$BODY" | jq -e '"'"'.error | type == "string"'"'"' || { echo "FAIL: 缺 error 字段"; exit 1; }; echo "$BODY" | jq -e '"'"'has("message") | not'"'"' || { echo "FAIL: 禁用字段 message 出现"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/operator/sessions 返回 8 条，每项 keys 完全等于 ["lastCheckedAt","lastValidAt","platform","secretName","status"]
  Test: manual:bash -c 'ZJ_API=${ZJ_API_URL:-http://localhost:5200}; RESP=$(curl -sf "$ZJ_API/api/operator/sessions") || { echo "FAIL: GET sessions 失败"; exit 1; }; echo "$RESP" | jq -e '"'"'type == "array"'"'"' || { echo "FAIL: 非 array"; exit 1; }; echo "$RESP" | jq -e '"'"'length == 8'"'"' || { echo "FAIL: 不是 8 条，实际=$(echo "$RESP" | jq length)"; exit 1; }; echo "$RESP" | jq -e '"'"'.[0] | keys == ["lastCheckedAt","lastValidAt","platform","secretName","status"]'"'"' || { echo "FAIL: 每项 keys 不匹配期望集合"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET sessions status 禁用字段反向 — 不含 ok/healthy/valid/inactive/error 状态值
  Test: manual:bash -c 'ZJ_API=${ZJ_API_URL:-http://localhost:5200}; RESP=$(curl -sf "$ZJ_API/api/operator/sessions") || { echo "FAIL"; exit 1; }; echo "$RESP" | jq -e '"'"'[.[].status | IN("ok","healthy","valid","inactive","error")] | any | not'"'"' || { echo "FAIL: status 含禁用值"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET sessions secretName 格式合规 — 以 _COOKIES 结尾，不含 _MAIN/_SESSION/_TOKEN
  Test: manual:bash -c 'ZJ_API=${ZJ_API_URL:-http://localhost:5200}; RESP=$(curl -sf "$ZJ_API/api/operator/sessions") || { echo "FAIL"; exit 1; }; echo "$RESP" | jq -e '"'"'.[0].secretName | endswith("_COOKIES")'"'"' || { echo "FAIL: secretName 不以 _COOKIES 结尾"; exit 1; }; echo "$RESP" | jq -e '"'"'[.[].secretName | test("_MAIN|_SESSION|_TOKEN")] | any | not'"'"' || { echo "FAIL: secretName 含禁用格式"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/operator/sessions/status 返回 {ok:true, updated:N}，keys 完全等于 ["ok","updated"]
  Test: manual:bash -c 'ZJ_API=${ZJ_API_URL:-http://localhost:5200}; RESP=$(curl -sf -X POST "$ZJ_API/api/operator/sessions/status" -H "Content-Type: application/json" -d '"'"'{"updates":[{"platform":"douyin","status":"active","checkedAt":"2026-05-27T10:00:00Z"}]}'"'"') || { echo "FAIL: POST status 失败"; exit 1; }; echo "$RESP" | jq -e '"'"'.ok == true'"'"' || { echo "FAIL: ok≠true"; exit 1; }; echo "$RESP" | jq -e '"'"'.updated | type == "number"'"'"' || { echo "FAIL: updated 非 number"; exit 1; }; echo "$RESP" | jq -e '"'"'keys == ["ok","updated"]'"'"' || { echo "FAIL: keys 不完全等于 [ok,updated]"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] upload-cookies 源码含 Octokit secretName 格式化为 {PLATFORM_UPPER}_COOKIES（不含 _MAIN）
  Test: manual:bash -c 'F="apps/api/src/routes/operator-sessions.ts"; grep -q "COOKIES" "$F" || { echo "FAIL: 源码缺 _COOKIES 命名逻辑"; exit 1; }; grep -qE "_MAIN|_SESSION|_TOKEN" "$F" && { echo "FAIL: 源码含禁用命名格式 _MAIN/_SESSION/_TOKEN"; exit 1; } || true; grep -qE "toUpperCase|UPPER" "$F" || { echo "FAIL: 缺 toUpperCase 平台名大写逻辑"; exit 1; }; echo OK'
  期望: OK
