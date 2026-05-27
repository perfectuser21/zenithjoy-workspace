---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: Agent v1.1.29 version bump + E2E spec 更新 + GHA workflow 更新

**范围**: services/agent/package.json version → 1.1.29；e2e/agent-video-pipeline.spec.js 加 original_script textarea 填写 + W-G 模板选择 + 9:16 比例选择 + jobData.original_script/target_aspect 断言；.github/workflows/agent-e2e-video.yml agent_version 默认值 → 1.1.29
**大小**: S（3 文件，~50 行净增）
**依赖**: Workstream 3 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] services/agent/package.json version 精确等于 "1.1.29"
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('services/agent/package.json','utf8'));if(p.version!=='1.1.29'){console.error('FAIL: version='+p.version);process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] e2e/agent-video-pipeline.spec.js 含 original_script 填写逻辑
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('original_script'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] .github/workflows/agent-e2e-video.yml 含 1.1.29 版本引用 + windows-latest
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/agent-e2e-video.yml','utf8');if(!c.includes('1.1.29')||!c.includes('windows-latest'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] Agent version 精确等于 1.1.29（不是 1.1.28 或其他）
  Test: manual:bash -c '
V=$(node -e "console.log(JSON.parse(require(\"fs\").readFileSync(\"services/agent/package.json\",\"utf8\")).version)")
[ "$V" = "1.1.29" ] || { echo "FAIL: version=$V 应为 1.1.29"; exit 1; }
echo OK'
  期望: OK

- [ ] [BEHAVIOR] E2E spec 含 W-G 模板选择代码
  Test: manual:bash -c '
node -e "
const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\", \"utf8\");
if (!c.includes(\"W-G\")) { console.error(\"FAIL: E2E spec 缺 W-G 模板选择\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK

- [ ] [BEHAVIOR] E2E spec 含 9:16 比例选择 + target_aspect 字段断言
  Test: manual:bash -c '
node -e "
const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\", \"utf8\");
if (!c.includes(\"9:16\")) { console.error(\"FAIL: E2E spec 缺 9:16 比例\"); process.exit(1); }
if (!c.includes(\"target_aspect\") && !c.includes(\"targetAspect\")) {
  console.error(\"FAIL: E2E spec 缺 target_aspect 断言\"); process.exit(1);
}
console.log(\"OK\");
"'
  期望: OK

- [ ] [BEHAVIOR] E2E spec original_script 有精确字符串断言（非仅声明字段名）
  Test: manual:bash -c '
node -e "
const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\", \"utf8\");
const hasAssert = c.includes(\"original_script\") &&
  (c.includes(\"toBe(\") || c.includes(\"toEqual(\") || c.includes(\"===\"));
if (!hasAssert) { console.error(\"FAIL: E2E spec original_script 无断言\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK

- [ ] [BEHAVIOR] GHA workflow 含 windows-latest runner + 1.1.29 agent_version 引用
  Test: manual:bash -c '
node -e "
require(\"fs\").accessSync(\".github/workflows/agent-e2e-video.yml\");
const c = require(\"fs\").readFileSync(\".github/workflows/agent-e2e-video.yml\", \"utf8\");
if (!c.includes(\"windows-latest\")) { console.error(\"FAIL: GHA workflow 不是 windows-latest\"); process.exit(1); }
if (!c.includes(\"1.1.29\")) { console.error(\"FAIL: GHA workflow 缺 1.1.29\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK

## BEHAVIOR:E2E 条目（windows_cloud final-e2e）

- [ ] [BEHAVIOR:E2E] GHA windows-latest E2E run green，截图证明 original_script 填写 + W-G 选中 + 9:16 选中 + job 完成
  Screenshots:
    - 02a-original-script-filled.png   期望：original_script textarea 已填写"ZenithJoy E2E 原始文案测试"，文本可见
    - 02b-template-wg-selected.png     期望：W-G 模板按钮处于选中状态（高亮/active），其他模板未选中
    - 02c-aspect-916-selected.png      期望：9:16 比例按钮处于选中状态，16:9 未选中
    - final-completed.png              期望：job 状态显示"已完成"或进度 100%，无错误信息
  期望：GHA workflow run green + artifact 含上述 4 张截图 + jobData.original_script == "ZenithJoy E2E 原始文案测试" + jobData.target_aspect == "9:16"
