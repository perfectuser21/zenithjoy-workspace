contract_branch: cp-harness-propose-r2-1e9b07eb
workstream_index: 1
sprint_dir: sprints/zj-ai-video-ws1-ws3-ws4

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: original_script 字段完整链路

**范围**: DB migration 3 列就绪；createJob API 读写 original_script + target_aspect + detected_aspect（响应嵌套在 .job 对象，HTTP 201）；composeTemplate 注入前缀；前端 textarea 存在
**大小**: S（< 100 行净增）
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] DB migration SQL 文件存在，含 original_script / target_aspect / detected_aspect 三列
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/api/db/migrations');const f=files.find(n=>n.includes('original_script'));if(!f)process.exit(1);const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');if(!c.includes('original_script')||!c.includes('target_aspect')||!c.includes('detected_aspect'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/services/ai-video-pipeline.service.ts` createJob 参数接受 originalScript + targetAspect
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/ai-video-pipeline.service.ts','utf8');if(!c.includes('originalScript')&&!c.includes('original_script'))process.exit(1);if(!c.includes('targetAspect')&&!c.includes('target_aspect'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/controllers/ai-video-pipeline-ai.controller.ts` 含原始文案前缀注入字符串
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');if(!c.includes('用户录制前参考文案（非逐字稿，仅意图参考）'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 前端 `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx` 含 original_script 字段引用
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');if(!c.includes('original_script'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] createJob POST 201 响应含 .job 嵌套对象，字段值与请求一致
- [ ] [BEHAVIOR] .job 含 id(string) 且 original_script/target_aspect/detected_aspect 必填字段全部存在
- [ ] [BEHAVIOR] 响应不含禁用字段 originalScript
- [ ] [BEHAVIOR] composeTemplate 源码含前缀注入逻辑（含条件保护）
- [ ] [BEHAVIOR] error path — 缺 local_path 返 400 + error 字段
- [ ] [ARTIFACT] DB migration SQL 存在含三列
