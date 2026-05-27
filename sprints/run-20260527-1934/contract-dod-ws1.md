---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB migration(original_script) + createJob API + 前端 textarea + Claude prompt 注入

**范围**: ADD COLUMN original_script TEXT NULL 到 zenithjoy.ai_video_pipeline_jobs；service.createJob 接受 originalScript；controller 读 req.body.original_script + req.body.target_aspect 并返回；LocalVideoPipelinePage 加 original_script textarea；AI controller prompt 前缀注入（含空值保护）
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在且含 original_script 列定义（ai_video_pipeline_jobs）
  Test: node -e "const{readdirSync,readFileSync}=require('fs');const m=readdirSync('apps/api/db/migrations').filter(f=>f.endsWith('.sql')).some(f=>{try{const c=readFileSync('apps/api/db/migrations/'+f,'utf8');return c.includes('original_script')&&c.includes('ai_video_pipeline_jobs')}catch{return false}});if(!m){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] AiVideoPipelineService.createJob 含 originalScript 参数
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/ai-video-pipeline.service.ts','utf8');if(!c.includes('originalScript'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] LocalVideoPipelinePage 含 original_script textarea + 原始文案文本
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');if(!c.includes('original_script')||!c.includes('原始文案'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] AI controller 含 original_script 条件注入（含空值保护 if/??/&&）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');const hasField=c.includes('original_script');const hasGuard=!!(c.match(/if.*original_script|original_script\s*\?\?|original_script\s*&&/));if(!hasField||!hasGuard){console.error('FAIL: 缺 original_script 注入或空值保护');process.exit(1)}console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令 — evaluator 直接执行）

- [ ] [BEHAVIOR] POST 含 original_script → 201 响应原样返回 original_script 字段值
  Test: manual:bash -c '
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws1-test.mp4\",\"original_script\":\"ZenithJoy WS1 测试文案\"}") || { echo "FAIL: POST 非 2xx"; exit 1; }
echo "$RESP" | jq -e ".original_script == \"ZenithJoy WS1 测试文案\"" || { echo "FAIL: original_script 值不匹配"; exit 1; }
echo "$RESP" | jq -e ".status == \"pending\"" || { echo "FAIL: status 不是 pending"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST 201 必填字段完整性（id/status/original_script/target_aspect 均存在）
  Test: manual:bash -c '
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws1-schema.mp4\",\"original_script\":\"schema test\",\"target_aspect\":\"9:16\"}") || { echo "FAIL: POST 失败"; exit 1; }
echo "$RESP" | jq -e "[has(\"id\"),has(\"status\"),has(\"original_script\"),has(\"target_aspect\")] | all" || { echo "FAIL: POST 201 必填字段不完整"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST 禁用字段（script/raw_script/source_script/input_script）不存在
  Test: manual:bash -c '
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws1-forbidden.mp4\",\"original_script\":\"test\"}") || { echo "FAIL: POST 失败"; exit 1; }
echo "$RESP" | jq -e "has(\"script\") | not" || { echo "FAIL: 禁用字段 script 漏网"; exit 1; }
echo "$RESP" | jq -e "has(\"raw_script\") | not" || { echo "FAIL: 禁用字段 raw_script 漏网"; exit 1; }
echo "$RESP" | jq -e "has(\"source_script\") | not" || { echo "FAIL: 禁用字段 source_script 漏网"; exit 1; }
echo "$RESP" | jq -e "has(\"input_script\") | not" || { echo "FAIL: 禁用字段 input_script 漏网"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/ai-video-pipeline/{id} 返回全部 5 个 PRD 必填字段 + 禁用字段不存在
  Test: manual:bash -c '
JOB_ID=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws1-get.mp4\",\"original_script\":\"GET 测试\",\"target_aspect\":\"16:9\"}" | jq -r ".id")
GET=$(curl -sf http://localhost:5200/api/ai-video-pipeline/$JOB_ID \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR") || { echo "FAIL: GET 失败"; exit 1; }
echo "$GET" | jq -e "[has(\"id\"),has(\"status\"),has(\"detected_aspect\"),has(\"original_script\"),has(\"target_aspect\")] | all" || { echo "FAIL: GET 5 字段不完整"; exit 1; }
echo "$GET" | jq -e ".original_script == \"GET 测试\"" || { echo "FAIL: GET original_script 与 POST 不一致"; exit 1; }
echo "$GET" | jq -e ".target_aspect == \"16:9\"" || { echo "FAIL: GET target_aspect 与 POST 不一致"; exit 1; }
echo "$GET" | jq -e "has(\"aspect\") | not" || { echo "FAIL: GET 禁用字段 aspect 漏网"; exit 1; }
echo "$GET" | jq -e "has(\"video_aspect\") | not" || { echo "FAIL: GET 禁用字段 video_aspect 漏网"; exit 1; }
echo "$GET" | jq -e "has(\"aspectRatio\") | not" || { echo "FAIL: GET 禁用字段 aspectRatio 漏网"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] original_script=null → POST 返回 JSON null（非字符串 "undefined"），GET 同样返回 null
  Test: manual:bash -c '
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws1-null.mp4\"}") || { echo "FAIL: null job 创建失败"; exit 1; }
echo "$RESP" | jq -e ".original_script == null" || { echo "FAIL: POST original_script 不是 null"; exit 1; }
NJ=$(echo "$RESP" | jq -r ".id")
NV=$(curl -sf http://localhost:5200/api/ai-video-pipeline/$NJ -H "Authorization: Bearer ZJ-F-FBFYTLFR" | jq -r ".original_script")
[ "$NV" = "null" ] || { echo "FAIL: GET original_script 非 JSON null，实际=$NV"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 缺 local_path 返回 400 + error 字段存在
  Test: manual:bash -c '
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -d "{\"original_script\":\"no local_path\"}")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 local_path 应返 400，实际 $CODE"; exit 1; }
ERR=$(curl -s -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -d "{\"original_script\":\"test\"}")
echo "$ERR" | jq -e "has(\"error\")" || { echo "FAIL: 400 响应缺 error 字段"; exit 1; }
echo OK'
  期望: OK
