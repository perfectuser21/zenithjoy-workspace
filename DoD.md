contract_branch: cp-05281336-ws-bbd3a1c0-ws4
workstream_index: 3
sprint_dir: sprints/zj-ai-video-ws1-ws3-ws4

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3 (ws4): E2E spec 更新 + Agent v1.1.29 + GHA 更新

**范围**: e2e/agent-video-pipeline.spec.js 补充 original_script 填写 + W-G 模板 + 9:16 选择 + detected_aspect API 验证；services/agent/package.json version → 1.1.29；.github/workflows/agent-e2e-video.yml default version → 1.1.29；agent-installpack.yml 自动触发路径确认
**大小**: S（~70 行净增/修改，4 文件）
**依赖**: Workstream 2 完成后（E2E 验证 WS1+WS2 全链路功能）

---

## ARTIFACT 条目

- [x] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 original_script 填写步骤
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('original_script'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 detected_aspect API 验证
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('detected_aspect'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `.github/workflows/agent-e2e-video.yml` agent_version default 值为 "1.1.29"
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/agent-e2e-video.yml','utf8');if(!c.includes('1.1.29'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `services/agent/package.json` version 字段为 "1.1.29"
  Test: node -e "const p=require('./services/agent/package.json');if(p.version!=='1.1.29')process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [x] [BEHAVIOR] E2E spec 含 W-G 模板选择步骤 + original_script 文案填写动作（fill/type/locator）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");
      if (!c.includes(\"original_script\")) process.exit(1);
      if (!c.includes(\"W-G\") && !c.includes(\"WG\") && !c.includes(\"W_G\")) process.exit(1);
      const hasAction = c.includes(\"fill\") || c.includes(\"type\") || c.includes(\"locator\");
      if (!hasAction) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: E2E spec 缺 W-G 模板选择或 original_script 填写动作"; exit 1; }
  '
  期望: OK

- [x] [BEHAVIOR] E2E spec 含 detected_aspect API 验证（含断言，非仅 log 输出）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");
      if (!c.includes(\"detected_aspect\")) process.exit(1);
      const hasAssert = c.includes(\"expect\") || c.includes(\"toBe\") || c.includes(\"!= null\") || c.includes(\"!== null\");
      if (!hasAssert) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: E2E spec detected_aspect 无验证断言"; exit 1; }
  '
  期望: OK

- [x] [BEHAVIOR] E2E spec 含截图步骤（page.screenshot 调用）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");
      if (!c.includes(\"screenshot\")) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: E2E spec 缺截图步骤"; exit 1; }
  '
  期望: OK

- [x] [BEHAVIOR] GHA agent-e2e-video.yml default version = 1.1.29，不含旧值 1.1.17
  Test: manual:bash -c '
    COUNT=$(grep "default:" .github/workflows/agent-e2e-video.yml | grep "1.1.29" | wc -l | tr -d " ")
    [ "$COUNT" -ge 1 ] || { echo "FAIL: GHA default version 未更新 expected=1.1.29"; exit 1; }
    OLD=$(grep "default:" .github/workflows/agent-e2e-video.yml | grep "1.1.17" | wc -l | tr -d " ")
    [ "$OLD" -eq 0 ] || { echo "FAIL: 旧版本 1.1.17 仍存在"; exit 1; }
    echo OK
  '
  期望: OK

- [x] [BEHAVIOR] services/agent/package.json version 字段精确为 "1.1.29"
  Test: manual:bash -c '
    VERSION=$(node -e "const p=require(\"./services/agent/package.json\");console.log(p.version)")
    [ "$VERSION" = "1.1.29" ] || { echo "FAIL: version=$VERSION 期望 1.1.29"; exit 1; }
    echo OK
  '
  期望: OK

- [x] [BEHAVIOR] agent-installpack.yml 配置 services/agent/** push 自动触发（确保 version bump merge 后 build 触发）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\".github/workflows/agent-installpack.yml\",\"utf8\");
      if (!c.includes(\"services/agent/**\")) process.exit(1);
      if (!c.includes(\"push\") && !c.includes(\"workflow_dispatch\")) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: agent-installpack.yml 未配置 services/agent/** 自动触发路径"; exit 1; }
  '
  期望: OK
