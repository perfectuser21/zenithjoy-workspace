---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB migration(original_script) + createJob API + 前端 textarea + Claude prompt 注入

**范围**: ADD COLUMN original_script TEXT NULL 到 ai_video_pipeline_jobs；service.createJob 接受 originalScript；controller 读 req.body.original_script + target_aspect 并返回；LocalVideoPipelinePage 加 original_script textarea；compose/analyze prompt 前缀含 original_script（含空值保护）
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在且含 original_script 列定义
  Test: node -e "const {readdirSync,readFileSync}=require('fs');const found=readdirSync('apps/api/db/migrations').filter(f=>f.endsWith('.sql')).some(f=>{try{const c=readFileSync('apps/api/db/migrations/'+f,'utf8');return c.includes('original_script')&&c.includes('ai_video_pipeline_jobs')}catch{return false}});if(!found){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] AiVideoPipelineService.createJob 函数签名包含 originalScript 参数
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/ai-video-pipeline.service.ts','utf8');if(!c.includes('originalScript'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] LocalVideoPipelinePage 含 original_script textarea UI 元素
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');if(!c.includes('original_script')||!c.includes('原始文案'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] AI controller 含 original_script 条件注入（含空值保护）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');const hasField=c.includes('original_script');const hasGuard=c.match(/if.*original_script|original_script\s*\?\?|original_script\s*&&/);if(!hasField||!hasGuard){console.error('FAIL: original_script 注入缺失或无空值保护');process.exit(1)}console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] POST /api/ai-video-pipeline/ 含 original_script → 201 响应原样返回 original_script 字段
  Test: manual:bash -c '
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws1-test.mp4\",\"original_script\":\"ZenithJoy WS1 测试文案\"}") || { echo "FAIL: POST 非 2xx"; exit 1; }
echo "$RESP" | jq -e ".original_script == \"ZenithJoy WS1 测试文案\"" || { echo "FAIL: original_script 返回值不匹配"; exit 1; }
echo "$RESP" | jq -e ".status == \"pending\"" || { echo "FAIL: status 不是 pending"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/ai-video-pipeline/{id} 响应含 original_script 字段（schema 完整性）
  Test: manual:bash -c '
JOB_ID=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws1-get-test.mp4\",\"original_script\":\"WS1 GET 测试\"}" | jq -r ".id")
GET_RESP=$(curl -sf http://localhost:5200/api/ai-video-pipeline/$JOB_ID \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR") || { echo "FAIL: GET 失败"; exit 1; }
echo "$GET_RESP" | jq -e "has(\"original_script\")" || { echo "FAIL: GET 响应缺 original_script 字段"; exit 1; }
echo "$GET_RESP" | jq -e ".original_script == \"WS1 GET 测试\"" || { echo "FAIL: GET 返回值不匹配"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST 响应禁用字段 (script/raw_script/source_script/input_script) 不存在
  Test: manual:bash -c '
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws1-forbidden.mp4\",\"original_script\":\"test\"}") || { echo "FAIL: POST 失败"; exit 1; }
echo "$RESP" | jq -e "has(\"script\") | not" || { echo "FAIL: 禁用字段 script 漏网"; exit 1; }
echo "$RESP" | jq -e "has(\"raw_script\") | not" || { echo "FAIL: 禁用字段 raw_script 漏网"; exit 1; }
echo "$RESP" | jq -e "has(\"source_script\") | not" || { echo "FAIL: 禁用字段 source_script 漏网"; exit 1; }
echo "$RESP" | jq -e "has(\"input_script\") | not" || { echo "FAIL: 禁用字段 input_script 漏网"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] original_script=null 时 POST 成功且返回 null（边界值）
  Test: manual:bash -c '
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws1-null.mp4\"}") || { echo "FAIL: POST 失败"; exit 1; }
echo "$RESP" | jq -e ".original_script == null" || { echo "FAIL: original_script 不是 null（未传时应为 null）"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 缺少 local_path 返回 400 + error 字段存在
  Test: manual:bash -c '
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -d "{\"original_script\":\"no local_path\"}")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 local_path 应返 400，实际 $CODE"; exit 1; }
ERR_RESP=$(curl -s -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -d "{\"original_script\":\"test\"}")
echo "$ERR_RESP" | jq -e "has(\"error\")" || { echo "FAIL: 400 响应缺 error 字段"; exit 1; }
echo OK'
  期望: OK
