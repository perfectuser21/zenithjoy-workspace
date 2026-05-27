---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: 三模板专属 HTML Builder + composeTemplate dispatch

**范围**: `ai-video-pipeline-ai.controller.ts` 新增 `_buildWGHtml`（9:16 Bauhaus）、`_buildCHtml`（16:9 纪录片）、`_buildRHtml`（16:9 深酒红）三函数；composeTemplate 按 templateId dispatch；response 字段合规（html/aspect）；`_buildDynamicTemplateHtml` 改为仅作 fallback 或删除
**大小**: L（~230 行净增，1 文件）
**依赖**: Workstream 1 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `_buildWGHtml` 函数在 `ai-video-pipeline-ai.controller.ts` 中 export
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');if(!c.includes('export function _buildWGHtml')&&!c.includes('export const _buildWGHtml'))process.exit(1)"

- [ ] [ARTIFACT] `_buildCHtml` 函数在 `ai-video-pipeline-ai.controller.ts` 中 export
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');if(!c.includes('export function _buildCHtml')&&!c.includes('export const _buildCHtml'))process.exit(1)"

- [ ] [ARTIFACT] `_buildRHtml` 函数在 `ai-video-pipeline-ai.controller.ts` 中 export
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');if(!c.includes('export function _buildRHtml')&&!c.includes('export const _buildRHtml'))process.exit(1)"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] _buildWGHtml 输出的 HTML 包含 W-G 专属调色板色值（#ede4d2 背景或 #d39c4a 强调色），不是通用回退颜色
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline-ai.controller.ts\",\"utf8\");if(!c.includes(\"_buildWGHtml\")){console.error(\"FAIL: _buildWGHtml missing\");process.exit(1)}const fnStart=c.indexOf(\"_buildWGHtml\");const fnChunk=c.slice(fnStart,fnStart+3000);if(!fnChunk.includes(\"#ede4d2\")&&!fnChunk.includes(\"d39c4a\")&&!fnChunk.includes(\"WG\")&&!fnChunk.includes(\"Bauhaus\")){console.error(\"FAIL: _buildWGHtml 缺 WG 专属视觉标识\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] _buildCHtml 输出的 HTML 包含 C 模板专属色值（#0a0a0a 或 #c9a23d），与 WG/R 区分
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline-ai.controller.ts\",\"utf8\");if(!c.includes(\"_buildCHtml\")){console.error(\"FAIL: _buildCHtml missing\");process.exit(1)}const fnStart=c.indexOf(\"_buildCHtml\");const fnChunk=c.slice(fnStart,fnStart+3000);if(!fnChunk.includes(\"#0a0a0a\")&&!fnChunk.includes(\"c9a23d\")&&!fnChunk.includes(\"SlideC\")&&!fnChunk.includes(\"纪录片\")){console.error(\"FAIL: _buildCHtml 缺 C 专属视觉标识\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] _buildRHtml 输出的 HTML 包含 R 模板专属色值（#1d1410 或 #c08e6a 玫瑰金），与 WG/C 区分
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline-ai.controller.ts\",\"utf8\");if(!c.includes(\"_buildRHtml\")){console.error(\"FAIL: _buildRHtml missing\");process.exit(1)}const fnStart=c.indexOf(\"_buildRHtml\");const fnChunk=c.slice(fnStart,fnStart+3000);if(!fnChunk.includes(\"#1d1410\")&&!fnChunk.includes(\"c08e6a\")&&!fnChunk.includes(\"SlideR\")&&!fnChunk.includes(\"深酒\")){console.error(\"FAIL: _buildRHtml 缺 R 专属视觉标识\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] composeTemplate handler 根据 templateId 调用正确的专属 builder（W-G → _buildWGHtml 分支）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline-ai.controller.ts\",\"utf8\");const composeStart=c.indexOf(\"async function composeTemplate\");const composeEnd=c.indexOf(\"\nexport \",composeStart+10);const fn=c.slice(composeStart,composeEnd>0?composeEnd:composeStart+5000);if(!fn.includes(\"_buildWGHtml\")||!fn.includes(\"_buildCHtml\")||!fn.includes(\"_buildRHtml\")){console.error(\"FAIL: composeTemplate 未 dispatch 到三个 builder\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] compose-template response 禁用字段 content/result/ratio/output 不出现在 res.json() 参数中
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline-ai.controller.ts\",\"utf8\");const resJson=c.match(/res\.json\(\{[^}]+\}/g)||[];const joined=resJson.join(\"\");[\"content:\",\"result:\",\"\\\"ratio\\\"\",\"output:\"].forEach(f=>{if(joined.includes(f)){console.error(\"FAIL: 禁用字段 \"+f+\" 在 res.json 中\");process.exit(1)}});console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] templateId = 未知值时 composeTemplate 返回 400（error path）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline-ai.controller.ts\",\"utf8\");const has400=c.includes(\"status(400)\")&&c.includes(\"unknown template\");if(!has400){console.error(\"FAIL: 未知 templateId 无 400 响应\");process.exit(1)}console.log(\"OK\")"'
  期望: OK
