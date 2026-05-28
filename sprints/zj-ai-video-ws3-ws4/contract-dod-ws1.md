---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: PATCH /progress 响应 → `{"ok": true}`

**范围**: `apps/api/src/controllers/ai-video-pipeline.controller.ts` 中 `updateProgress` 函数末尾从 `res.json(updated)` 改为 `res.json({ ok: true })`
**大小**: S（<20 行净增，1 文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `updateProgress` 函数最终响应改为 `res.json({ ok: true })`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline.controller.ts','utf8');const s=c.indexOf('async function updateProgress');const e=c.indexOf('\nasync function ',s+1);const fn=c.slice(s,e>s?e:s+2000);if(!fn.match(/res\.json\(\s*\{[\s\n]*ok\s*:\s*true[\s\n]*\}\s*\)/)){process.exit(1)}console.log('ARTIFACT OK')"

## BEHAVIOR 条目

### BEHAVIOR 1: updateProgress 源码返回 `{ok: true}` — schema 字段值

- [ ] [BEHAVIOR] `updateProgress` 函数体含 `res.json({ ok: true })`，不含 `res.json(updated)`
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");const s=c.indexOf(\"async function updateProgress\");const e=c.indexOf(\"\nasync function \",s+1);const fn=c.slice(s,e>s?e:s+2000);if(!fn.match(/res\\.json\\(\\s*\\{[\\s\\n]*ok\\s*:\\s*true[\\s\\n]*\\}\\s*\\)/)){console.error(\"FAIL: updateProgress 未返回 {ok:true}\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 2: PATCH 响应 keys 完整性 == `["ok"]`

- [ ] [BEHAVIOR] updateProgress 返回的 JSON keys 集合等于 `["ok"]`（不含 id/status 等 job 字段）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");const s=c.indexOf(\"async function updateProgress\");const e=c.indexOf(\"\nasync function \",s+1);const fn=c.slice(s,e>s?e:s+2000);const match=fn.match(/res\\.json\\(\\s*(\\{[^}]+\\})/);if(!match){process.exit(1);}const obj=match[1].replace(/\\s/g,\"\");if(obj!==\"{ok:true}\"){console.error(\"FAIL: 响应对象不是严格的 {ok:true}，当前:\"+obj);process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 3: 禁用字段反向检查 — aspectRatio/aspect/ratio/orientation 不出现在 PATCH 响应中

- [ ] [BEHAVIOR] `updateProgress` 函数不返回禁用字段名（aspectRatio / aspect / ratio / orientation）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");const s=c.indexOf(\"async function updateProgress\");const e=c.indexOf(\"\nasync function \",s+1);const fn=c.slice(s,e>s?e:s+2000);const banned=[\"aspectRatio\",\"\\\"aspect\\\"\",\"\\\"ratio\\\"\",\"\\\"orientation\\\"\"];const found=banned.filter(k=>fn.includes(k));if(found.length){console.error(\"FAIL: 禁用字段 \"+found+\" 出现在 updateProgress 响应\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 4: error path — job 不存在时返回 404 + error 字段（PATCH 应维持原有错误处理）

- [ ] [BEHAVIOR] `updateProgress` 函数在 job 不存在时仍返回 404 + `{ error: ... }`（原有 error path 未被破坏）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");const s=c.indexOf(\"async function updateProgress\");const e=c.indexOf(\"\nasync function \",s+1);const fn=c.slice(s,e>s?e:s+2000);if(!fn.includes(\"404\")||!fn.includes(\"error\")){console.error(\"FAIL: updateProgress 缺少 404 error path\");process.exit(1);}console.log(\"OK\");"'
  期望: OK
