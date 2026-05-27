contract_branch: cp-05272022-ws-e66d2e17-ws1
workstream_index: 1
sprint_dir: sprints/run-20260527-1934

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
- [ ] [ARTIFACT] AiVideoPipelineService.createJob 含 originalScript 参数
- [ ] [ARTIFACT] LocalVideoPipelinePage 含 original_script textarea + 原始文案文本
- [ ] [ARTIFACT] AI controller 含 original_script 条件注入（含空值保护 if/??/&&）

## BEHAVIOR 条目

- [ ] [BEHAVIOR] POST 含 original_script → 201 响应原样返回 original_script 字段值
- [ ] [BEHAVIOR] POST 201 必填字段完整性（id/status/original_script/target_aspect 均存在）
- [ ] [BEHAVIOR] POST 禁用字段（script/raw_script/source_script/input_script）不存在
- [ ] [BEHAVIOR] GET /api/ai-video-pipeline/{id} 返回全部 5 个 PRD 必填字段 + 禁用字段不存在
- [ ] [BEHAVIOR] original_script=null → POST 返回 JSON null（非字符串 "undefined"），GET 同样返回 null
- [ ] [BEHAVIOR] error path — 缺 local_path 返回 400 + error 字段存在
