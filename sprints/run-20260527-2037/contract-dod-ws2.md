---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: 三模板专属 HTML Builder + composeTemplate dispatch

**范围**: `ai-video-pipeline-ai.controller.ts` 新增 `_buildWGHtml`（9:16 Bauhaus）、`_buildCHtml`（16:9 纪录片）、`_buildRHtml`（16:9 深酒红）三函数；composeTemplate 按 templateId dispatch；response 字段合规（html/aspect）；`_buildDynamicTemplateHtml` 改为仅作 fallback 或删除
**大小**: L（~230 行净增，1 文件）
**依赖**: Workstream 1 完成后

> **WS2 BEHAVIOR oracle 说明**（dod_machineability 修复）:
> compose-template 端点调用 Claude API（Sonnet），evaluator Mode A 中无法安全调用（速率限制/费用）。
> WS2 采用「双层验证」策略：
> - **源码结构层**（可独立验证）: 三个 builder 函数 export + 专属色值 + composeTemplate dispatch + 禁用字段反向
> - **error path 运行时层**（无需 Claude）: curl POST 无效 templateId → 400 + error 字段
> Final E2E（windows_cloud）通过完整 agent-e2e-video.yml 验证 success path（调 Claude + 生成真实 HTML）。

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `_buildWGHtml` 函数在 `ai-video-pipeline-ai.controller.ts` 中 export
  Test: bash -c 'grep -qE "export (function|const) _buildWGHtml" apps/api/src/controllers/ai-video-pipeline-ai.controller.ts && echo OK || { echo FAIL; exit 1; }'

- [ ] [ARTIFACT] `_buildCHtml` 函数在 `ai-video-pipeline-ai.controller.ts` 中 export
  Test: bash -c 'grep -qE "export (function|const) _buildCHtml" apps/api/src/controllers/ai-video-pipeline-ai.controller.ts && echo OK || { echo FAIL; exit 1; }'

- [ ] [ARTIFACT] `_buildRHtml` 函数在 `ai-video-pipeline-ai.controller.ts` 中 export
  Test: bash -c 'grep -qE "export (function|const) _buildRHtml" apps/api/src/controllers/ai-video-pipeline-ai.controller.ts && echo OK || { echo FAIL; exit 1; }'

---

## BEHAVIOR 条目（双层验证策略）

- [ ] [BEHAVIOR] _buildWGHtml 函数体含 W-G 专属背景色 #ede4d2 或强调色 #d39c4a（区别于通用 fallback）
  Test: manual:bash -c 'F="apps/api/src/controllers/ai-video-pipeline-ai.controller.ts"; IDX=$(grep -n "_buildWGHtml" "$F" | head -1 | cut -d: -f1); [ -n "$IDX" ] || { echo "FAIL: _buildWGHtml 未找到"; exit 1; }; CHUNK=$(tail -n +"$IDX" "$F" | head -100); echo "$CHUNK" | grep -qiE "ede4d2|d39c4a" || { echo "FAIL: _buildWGHtml 缺 WG 专属色值"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] _buildCHtml 函数体含 C 模板专属色（#0a0a0a 或 #c9a23d），与 WG/R 区分
  Test: manual:bash -c 'F="apps/api/src/controllers/ai-video-pipeline-ai.controller.ts"; IDX=$(grep -n "_buildCHtml" "$F" | head -1 | cut -d: -f1); [ -n "$IDX" ] || { echo "FAIL: _buildCHtml 未找到"; exit 1; }; CHUNK=$(tail -n +"$IDX" "$F" | head -100); echo "$CHUNK" | grep -qiE "0a0a0a|c9a23d" || { echo "FAIL: _buildCHtml 缺 C 专属色值"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] _buildRHtml 函数体含 R 模板专属色（#1d1410 或 #c08e6a 玫瑰金），与 WG/C 区分
  Test: manual:bash -c 'F="apps/api/src/controllers/ai-video-pipeline-ai.controller.ts"; IDX=$(grep -n "_buildRHtml" "$F" | head -1 | cut -d: -f1); [ -n "$IDX" ] || { echo "FAIL: _buildRHtml 未找到"; exit 1; }; CHUNK=$(tail -n +"$IDX" "$F" | head -100); echo "$CHUNK" | grep -qiE "1d1410|c08e6a" || { echo "FAIL: _buildRHtml 缺 R 专属色值"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] composeTemplate 函数体内按 W-G/C/R 分发调用三个专属 builder（dispatch 逻辑验证）
  Test: manual:bash -c 'F="apps/api/src/controllers/ai-video-pipeline-ai.controller.ts"; IDX=$(grep -n "async function composeTemplate" "$F" | head -1 | cut -d: -f1); [ -n "$IDX" ] || { echo "FAIL: composeTemplate 函数未找到"; exit 1; }; CHUNK=$(tail -n +"$IDX" "$F" | head -60); echo "$CHUNK" | grep -q "_buildWGHtml" || { echo "FAIL: dispatch 缺 _buildWGHtml"; exit 1; }; echo "$CHUNK" | grep -q "_buildCHtml" || { echo "FAIL: dispatch 缺 _buildCHtml"; exit 1; }; echo "$CHUNK" | grep -q "_buildRHtml" || { echo "FAIL: dispatch 缺 _buildRHtml"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] compose-template error path — 无效 templateId 返回 400 + error 字段（curl runtime oracle，无需 Claude）
  Test: manual:bash -c 'JID=$(psql "${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}" -t -c "SELECT id FROM ai_video_pipeline_jobs ORDER BY created_at DESC LIMIT 1" 2>/dev/null | tr -d " \n"); [ -n "$JID" ] || { echo "FAIL: 无可用 job_id（WS1 需先完成）"; exit 1; }; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:5200/api/ai-video/jobs/${JID}/compose-template" -H "Content-Type: application/json" -d '"'"'{"templateId":"INVALID_XYZ_999"}'"'"'); [ "$CODE" = "400" ] || { echo "FAIL: 无效 templateId 期望 400，实际=$CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] compose-template res.json() 不含禁用字段 content/result/ratio/output（response key 反向检查）
  Test: manual:bash -c 'F="apps/api/src/controllers/ai-video-pipeline-ai.controller.ts"; MATCHES=$(grep -o '"'"'res\.json([^)]*{[^}]*}'"'"' "$F" | tr "\n" " "); for banned in '"'"'content:'"'"' '"'"'result:'"'"' '"'"'"ratio":'"'"' '"'"'output:'"'"'; do echo "$MATCHES" | grep -q "$banned" && { echo "FAIL: 禁用字段 $banned 在 res.json()"; exit 1; } || true; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] keys 完整性 — compose-template success response 包含 html 和 aspect 字段（source dispatch 结构确认）
  Test: manual:bash -c 'F="apps/api/src/controllers/ai-video-pipeline-ai.controller.ts"; IDX=$(grep -n "async function composeTemplate" "$F" | head -1 | cut -d: -f1); [ -n "$IDX" ] || { echo "FAIL: composeTemplate 未找到"; exit 1; }; CHUNK=$(tail -n +"$IDX" "$F" | head -120); echo "$CHUNK" | grep -qE "html" || { echo "FAIL: response 缺 html 字段"; exit 1; }; echo "$CHUNK" | grep -qE "aspect" || { echo "FAIL: response 缺 aspect 字段"; exit 1; }; echo OK'
  期望: OK
