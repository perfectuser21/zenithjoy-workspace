---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: POST /api/acquisition/keyword-search + keyword-expander 服务

**范围**:
- `apps/api/src/routes/acquisition.ts`：新增 `POST /keyword-search` endpoint
- `apps/api/src/services/keyword-expander.ts`：新建 keyword 扩展服务（调 OpenRouter DeepSeek）

**大小**: M（100-200 行，2 文件）
**依赖**: Workstream 1（`zenithjoy.acquisition_keyword_tasks` 表必须存在）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/services/keyword-expander.ts` 文件存在且导出 `expandKeywords` 函数
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/keyword-expander.ts','utf8');if(!c.includes('expandKeywords'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `acquisition.ts` 包含 `POST` + `keyword-search` 路由定义
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/acquisition.ts','utf8');if(!c.includes('keyword-search'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] POST /api/acquisition/keyword-search 返回 HTTP 200 且 schema keys 精确等于 `["keywords","task_id"]`
  Test: manual:bash -c 'RESP=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -d '"'"'{"keyword":"装修"}'"'"'); echo "$RESP" | jq -e '"'"'keys == ["keywords","task_id"]'"'"' || { echo "FAIL: schema keys 不匹配"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `task_id` 为 UUID 格式字符串，`keywords` 数组长度为 5（含原词）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -d '"'"'{"keyword":"装修"}'"'"'); echo "$RESP" | jq -e '"'"'.task_id | test("^[0-9a-f-]{36}$")'"'"' || { echo "FAIL: task_id 非 UUID"; exit 1; }; echo "$RESP" | jq -e '"'"'.keywords | length == 5'"'"' || { echo "FAIL: keywords 长度非5"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段（`result`/`data`/`expanded`/`variants`/`id`/`job_id`）不存在于 response 中
  Test: manual:bash -c 'RESP=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -d '"'"'{"keyword":"装修"}'"'"'); for F in result data expanded variants id job_id; do echo "$RESP" | jq -e "has(\"$F\") | not" || { echo "FAIL: 禁用字段 $F 存在"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] keyword 缺失时返回 HTTP 400 + `{"error": "MISSING_KEYWORD"}`（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/kw_err.json -w "%{http_code}" -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -d '"'"'{}'"'"'); [ "$CODE" = "400" ] || { echo "FAIL: 期望 400，实际=$CODE"; exit 1; }; cat /tmp/kw_err.json | jq -e '"'"'.error == "MISSING_KEYWORD"'"'"' || { echo "FAIL: error 字段不是 MISSING_KEYWORD"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 成功请求后 `acquisition_keyword_tasks` 写入一条记录（带时间窗口防造假）
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -d '"'"'{"keyword":"test_行为验证"}'"'"' | jq -r '"'"'.task_id'"'"'); COUNT=$(psql $DB -t -c "SELECT count(*) FROM zenithjoy.acquisition_keyword_tasks WHERE id='"'"'$TASK_ID'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$COUNT" -ge 1 ] || { echo "FAIL: DB 无记录 task_id=$TASK_ID"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `expanded_keywords` JSONB 列包含 5 个词（含原词）
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -d '"'"'{"keyword":"test_扩词验证"}'"'"' | jq -r '"'"'.task_id'"'"'); KCOUNT=$(psql $DB -t -c "SELECT jsonb_array_length(expanded_keywords) FROM zenithjoy.acquisition_keyword_tasks WHERE id='"'"'$TASK_ID'"'"'" | tr -d " "); [ "$KCOUNT" -eq 5 ] || { echo "FAIL: expanded_keywords 长度非5，实际=$KCOUNT"; exit 1; }; echo OK'
  期望: OK
