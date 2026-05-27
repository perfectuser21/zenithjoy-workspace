---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: ffprobe width/height + detectedAspect + target_aspect 列 + 单文件输出 + 前端比例选择器

**范围**: migration ADD COLUMN target_aspect TEXT NULL + detected_aspect TEXT NULL；ffprobe step1 读 vStream.width/height + detectAspect(w,h,rotation) 函数（rotation swap）；PATCH /ai-video-pipeline/{id}/progress 或内部 updateStatus 写 detected_aspect；非模板路径 effectiveTarget = job.target_aspect ?? detectedAspect ?? "9:16"，只生成单文件；LocalVideoPipelinePage 加 9:16/16:9 比例选择按钮 + createJob 传 target_aspect
**大小**: M
**依赖**: Workstream 2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 含 target_aspect + detected_aspect 两列定义
  Test: node -e "const{readdirSync,readFileSync}=require('fs');const found=readdirSync('apps/api/db/migrations').filter(f=>f.endsWith('.sql')).some(f=>{try{const c=readFileSync('apps/api/db/migrations/'+f,'utf8');return c.includes('detected_aspect')&&c.includes('ai_video_pipeline_jobs')}catch{return false}});if(!found){console.error('FAIL: detected_aspect migration 不存在');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] detectAspect 函数存在于 video-pipeline.ts（含 width/height + rotation swap 逻辑）
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');if(!c.includes('detectAspect')||!c.includes('width')||!c.includes('height')){console.error('FAIL: detectAspect 或 width/height 读取缺失');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] video-pipeline.ts 含 effectiveTarget 变量（非模板路径单文件逻辑）
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');if(!c.includes('effectiveTarget')){console.error('FAIL: effectiveTarget 变量未定义');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] LocalVideoPipelinePage 含比例选择器 UI（target_aspect 相关代码）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');if(!c.includes('target_aspect')||!c.includes('9:16')){console.error('FAIL: 前端缺比例选择器');process.exit(1)}console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] POST 含 target_aspect → 201 响应原样返回 target_aspect 字段（schema 字段值验证）
  Test: manual:bash -c '
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws3-target.mp4\",\"original_script\":\"WS3 测试\",\"target_aspect\":\"9:16\"}") || { echo "FAIL: POST 非 2xx"; exit 1; }
echo "$RESP" | jq -e ".target_aspect == \"9:16\"" || { echo "FAIL: target_aspect 返回值不匹配"; exit 1; }
echo "$RESP" | jq -e "[has(\"id\"),has(\"status\"),has(\"original_script\"),has(\"target_aspect\")] | all" || { echo "FAIL: POST 201 schema 不完整"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/ai-video-pipeline/{id} 响应含 detected_aspect + target_aspect 字段（schema 完整性）
  Test: manual:bash -c '
JOB_ID=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws3-get.mp4\",\"target_aspect\":\"16:9\"}" | jq -r ".id")
GET_RESP=$(curl -sf http://localhost:5200/api/ai-video-pipeline/$JOB_ID \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR") || { echo "FAIL: GET 失败"; exit 1; }
echo "$GET_RESP" | jq -e "has(\"detected_aspect\")" || { echo "FAIL: GET 缺 detected_aspect 字段"; exit 1; }
echo "$GET_RESP" | jq -e "has(\"target_aspect\")" || { echo "FAIL: GET 缺 target_aspect 字段"; exit 1; }
echo "$GET_RESP" | jq -e ".target_aspect == \"16:9\"" || { echo "FAIL: target_aspect GET 返回值不匹配"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET 响应禁用字段 (aspect/video_aspect/aspectRatio/videoAspect) 不存在
  Test: manual:bash -c '
JOB_ID=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws3-forbidden.mp4\"}" | jq -r ".id")
GET_RESP=$(curl -sf http://localhost:5200/api/ai-video-pipeline/$JOB_ID \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR") || { echo "FAIL: GET 失败"; exit 1; }
echo "$GET_RESP" | jq -e "has(\"aspect\") | not" || { echo "FAIL: 禁用字段 aspect 漏网"; exit 1; }
echo "$GET_RESP" | jq -e "has(\"video_aspect\") | not" || { echo "FAIL: 禁用字段 video_aspect 漏网"; exit 1; }
echo "$GET_RESP" | jq -e "has(\"aspectRatio\") | not" || { echo "FAIL: 禁用字段 aspectRatio 漏网"; exit 1; }
echo "$GET_RESP" | jq -e "has(\"videoAspect\") | not" || { echo "FAIL: 禁用字段 videoAspect 漏网"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] detectAspect 函数逻辑：rotation swap 存在（1920×1080 + rotation=90 → 实效宽高 = 1080×1920 → 9:16）
  Test: manual:bash -c '
node -e "
const src = require(\"fs\").readFileSync(\"services/agent/src/handlers/video-pipeline.ts\", \"utf8\");
// 检查 detectAspect 函数存在
if (!src.includes(\"detectAspect\")) { console.error(\"FAIL: detectAspect 函数不存在\"); process.exit(1); }
// 检查有 rotation swap 逻辑（90° 时 w/h 互换）
const hasSwap = src.includes(\"90\") && (src.includes(\"[h, w]\") || src.includes(\"swap\") || src.includes(\"[height, width]\") || src.includes(\"effectiveW\"));
if (!hasSwap) { console.error(\"FAIL: 缺 rotation=90° 时 width/height 互换逻辑\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK

- [ ] [BEHAVIOR] 非模板路径强制双文件逻辑已删除 — effectiveTarget 单文件输出存在
  Test: manual:bash -c '
node -e "
const src = require(\"fs\").readFileSync(\"services/agent/src/handlers/video-pipeline.ts\", \"utf8\");
if (!src.includes(\"effectiveTarget\")) { console.error(\"FAIL: effectiveTarget 未定义\"); process.exit(1); }
// 检测旧的强制双文件写法是否已被删除
// 旧写法特征：连续两行分别 copyFileSync 到 9_16.mp4 和 16_9.mp4（无条件）
const doubleWrite = /copyFileSync[^;]+9_16[^;]+;[\s\S]{0,200}copyFileSync[^;]+16_9[^;]+;/.test(src);
if (doubleWrite) { console.error(\"FAIL: 强制双文件写法未删除（9_16 + 16_9 无条件并存）\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK
