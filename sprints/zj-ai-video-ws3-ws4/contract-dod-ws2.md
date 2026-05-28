---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: E2E spec 适配 `{job:{...}}` + W-G + 9:16 + 非空强断言

**范围**: `e2e/agent-video-pipeline.spec.js`：
- step 3 后加 W-G 模板点击 + 9:16 画幅按钮点击（在"开始处理"前）
- `jobResp.detected_aspect` → `jobResp.job.detected_aspect`（适配 WS1 新 getJob 形状）
- `expect(['9:16', '16:9', null]).toContain(...)` → `expect(jobResp.job.detected_aspect).toMatch(/^(9:16|16:9)$/)`

**大小**: M（~65 行净增，1 文件）
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 W-G 模板点击代码
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('W-G')){console.error('FAIL: 缺 W-G');process.exit(1)}console.log('ARTIFACT OK')"

- [ ] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 9:16 按钮点击代码（在"开始处理"提交前）
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');const ai=c.indexOf('9:16');const si=c.indexOf('开始处理');if(ai<0||si<0||ai>=si){console.error('FAIL: 9:16 不在提交前');process.exit(1)}console.log('ARTIFACT OK')"

## BEHAVIOR 条目

### BEHAVIOR 1: spec 含 W-G 模板选择点击交互

- [ ] [BEHAVIOR] E2E spec 含点击 W-G 模板按钮的代码（click/locator/getByText 包含 'W-G'）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");if(!c.includes(\"W-G\")){console.error(\"FAIL: 缺 W-G 模板选择\");process.exit(1);}const wgIdx=c.indexOf(\"W-G\");const surrounding=c.slice(Math.max(0,wgIdx-200),wgIdx+200);if(!/click|locator|getByText/i.test(surrounding)){console.error(\"FAIL: W-G 附近无点击交互\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 2: spec 含 9:16 画幅按钮点击，且在提交前

- [ ] [BEHAVIOR] E2E spec 含 9:16 按钮点击，出现在 '开始处理' 提交按钮之前
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");if(!c.includes(\"9:16\")){console.error(\"FAIL: 缺 9:16 画幅选择\");process.exit(1);}const aspectIdx=c.indexOf(\"9:16\");const submitIdx=c.indexOf(\"开始处理\");if(aspectIdx>=submitIdx){console.error(\"FAIL: 9:16 选择出现在提交之后\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 3: detected_aspect 严格断言（不允许 null）

- [ ] [BEHAVIOR] E2E spec 对 `detected_aspect` 的断言使用 `toMatch(/^(9:16|16:9)$/)` 或 `toBe('9:16')`，不接受 null
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");const strictPattern=/toMatch\([^)]*9:16[^)]*16:9|toMatch.*\/(9:16\|16:9)|toBe\([^)]*9:16|toBe\([^)]*16:9/;if(!strictPattern.test(c)){console.error(\"FAIL: detected_aspect 断言仍允许 null，需改为 toMatch(/^(9:16|16:9)$/)\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 4: 禁用 null-accepting 宽松断言（反向检查）

- [ ] [BEHAVIOR] spec 不再含 `['9:16', '16:9', null].toContain` 形式的宽松 null 断言
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");if(c.includes(\"16:9, null\")||c.includes(\"16:9\\\", null\")||c.includes(\"null].toContain\")){console.error(\"FAIL: 仍含允许 null 的宽松断言\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 5: spec 通过 `.job.detected_aspect` 访问（适配 WS1 新 getJob 形状）

- [ ] [BEHAVIOR] E2E spec 使用 `jobResp.job.detected_aspect` 路径，而非 flat `jobResp.detected_aspect`
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");if(!/jobResp\.job\.detected_aspect/.test(c)){console.error(\"FAIL: spec 仍用 flat jobResp.detected_aspect，未适配新 getJob {job:{...}} 形状\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

## BEHAVIOR:E2E 条目（windows_cloud Mode B — agent-e2e-video.yml Playwright）

- [ ] [BEHAVIOR:E2E] Playwright 在 windows-latest 全链路通过，`jobResp.job.detected_aspect` 非空强断言通过
  Test: 触发 `.github/workflows/agent-e2e-video.yml`（workflow_dispatch，version=1.1.31），Playwright 测试通过
  期望: GHA job exit 0，detected_aspect toMatch(/^(9:16|16:9)$/)（非 null）
