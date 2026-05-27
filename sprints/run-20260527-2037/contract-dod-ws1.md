---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB Migration + API 层新字段

**范围**: 新增 migration SQL 加三列（original_script/target_aspect/detected_aspect），更新 PipelineJob interface，createJob 接受新字段，updateProgress 接受 detected_aspect
**大小**: M（~140 行净增，3 文件）
**依赖**: 无（串行链起点）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在于 `apps/api/db/migrations/`，含 `original_script` 关键字
  Test: node -e "const fs=require('fs');const f=fs.readdirSync('apps/api/db/migrations').find(x=>/original_script/.test(x)||(/20260527/.test(x)&&x.endsWith('.sql')));if(!f)process.exit(1);const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');if(!c.includes('original_script'))process.exit(1)"

- [ ] [ARTIFACT] migration SQL 含 `target_aspect` 列定义
  Test: node -e "const fs=require('fs');const f=fs.readdirSync('apps/api/db/migrations').find(x=>/original_script/.test(x)||(/20260527/.test(x)&&x.endsWith('.sql')));const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');if(!c.includes('target_aspect'))process.exit(1)"

- [ ] [ARTIFACT] migration SQL 含 `detected_aspect` 列定义
  Test: node -e "const fs=require('fs');const f=fs.readdirSync('apps/api/db/migrations').find(x=>/original_script/.test(x)||(/20260527/.test(x)&&x.endsWith('.sql')));const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');if(!c.includes('detected_aspect'))process.exit(1)"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] migration 使用 ADD COLUMN IF NOT EXISTS（幂等安全，可重复执行）+ 针对 ai_video_pipeline_jobs 表
  Test: manual:bash -c 'F=$(ls apps/api/db/migrations/ | grep -E "original_script|20260527" | grep ".sql$" | sort | tail -1); [ -n "$F" ] || { echo "FAIL: migration file not found"; exit 1; }; node -e "const c=require(\"fs\").readFileSync(\"apps/api/db/migrations/$F\",\"utf8\");if(!c.includes(\"ADD COLUMN IF NOT EXISTS\"))process.exit(1);if(!c.includes(\"ai_video_pipeline_jobs\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] target_aspect CHECK 约束限制 9:16 和 16:9 两值（字面量检查）
  Test: manual:bash -c 'F=$(ls apps/api/db/migrations/ | grep -E "original_script|20260527" | grep ".sql$" | sort | tail -1); node -e "const c=require(\"fs\").readFileSync(\"apps/api/db/migrations/$F\",\"utf8\");const ok=c.includes(\"9:16\")&&c.includes(\"16:9\");if(!ok){console.error(\"FAIL: target_aspect CHECK not found\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] PipelineJob TypeScript interface 含 original_script / target_aspect / detected_aspect 三字段
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/services/ai-video-pipeline.service.ts\",\"utf8\");[\"original_script\",\"target_aspect\",\"detected_aspect\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL: PipelineJob interface missing \"+f);process.exit(1)}});console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] createJob controller 从 req.body 读取 original_script + target_aspect（不只读 local_path/topic/template_id）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");if(!c.includes(\"original_script\"))process.exit(1);if(!c.includes(\"target_aspect\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] updateProgress controller 接受 detected_aspect 字段并转发给 service
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");if(!c.includes(\"detected_aspect\")){console.error(\"FAIL: updateProgress missing detected_aspect\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] original_script 已在 controller 实现 + 禁用字段名不出现（combined 正反向检查，防假绿）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");if(!c.includes(\"original_script\")){console.error(\"FAIL: WS1 前置检查 original_script 未实现\");process.exit(1)}[\"aspect_ratio:\",\"raw_script:\",\"source_script:\"].forEach(f=>{if(c.includes(f)){console.error(\"FAIL: 禁用字段 \"+f+\" 存在\");process.exit(1)}});console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] service updateStatus 方法支持写入 detected_aspect（updateStatus 参数类型含此字段）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/services/ai-video-pipeline.service.ts\",\"utf8\");if(!c.includes(\"detected_aspect\")){console.error(\"FAIL: updateStatus missing detected_aspect\");process.exit(1)}console.log(\"OK\")"'
  期望: OK
