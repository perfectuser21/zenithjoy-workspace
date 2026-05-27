contract_branch: cp-harness-propose-r1-96db2647
workstream_index: 2
sprint_dir: sprints/run-20260527-2037

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: 三模板专属 HTML Builder + composeTemplate dispatch

**范围**: `ai-video-pipeline-ai.controller.ts` 新增 `_buildWGHtml`（9:16 Bauhaus）、`_buildCHtml`（16:9 纪录片）、`_buildRHtml`（16:9 深酒红）三函数；composeTemplate 按 templateId dispatch；response 字段合规（html/aspect）；`_buildDynamicTemplateHtml` 改为仅作 fallback 或删除
**大小**: L（~230 行净增，1 文件）
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `_buildWGHtml` 函数在 `ai-video-pipeline-ai.controller.ts` 中 export
- [ ] [ARTIFACT] `_buildCHtml` 函数在 `ai-video-pipeline-ai.controller.ts` 中 export
- [ ] [ARTIFACT] `_buildRHtml` 函数在 `ai-video-pipeline-ai.controller.ts` 中 export

## BEHAVIOR 条目

- [ ] [BEHAVIOR] _buildWGHtml 函数体含 W-G 专属背景色 #ede4d2 或强调色 #d39c4a
- [ ] [BEHAVIOR] _buildCHtml 函数体含 C 模板专属色（#0a0a0a 或 #c9a23d）
- [ ] [BEHAVIOR] _buildRHtml 函数体含 R 模板专属色（#1d1410 或 #c08e6a 玫瑰金）
- [ ] [BEHAVIOR] composeTemplate 函数体内按 W-G/C/R 分发调用三个专属 builder
- [ ] [BEHAVIOR] compose-template error path — 无效 templateId 返回 400 + error 字段
- [ ] [BEHAVIOR] compose-template res.json() 不含禁用字段 content/result/ratio/output
- [ ] [BEHAVIOR] keys 完整性 — compose-template success response 包含 html 和 aspect 字段
