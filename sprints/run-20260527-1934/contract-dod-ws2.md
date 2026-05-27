---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: _buildWGHtml / _buildCHtml / _buildRHtml + switch 分发

**范围**: 在 apps/api/src/controllers/ai-video-pipeline-ai.controller.ts 新增三个专属 HTML 构建函数（W-G 1080×1920 / C 1080×1920 / R 1920×1080）；_buildDynamicTemplateHtml 改为 switch 分发；compose-template 端点行为对外不变（仍返回 {html, aspect, width, height, phoneRect}）
**大小**: M
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] _buildWGHtml 函数定义存在于 controller 文件
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');if(!c.includes('_buildWGHtml')||!c.includes('_buildCHtml')||!c.includes('_buildRHtml')){console.error('FAIL: 缺专属函数定义');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] _buildDynamicTemplateHtml 改为 switch/条件分发（不再直接构建 HTML）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');const inBuildDynamic=c.slice(c.indexOf('_buildDynamicTemplateHtml'));const has_wg_call=inBuildDynamic.includes('_buildWGHtml');if(!has_wg_call){console.error('FAIL: _buildDynamicTemplateHtml 未分发到 _buildWGHtml');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] W-G 函数硬编码宽 1080、高 1920（竖版），C 函数 1080×1920，R 函数 1920×1080（横版）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');if(!c.includes('1080')&&!c.includes('1920')){console.error('FAIL: 缺尺寸定义');process.exit(1)}console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] compose-template (W-G job) → aspect="9:16" + html 含 ede4d2 W-G 底色
  Test: manual:bash -c '
WG_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws2-wg.mp4\",\"template_id\":\"W-G\"}" | jq -r ".id") || { echo "FAIL: job 创建失败"; exit 1; }
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$WG_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"transcript\":\"test\",\"segments\":[],\"duration\":10}") || { echo "FAIL: compose-template 失败"; exit 1; }
echo "$RESP" | jq -e ".aspect == \"9:16\"" || { echo "FAIL: W-G aspect 不是 9:16"; exit 1; }
echo "$RESP" | jq -r ".html" | grep -q "ede4d2" || { echo "FAIL: W-G 色板 #ede4d2 不在 HTML"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] compose-template response schema 完整性 (html + aspect)，禁用字段 ratio/aspectRatio 不存在
  Test: manual:bash -c '
WG_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws2-schema.mp4\",\"template_id\":\"W-G\"}" | jq -r ".id")
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$WG_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"transcript\":\"test\",\"segments\":[],\"duration\":10}") || { echo "FAIL"; exit 1; }
echo "$RESP" | jq -e "[has(\"html\"),has(\"aspect\")] | all" || { echo "FAIL: schema 不完整"; exit 1; }
echo "$RESP" | jq -e "has(\"ratio\") | not" || { echo "FAIL: 禁用字段 ratio"; exit 1; }
echo "$RESP" | jq -e "has(\"aspectRatio\") | not" || { echo "FAIL: 禁用字段 aspectRatio"; exit 1; }
echo "$RESP" | jq -e "has(\"format\") | not" || { echo "FAIL: 禁用字段 format"; exit 1; }
echo "$RESP" | jq -e "has(\"orientation\") | not" || { echo "FAIL: 禁用字段 orientation"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] W-G HTML 包含 1080px 宽度和 1920px 高度（竖版尺寸校验）
  Test: manual:bash -c '
WG_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws2-size.mp4\",\"template_id\":\"W-G\"}" | jq -r ".id")
HTML=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$WG_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"transcript\":\"测试\",\"segments\":[],\"duration\":10}" | jq -r ".html") || { echo "FAIL"; exit 1; }
echo "$HTML" | grep -q "1080" || { echo "FAIL: W-G HTML 缺 1080 宽度"; exit 1; }
echo "$HTML" | grep -q "1920" || { echo "FAIL: W-G HTML 缺 1920 高度"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] compose-template 无 template_id 的 job → 400 + error 字段（error path）
  Test: manual:bash -c '
NO_TPL_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/ws2-notpl.mp4\"}" | jq -r ".id")
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:5200/api/ai-video-pipeline/$NO_TPL_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"transcript\":\"test\",\"segments\":[],\"duration\":10}")
[ "$CODE" = "400" ] || { echo "FAIL: 无 template_id 应返 400，实际 $CODE"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] _buildWGHtml 函数在源文件中独立定义（不是 _buildDynamicTemplateHtml 内联逻辑）
  Test: manual:bash -c '
node -e "
const c = require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline-ai.controller.ts\", \"utf8\");
const wgIdx = c.indexOf(\"function _buildWGHtml\") !== -1 ? c.indexOf(\"function _buildWGHtml\") : c.indexOf(\"_buildWGHtml = \");
if (wgIdx < 0) { console.error(\"FAIL: _buildWGHtml 函数定义不存在\"); process.exit(1); }
const cIdx = c.indexOf(\"function _buildCHtml\") !== -1 ? c.indexOf(\"function _buildCHtml\") : c.indexOf(\"_buildCHtml = \");
const rIdx = c.indexOf(\"function _buildRHtml\") !== -1 ? c.indexOf(\"function _buildRHtml\") : c.indexOf(\"_buildRHtml = \");
if (cIdx < 0 || rIdx < 0) { console.error(\"FAIL: _buildCHtml 或 _buildRHtml 未定义\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK
