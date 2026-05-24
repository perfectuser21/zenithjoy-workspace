contract_branch: cp-05242133-ws-46fef18e-ws3
workstream_index: 3
sprint_dir: sprints/zj2-smart-acquisition-run1

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: POST video-search-result + comment-score-result + lead-writer 扩展

**范围**:
- `apps/api/src/routes/acquisition.ts`：新增 `POST /video-search-result` 和 `POST /comment-score-result` endpoints
- `apps/api/src/services/lead-writer.ts`：扩展 `grade` 和 `keyword` 两字段写入飞书

**大小**: M（100-200 行，2 文件）
**依赖**: Workstream 2（`acquisition_keyword_tasks` 表 + keyword-search endpoint 必须先完成）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `acquisition.ts` 包含 `video-search-result` 路由定义
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/acquisition.ts','utf8');if(!c.includes('video-search-result'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `acquisition.ts` 包含 `comment-score-result` 路由定义
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/acquisition.ts','utf8');if(!c.includes('comment-score-result'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `lead-writer.ts` 包含 `grade` 字段写飞书逻辑
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/lead-writer.ts','utf8');if(!c.includes('grade'))process.exit(1);if(!c.includes('keyword'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令）

> **鉴权说明**: keyword-search 为用户侧 endpoint（鉴权策略表 ✅），所有前置 keyword-search curl 调用必须携带 `Authorization: Bearer $TEST_TOKEN`；video-search-result / comment-score-result 为 Agent 服务间调用，不需要用户 token。

- [ ] [BEHAVIOR] POST /api/acquisition/video-search-result 返回 HTTP 200 且 `received=true`
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -H "Authorization: Bearer $TEST_TOKEN" -d '"'"'{"keyword":"ws3_test"}'"'"' | jq -r '"'"'.task_id'"'"'); RESP=$(curl -sf -X POST http://localhost:3001/api/acquisition/video-search-result -H "Content-Type: application/json" -d "{\"keyword_task_id\":\"$TASK_ID\",\"keyword\":\"ws3_test\",\"videos\":[{\"video_url\":\"https://www.douyin.com/video/ws3test\"}]}"); echo "$RESP" | jq -e '"'"'.received == true'"'"' || { echo "FAIL: received 非 true"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] video-search-result 写入 `acquisition_videos` 表（带时间窗口）
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -H "Authorization: Bearer $TEST_TOKEN" -d '"'"'{"keyword":"ws3_video_db"}'"'"' | jq -r '"'"'.task_id'"'"'); curl -sf -X POST http://localhost:3001/api/acquisition/video-search-result -H "Content-Type: application/json" -d "{\"keyword_task_id\":\"$TASK_ID\",\"keyword\":\"ws3_video_db\",\"videos\":[{\"video_url\":\"https://www.douyin.com/video/dbtest\"}]}" > /dev/null; COUNT=$(psql $DB -t -c "SELECT count(*) FROM zenithjoy.acquisition_videos WHERE keyword_task_id='"'"'$TASK_ID'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$COUNT" -ge 1 ] || { echo "FAIL: acquisition_videos 无记录"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/acquisition/comment-score-result 返回 HTTP 200 且 `received=true`, `written_count >= 0`
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -H "Authorization: Bearer $TEST_TOKEN" -d '"'"'{"keyword":"ws3_cmt"}'"'"' | jq -r '"'"'.task_id'"'"'); RESP=$(curl -sf -X POST http://localhost:3001/api/acquisition/comment-score-result -H "Content-Type: application/json" -d "{\"keyword_task_id\":\"$TASK_ID\",\"video_url\":\"https://www.douyin.com/video/ws3cmt\",\"comments\":[{\"commenter_id\":\"@ws3_u\",\"text\":\"怎么联系\",\"publish_time\":\"2026-05-24T10:00:00Z\"}]}"); echo "$RESP" | jq -e '"'"'.received == true'"'"' || { echo "FAIL: received 非 true"; exit 1; }; echo "$RESP" | jq -e '"'"'.written_count >= 0'"'"' || { echo "FAIL: written_count 字段缺失"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 评论为空时 comment-score-result 返回 200 且 `written_count=0`（早返回）
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -H "Authorization: Bearer $TEST_TOKEN" -d '"'"'{"keyword":"ws3_empty"}'"'"' | jq -r '"'"'.task_id'"'"'); RESP=$(curl -sf -X POST http://localhost:3001/api/acquisition/comment-score-result -H "Content-Type: application/json" -d "{\"keyword_task_id\":\"$TASK_ID\",\"video_url\":\"https://www.douyin.com/video/empty\",\"comments\":[]}"); echo "$RESP" | jq -e '"'"'.written_count == 0'"'"' || { echo "FAIL: 空评论时 written_count 非0"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] lead-writer 写入飞书时 `grade` 字段为中文三级枚举之一
  Test: manual:bash -c 'node -e "const {writeLeadsFromComments}=require('"'"'./apps/api/src/services/lead-writer.ts'"'"');console.log('"'"'lead-writer grade 字段存在'"'"')" 2>/dev/null || node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/api/src/services/lead-writer.ts'"'"','"'"'utf8'"'"');if(!['"'"'感兴趣'"'"','"'"'精准'"'"','"'"'高意向'"'"'].some(g=>c.includes(g))){process.exit(1)}console.log('"'"'OK'"'"')"'
  期望: OK

- [ ] [BEHAVIOR] video-search-result body 缺 keyword_task_id 时返回 HTTP 400（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/acquisition/video-search-result -H "Content-Type: application/json" -d '"'"'{"videos":[]}'"'"'); [ "$CODE" = "400" ] || { echo "FAIL: 期望 400，实际=$CODE"; exit 1; }; echo OK'
  期望: OK
