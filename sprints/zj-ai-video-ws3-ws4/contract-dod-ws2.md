---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: E2E spec — W-G 模板 + 9:16 + detected_aspect 非空强断言

**范围**: `e2e/agent-video-pipeline.spec.js`：在 step 3 表单填写后加 W-G 模板选择 + 9:16 画幅按钮点击；step 5 后加严格 `detected_aspect` 非空断言（`expect(jobResp.detected_aspect).toMatch(/^(9:16|16:9)$/)` 替代允许 null 的松检查）
**大小**: M（~60 行净增，1 文件）
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 W-G 模板点击代码
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('W-G')){console.error('FAIL: 缺 W-G');process.exit(1)}console.log('ARTIFACT OK')"

- [ ] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 9:16 按钮点击代码
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('9:16')){console.error('FAIL: 缺 9:16');process.exit(1)}console.log('ARTIFACT OK')"

## BEHAVIOR 条目

### BEHAVIOR 1: spec 含 W-G 模板选择交互 — schema 字段值

- [ ] [BEHAVIOR] E2E spec 含点击 W-G 模板按钮的代码（click 或 locator + W-G）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");if(!c.includes(\"W-G\")){console.error(\"FAIL: 缺 W-G 模板选择\");process.exit(1);}const hasClick=c.includes(\"click\")&&c.includes(\"W-G\");if(!hasClick){console.error(\"FAIL: 未找到 W-G 点击交互\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 2: spec 含 9:16 画幅选择交互 — schema 完整性

- [ ] [BEHAVIOR] E2E spec 含 9:16 按钮点击（locator 或 click 含 '9:16'），且出现在 createJob 提交之前
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");if(!c.includes(\"9:16\")){console.error(\"FAIL: 缺 9:16 画幅选择\");process.exit(1);}const aspectIdx=c.indexOf(\"9:16\");const submitIdx=c.indexOf(\"开始处理\");if(aspectIdx>submitIdx){console.error(\"FAIL: 9:16 选择出现在提交之后\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 3: detected_aspect 强断言 — 禁用宽松 null 匹配

- [ ] [BEHAVIOR] E2E spec 对 `detected_aspect` 的断言不接受 null（不含 `null` 在合法值集中）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");const strictPattern=/toMatch\([^)]*9:16[^)]*16:9|toBe\([^)]*9:16|toBe\([^)]*16:9|toMatch.*\/(9:16|16:9)/;const hasStrict=strictPattern.test(c);if(!hasStrict){console.error(\"FAIL: detected_aspect 断言仍允许 null，需改为 toMatch(/^(9:16|16:9)$/)\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 4: spec 不含宽松 null 接受断言 — 禁用字段反向检查

- [ ] [BEHAVIOR] 新版 spec 不再含 `['9:16', '16:9', null].toContain(...)` 形式的允许 null 的断言
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");if(c.includes(\"16:9\\\", null\") || c.includes(\"null].toContain\") || (c.includes(\"null\") && c.includes(\"toContain\") && c.includes(\"detected_aspect\"))){console.error(\"FAIL: 仍含允许 null 的宽松断言\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

## BEHAVIOR:E2E 条目（windows_cloud Mode B — agent-e2e-video.yml Playwright）

- [ ] [BEHAVIOR:E2E] Playwright 在 windows-latest 全链路通过，detected_aspect 非空
  Test: 触发 `.github/workflows/agent-e2e-video.yml`（workflow_dispatch），Playwright 测试通过
  期望: GHA job exit 0，detected_aspect == "9:16" 或 "16:9"（非 null）
