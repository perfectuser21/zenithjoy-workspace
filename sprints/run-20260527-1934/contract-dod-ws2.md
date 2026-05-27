---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: _buildWGHtml / _buildCHtml / _buildRHtml + switch 分发

**范围**: apps/api/src/controllers/ai-video-pipeline-ai.controller.ts 新增三个专属函数（W-G 1080×1920 #ede4d2 底 / C 1080×1920 / R 1920×1080）；_buildDynamicTemplateHtml 改为 switch 分发；compose-template 端点对外签名不变
**大小**: M（~190 行净增，1 文件）
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] _buildWGHtml / _buildCHtml / _buildRHtml 三个函数定义存在于 controller
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');if(!c.includes('_buildWGHtml')||!c.includes('_buildCHtml')||!c.includes('_buildRHtml')){console.error('FAIL: 缺专属函数');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] _buildDynamicTemplateHtml 内分发到 _buildWGHtml（switch 或条件语句）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');const start=c.indexOf('_buildDynamicTemplateHtml');if(start<0){process.exit(1)}const body=c.slice(start,start+2000);if(!body.match(/_buildWGHtml|case.*W-G|'W-G'/)){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] W-G 函数含 #ede4d2 底色 + 1080/1920 尺寸
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');if(!c.includes('ede4d2')||!c.includes('1080')||!c.includes('1920')){process.exit(1)}console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] W-G job compose-template → aspect="9:16" + html 含 #ede4d2 底色
  Test: manual:bash -c '
WG_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws2-wg.mp4\",\"template_id\":\"W-G\"}" | jq -r ".id") || { echo "FAIL: W-G job 创建失败"; exit 1; }
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$WG_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"transcript\":\"test\",\"segments\":[],\"duration\":10}") || { echo "FAIL: W-G compose-template 失败"; exit 1; }
echo "$RESP" | jq -e ".aspect == \"9:16\"" || { echo "FAIL: W-G aspect 不是 9:16"; exit 1; }
echo "$RESP" | jq -r ".html" | grep -q "ede4d2" || { echo "FAIL: W-G #ede4d2 不在 HTML"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] C 模板 job compose-template → aspect="9:16" + html 非空（_buildCHtml 实现）
  Test: manual:bash -c '
C_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws2-c.mp4\",\"template_id\":\"C\"}" | jq -r ".id") || { echo "FAIL: C job 创建失败"; exit 1; }
C_RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$C_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"transcript\":\"test\",\"segments\":[],\"duration\":10}") || { echo "FAIL: C compose-template 失败"; exit 1; }
echo "$C_RESP" | jq -e ".aspect == \"9:16\"" || { echo "FAIL: _buildCHtml aspect 不是 9:16"; exit 1; }
echo "$C_RESP" | jq -e ".html | type == \"string\" and length > 0" || { echo "FAIL: _buildCHtml html 为空"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] R 模板 job compose-template → aspect="16:9"（横版，_buildRHtml 实现）
  Test: manual:bash -c '
R_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws2-r.mp4\",\"template_id\":\"R\"}" | jq -r ".id") || { echo "FAIL: R job 创建失败"; exit 1; }
R_RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$R_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"transcript\":\"test\",\"segments\":[],\"duration\":10}") || { echo "FAIL: R compose-template 失败"; exit 1; }
echo "$R_RESP" | jq -e ".aspect == \"16:9\"" || { echo "FAIL: _buildRHtml aspect 不是 16:9"; exit 1; }
echo "$R_RESP" | jq -e ".html | type == \"string\" and length > 0" || { echo "FAIL: _buildRHtml html 为空"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] compose-template 必填字段完整 + 禁用字段（ratio/aspectRatio/format/orientation）不存在
  Test: manual:bash -c '
WG_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws2-schema.mp4\",\"template_id\":\"W-G\"}" | jq -r ".id")
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$WG_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"transcript\":\"test\",\"segments\":[],\"duration\":10}") || { echo "FAIL"; exit 1; }
echo "$RESP" | jq -e "[has(\"html\"),has(\"aspect\")] | all" || { echo "FAIL: compose-template 必填字段不完整"; exit 1; }
echo "$RESP" | jq -e "has(\"ratio\") | not" || { echo "FAIL: 禁用字段 ratio 漏网"; exit 1; }
echo "$RESP" | jq -e "has(\"aspectRatio\") | not" || { echo "FAIL: 禁用字段 aspectRatio 漏网"; exit 1; }
echo "$RESP" | jq -e "has(\"format\") | not" || { echo "FAIL: 禁用字段 format 漏网"; exit 1; }
echo "$RESP" | jq -e "has(\"orientation\") | not" || { echo "FAIL: 禁用字段 orientation 漏网"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] W-G HTML 含 1080px 宽度 + 1920px 高度（竖版尺寸校验）
  Test: manual:bash -c '
WG_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws2-size.mp4\",\"template_id\":\"W-G\"}" | jq -r ".id")
HTML=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$WG_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"transcript\":\"尺寸测试\",\"segments\":[],\"duration\":10}" | jq -r ".html") || { echo "FAIL"; exit 1; }
echo "$HTML" | grep -q "1080" || { echo "FAIL: W-G HTML 缺 1080 宽度"; exit 1; }
echo "$HTML" | grep -q "1920" || { echo "FAIL: W-G HTML 缺 1920 高度"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 无 template_id 的 job 调用 compose-template → 400 + error 字段
  Test: manual:bash -c '
NO_TPL=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws2-notpl.mp4\"}" | jq -r ".id")
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:5200/api/ai-video-pipeline/$NO_TPL/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"transcript\":\"test\",\"segments\":[],\"duration\":10}")
[ "$CODE" = "400" ] || { echo "FAIL: 无 template_id 应返 400，实际 $CODE"; exit 1; }
echo OK'
  期望: OK
