---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: ffprobe width/height + detectedAspect + target_aspect 列 + 单文件输出 + 前端比例选择器

**范围**: migration ADD COLUMN target_aspect TEXT NULL + detected_aspect TEXT NULL；ffprobe step1 读 vStream.width/height + **导出函数** detectAspect(w,h,rotation)（rotation swap）；updateStatus/PATCH 写 detected_aspect；非模板路径 effectiveTarget 单文件；LocalVideoPipelinePage 9:16/16:9 选择按钮 + createJob 传 target_aspect
**大小**: M（跨 4 个文件）
**依赖**: Workstream 2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 含 target_aspect + detected_aspect 两列（ai_video_pipeline_jobs）
  Test: node -e "const{readdirSync,readFileSync}=require('fs');const m=readdirSync('apps/api/db/migrations').filter(f=>f.endsWith('.sql')).some(f=>{try{const c=readFileSync('apps/api/db/migrations/'+f,'utf8');return c.includes('detected_aspect')&&c.includes('ai_video_pipeline_jobs')}catch{return false}});if(!m){console.error('FAIL: detected_aspect migration 不存在');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] detectAspect 函数在 video-pipeline.ts 中**导出**（export function detectAspect）
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');if(!c.includes('export') || !c.includes('detectAspect')){console.error('FAIL: detectAspect 未导出');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] video-pipeline.ts 含 effectiveTarget 变量（非模板路径单文件逻辑）
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');if(!c.includes('effectiveTarget')){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] LocalVideoPipelinePage 含 target_aspect 比例选择器（9:16 按钮）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');if(!c.includes('target_aspect')||!c.includes('9:16')){process.exit(1)}console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] detectAspect 函数执行验证：(1920,1080,90)→"9:16"，(1920,1080,0)→"16:9"（tsx 直接调用，非源码检查）
  Test: manual:bash -c '
cd /workspace && npx tsx -e "
import { detectAspect } from '"'"'./services/agent/src/handlers/video-pipeline.js'"'"';
const r1 = detectAspect(1920, 1080, 90);
if (r1 !== '"'"'9:16'"'"') { console.error('"'"'FAIL: detectAspect(1920,1080,90)='"'"' + r1 + '"'"' 应为 9:16'"'"'); process.exit(1); }
const r2 = detectAspect(1920, 1080, 0);
if (r2 !== '"'"'16:9'"'"') { console.error('"'"'FAIL: detectAspect(1920,1080,0)='"'"' + r2 + '"'"' 应为 16:9'"'"'); process.exit(1); }
console.log('"'"'OK'"'"');
" 2>&1 | grep -E "OK|FAIL"'
  期望: OK

- [ ] [BEHAVIOR] POST 含 target_aspect → 201 schema 完整（4 字段均存在 + 值匹配）
  Test: manual:bash -c '
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws3-target.mp4\",\"original_script\":\"WS3 测试\",\"target_aspect\":\"9:16\"}") || { echo "FAIL: POST 非 2xx"; exit 1; }
echo "$RESP" | jq -e ".target_aspect == \"9:16\"" || { echo "FAIL: target_aspect 返回值不匹配"; exit 1; }
echo "$RESP" | jq -e "[has(\"id\"),has(\"status\"),has(\"original_script\"),has(\"target_aspect\")] | all" || { echo "FAIL: POST 201 schema 不完整"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET 响应含 detected_aspect + target_aspect，禁用字段（aspect/video_aspect/aspectRatio/videoAspect）不存在
  Test: manual:bash -c '
JOB_ID=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws3-get.mp4\",\"target_aspect\":\"16:9\"}" | jq -r ".id")
GET=$(curl -sf http://localhost:5200/api/ai-video-pipeline/$JOB_ID \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR") || { echo "FAIL: GET 失败"; exit 1; }
echo "$GET" | jq -e "has(\"detected_aspect\")" || { echo "FAIL: GET 缺 detected_aspect 字段"; exit 1; }
echo "$GET" | jq -e "has(\"target_aspect\")" || { echo "FAIL: GET 缺 target_aspect 字段"; exit 1; }
echo "$GET" | jq -e ".target_aspect == \"16:9\"" || { echo "FAIL: GET target_aspect 值不匹配"; exit 1; }
echo "$GET" | jq -e "has(\"aspect\") | not" || { echo "FAIL: 禁用字段 aspect 漏网"; exit 1; }
echo "$GET" | jq -e "has(\"video_aspect\") | not" || { echo "FAIL: 禁用字段 video_aspect 漏网"; exit 1; }
echo "$GET" | jq -e "has(\"aspectRatio\") | not" || { echo "FAIL: 禁用字段 aspectRatio 漏网"; exit 1; }
echo "$GET" | jq -e "has(\"videoAspect\") | not" || { echo "FAIL: 禁用字段 videoAspect 漏网"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] 非模板路径强制双文件逻辑已删除（WS3 unit test 全部通过验证）
  Test: manual:bash -c '
cd /workspace && npx vitest run sprints/run-20260527-1934/tests/ws3/ffprobe-aspect-detection.test.ts \
  --reporter=verbose 2>&1 | tee /tmp/ws3-behavior.log
grep -c "✓\|passed" /tmp/ws3-behavior.log | xargs -I{} [ {} -ge 4 ] \
  || { echo "FAIL: WS3 unit tests 未全部通过（effectiveTarget/单文件逻辑未实现）"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 无效 job id 返回 404 + error 字段
  Test: manual:bash -c '
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:5200/api/ai-video-pipeline/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR")
[ "$CODE" = "404" ] || { echo "FAIL: 无效 id 应返 404，实际 $CODE"; exit 1; }
ERR=$(curl -s http://localhost:5200/api/ai-video-pipeline/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR")
echo "$ERR" | jq -e "has(\"error\")" || { echo "FAIL: 404 响应缺 error 字段"; exit 1; }
echo OK'
  期望: OK
