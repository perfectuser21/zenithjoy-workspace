---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: Dashboard UI + E2E Spec 更新

**范围**: `LocalVideoPipelinePage.tsx` 加 `original_script` textarea + 画幅选择器（9:16/16:9/自动检测）+ createJob 传两个新字段；`e2e/agent-video-pipeline.spec.js` 补 original_script 填写 + API 字段断言
**大小**: M（~130 行净增/改，2 文件）
**依赖**: Workstream 3 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `LocalVideoPipelinePage.tsx` 含 `original_script` 的 useState 声明
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');if(!c.includes('original_script'))process.exit(1)"

- [ ] [ARTIFACT] `LocalVideoPipelinePage.tsx` 含 `target_aspect` 相关 state 或 select 元素
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');if(!c.includes('target_aspect'))process.exit(1)"

- [ ] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 `original_script` 断言或填写
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('original_script'))process.exit(1)"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] createJob 函数（Dashboard axios.post）携带 original_script 字段到 API
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/LocalVideoPipelinePage.tsx\",\"utf8\");const axiosPost=c.match(/axios\.post[\s\S]{0,600}ai-video[\s\S]{0,600}local_path[\s\S]{0,800}/)?.[0]||\"\";if(!axiosPost.includes(\"original_script\")){console.error(\"FAIL: axios.post 未传 original_script\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] createJob 函数携带 target_aspect 字段到 API（画幅选择器的值）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/LocalVideoPipelinePage.tsx\",\"utf8\");const axiosPost=c.match(/axios\.post[\s\S]{0,600}ai-video[\s\S]{0,800}/)?.[0]||\"\";if(!axiosPost.includes(\"target_aspect\")){console.error(\"FAIL: axios.post 未传 target_aspect\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] UI 包含画幅选择器，选项含 "9:16" 和 "16:9"（用户可选）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/LocalVideoPipelinePage.tsx\",\"utf8\");if(!c.includes(\"9:16\")||!c.includes(\"16:9\")){console.error(\"FAIL: 画幅选项缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] E2E spec 验证 job API response 含 original_script 字段（hasOwnProperty 或 includes 或 !== undefined 检查）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");const hasCheck=c.includes(\"original_script\")&&(c.includes(\"hasOwnProperty\")||c.includes(\"!==undefined\")||c.includes(\"?.\")||c.includes(\"expect\"));if(!hasCheck){console.error(\"FAIL: E2E spec 未验证 original_script 字段\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] E2E spec 验证 detected_aspect 字段（ffprobe 结果）在 job response 中出现
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");if(!c.includes(\"detected_aspect\")){console.error(\"FAIL: E2E spec 未验证 detected_aspect\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段名不出现在 Dashboard createJob 调用（aspect_ratio / script / raw_script）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/LocalVideoPipelinePage.tsx\",\"utf8\");[\"aspect_ratio:\",\"raw_script:\",\"source_script:\"].forEach(f=>{if(c.includes(f)){console.error(\"FAIL: 禁用字段 \"+f);process.exit(1)}});console.log(\"OK\")"'
  期望: OK
