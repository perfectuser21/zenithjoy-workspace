---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: PATCH {ok:true} + GET {job:{...}} 响应格式修正 + pollStatus 适配

**范围**:
- `apps/api/src/controllers/ai-video-pipeline.controller.ts`：updateProgress → `{ok:true}` + getJob → `{job:{id,status,progress,detected_aspect}}`
- `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx`：pollStatus 适配 → `res.data.job` 路径

**大小**: S（≤35 行净增，2 文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `updateProgress` 函数最终响应改为 `res.json({ ok: true })`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline.controller.ts','utf8');const s=c.indexOf('async function updateProgress');const e=c.indexOf('\nasync function ',s+1);const fn=c.slice(s,e>s?e:s+2000);if(!fn.match(/res\.json\(\s*\{[\s\n]*ok\s*:\s*true[\s\n]*\}\s*\)/)){process.exit(1)}console.log('ARTIFACT OK')"

- [ ] [ARTIFACT] `getJob` 函数返回 `res.json({ job: { ... } })` 包装（非 flat spread）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline.controller.ts','utf8');const s=c.indexOf('async function getJob');const e=c.indexOf('\nasync function ',s+1);const fn=c.slice(s,e>s?e:s+500);if(!fn.match(/res\.json\(\s*\{[\s\S]*?job\s*:/)){process.exit(1)}console.log('ARTIFACT OK')"

- [ ] [ARTIFACT] `LocalVideoPipelinePage.tsx` 的 `pollStatus` 通过 `res.data.job` 访问（非 flat spread）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');const s=c.indexOf('async function pollStatus');const e=c.indexOf('\nasync function',s+1);const fn=c.slice(s,e>s?e:s+300);if(!fn.match(/res\.data\.job/)){process.exit(1)}console.log('ARTIFACT OK')"

## BEHAVIOR 条目

### BEHAVIOR 1: updateProgress 返回 `{ok: true}` — PRD PATCH Schema 字段值

- [ ] [BEHAVIOR] `updateProgress` 函数体含 `res.json({ ok: true })`，不含 `res.json(updated)`
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");const s=c.indexOf(\"async function updateProgress\");const e=c.indexOf(\"\nasync function \",s+1);const fn=c.slice(s,e>s?e:s+2000);if(!fn.match(/res\\.json\\(\\s*\\{\\s*ok\\s*:\\s*true\\s*\\}\\s*\\)/)){console.error(\"FAIL: updateProgress 未返回 {ok:true}，当前为 res.json(updated)\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 2: PATCH 响应 keys 完整性 == `["ok"]`

- [ ] [BEHAVIOR] updateProgress 返回的 JSON keys 集合等于 `["ok"]`（不含 id/status 等 job 字段）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");const s=c.indexOf(\"async function updateProgress\");const e=c.indexOf(\"\nasync function \",s+1);const fn=c.slice(s,e>s?e:s+2000);const match=fn.match(/res\\.json\\(\\s*(\\{[^}]+\\})/);if(!match){console.error(\"FAIL: 找不到 res.json 字面对象\");process.exit(1);}const obj=match[1].replace(/\\s/g,\"\");if(obj!==\"{ok:true}\"){console.error(\"FAIL: 响应对象不是严格的 {ok:true}，当前:\"+obj);process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 3: PATCH 禁用字段反向检查

- [ ] [BEHAVIOR] `updateProgress` 不返回禁用字段名（aspectRatio / aspect: / ratio: / orientation:）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");const s=c.indexOf(\"async function updateProgress\");const e=c.indexOf(\"\nasync function \",s+1);const fn=c.slice(s,e>s?e:s+2000);const banned=[\"aspectRatio\",\"\\\"aspect\\\"\",\"\\\"ratio\\\"\",\"\\\"orientation\\\"\"];const found=banned.filter(k=>fn.includes(k));if(found.length){console.error(\"FAIL: 禁用字段 \"+found+\" 出现在 updateProgress 响应\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 4: PATCH error path — 404 未被破坏

- [ ] [BEHAVIOR] `updateProgress` 仍含 job 不存在时的 404 + error 字段处理
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");const s=c.indexOf(\"async function updateProgress\");const e=c.indexOf(\"\nasync function \",s+1);const fn=c.slice(s,e>s?e:s+2000);if(!fn.includes(\"404\")||!fn.includes(\"error\")){console.error(\"FAIL: updateProgress 缺少 404 error path\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 5: GET 返回 {job:{...}} 包装（PRD GET Schema 字段 — 不是 flat spread）

- [ ] [BEHAVIOR] `getJob` 函数返回 `res.json({ job: {...} })` 包装，不含 spread operator `...job`
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");const s=c.indexOf(\"async function getJob\");const e=c.indexOf(\"\nasync function \",s+1);const fn=c.slice(s,e>s?e:s+500);if(!fn.match(/res\\.json\\(\\s*\\{\\s*job\\s*:/)){console.error(\"FAIL: getJob 未用 {job:{...}} 包装\");process.exit(1);}if(fn.match(/\\.\\.\\.(job|updated)/)){console.error(\"FAIL: getJob 含 spread operator\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 6: GET .job 块含 detected_aspect key（snake_case，符合 PRD GET Schema）

- [ ] [BEHAVIOR] `getJob` 的 `.job` 块显式含 `detected_aspect:` key（snake_case，禁用 detectedAspect camelCase）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline.controller.ts\",\"utf8\");const s=c.indexOf(\"async function getJob\");const e=c.indexOf(\"\nasync function \",s+1);const fn=c.slice(s,e>s?e:s+500);if(!fn.match(/job\\s*:\\s*\\{[\\s\\S]*?detected_aspect/)){console.error(\"FAIL: getJob .job 块未含 detected_aspect key\");process.exit(1);}if(fn.match(/detectedAspect\\s*:/)){console.error(\"FAIL: getJob 含禁用 camelCase key detectedAspect\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 7: pollStatus 适配 {job:{...}} 格式（Risk 1 Mitigation）

- [ ] [BEHAVIOR] `LocalVideoPipelinePage.tsx` 的 `pollStatus` 函数通过 `res.data.job` 访问新格式（不用 flat `res.data` spread）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/LocalVideoPipelinePage.tsx\",\"utf8\");const s=c.indexOf(\"async function pollStatus\");const e=c.indexOf(\"\nasync function\",s+1);const fn=c.slice(s,e>s?e:s+300);if(!fn.match(/res\\.data\\.job/)){console.error(\"FAIL: pollStatus 仍用 flat res.data spread，未适配 {job:{...}} 格式\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

## BEHAVIOR:E2E 条目（windows_cloud Mode B — agent-e2e-video.yml Playwright）

- [ ] [BEHAVIOR:E2E] Playwright 在 windows-latest 全链路通过，`jobResp.job.detected_aspect` 非空强断言通过，`pollStatus` 轮询正常终止
  Test: 触发 `.github/workflows/agent-e2e-video.yml`（workflow_dispatch，version=1.1.31），Playwright 测试通过
  期望: GHA job exit 0，detected_aspect toMatch(/^(9:16|16:9)$/)（非 null），进度轮询正常停止
