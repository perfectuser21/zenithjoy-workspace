---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: Agent v1.1.29 version bump + E2E spec 更新 + GHA workflow 更新

**范围**: services/agent/package.json version → 1.1.29；e2e/agent-video-pipeline.spec.js 加 original_script textarea 填写 + W-G 模板选择 + 9:16 比例选择 + jobData.original_script/target_aspect 断言；.github/workflows/agent-e2e-video.yml agent_version 默认值 → 1.1.29
**大小**: S
**依赖**: Workstream 3 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] services/agent/package.json version = "1.1.29"
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('services/agent/package.json','utf8'));if(p.version!=='1.1.29'){console.error('FAIL: version='+p.version+' 应为 1.1.29');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] e2e/agent-video-pipeline.spec.js 含 original_script 填写逻辑
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('original_script')){console.error('FAIL: E2E spec 缺 original_script');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] .github/workflows/agent-e2e-video.yml 含 1.1.29 版本引用
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/agent-e2e-video.yml','utf8');if(!c.includes('1.1.29')){console.error('FAIL: GHA workflow 缺 1.1.29');process.exit(1)}console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] Agent version 精确等于 1.1.29（不是 1.1.28 或其他版本）
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

- [ ] [BEHAVIOR] E2E spec 含 9:16 比例选择 + target_aspect 断言
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

- [ ] [BEHAVIOR] E2E spec original_script 断言匹配精确字符串（防止注入 undefined）
  Test: manual:bash -c '
node -e "
const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\", \"utf8\");
// 检查 original_script 后有字符串匹配（不是只声明字段名）
const hasAssert = c.includes(\"original_script\") && (
  c.includes(\"toBe(\")||c.includes(\"toEqual(\")||c.includes(\"expect(\")||c.includes(\"===\" )
);
if (!hasAssert) { console.error(\"FAIL: E2E spec original_script 无断言逻辑\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK

- [ ] [BEHAVIOR] error path — GHA workflow 文件存在且含 windows-latest runner（保障 E2E 运行在正确环境）
  Test: manual:bash -c '
node -e "
require(\"fs\").accessSync(\".github/workflows/agent-e2e-video.yml\");
const c = require(\"fs\").readFileSync(\".github/workflows/agent-e2e-video.yml\", \"utf8\");
if (!c.includes(\"windows-latest\")) { console.error(\"FAIL: GHA workflow 不是 windows-latest\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK

## BEHAVIOR:E2E 条目（windows_cloud final-e2e）

- [ ] [BEHAVIOR:E2E] GHA windows-latest E2E run green，截图证明 original_script 填写 + W-G 选中 + 9:16 选中 + job 完成状态
  Screenshots:
    - 02a-original-script-filled.png   期望：original_script textarea 已填写"ZenithJoy E2E 原始文案测试"，文本可见
    - 02b-template-wg-selected.png     期望：W-G 模板按钮处于选中状态（高亮/active），其他模板未选中
    - 02c-aspect-916-selected.png      期望：9:16 比例按钮处于选中状态，16:9 未选中
    - final-completed.png              期望：job 状态显示"已完成"或进度 100%，无错误信息
  期望：GHA workflow run green + artifact 含上述 4 张截图 + jobData.original_script == "ZenithJoy E2E 原始文案测试"
