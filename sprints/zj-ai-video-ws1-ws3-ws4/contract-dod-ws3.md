---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: E2E spec 更新 + Agent version 1.1.29 + GHA 更新

**范围**: e2e/agent-video-pipeline.spec.js 补充 original_script 填写 + W-G 模板 + 9:16 选择 + detected_aspect API 验证；services/agent/package.json version → 1.1.29；.github/workflows/agent-e2e-video.yml default version → 1.1.29；agent-installpack.yml 自动触发路径确认
**大小**: S（~70 行净增/修改，4 文件）
**依赖**: Workstream 2 完成后（E2E 验证 WS1+WS2 全链路功能）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 original_script 填写步骤
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('original_script'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 detected_aspect API 验证
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('detected_aspect'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `.github/workflows/agent-e2e-video.yml` agent_version default 值为 "1.1.29"
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/agent-e2e-video.yml','utf8');if(!c.includes('1.1.29'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `services/agent/package.json` version 字段为 "1.1.29"
  Test: node -e "const p=require('./services/agent/package.json');if(p.version!=='1.1.29')process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] E2E spec 含 W-G 模板选择步骤 + original_script 文案填写动作（fill/type/locator）
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

- [ ] [BEHAVIOR] E2E spec 含 detected_aspect API 验证（含断言，非仅 log 输出）
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

- [ ] [BEHAVIOR] E2E spec 含截图步骤（page.screenshot 调用）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");
      if (!c.includes(\"screenshot\")) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: E2E spec 缺截图步骤"; exit 1; }
  '
  期望: OK

- [ ] [BEHAVIOR] GHA agent-e2e-video.yml default version = 1.1.29，不含旧值 1.1.17
  Test: manual:bash -c '
    COUNT=$(grep "default:" .github/workflows/agent-e2e-video.yml | grep "1.1.29" | wc -l | tr -d " ")
    [ "$COUNT" -ge 1 ] || { echo "FAIL: GHA default version 未更新 expected=1.1.29"; exit 1; }
    OLD=$(grep "default:" .github/workflows/agent-e2e-video.yml | grep "1.1.17" | wc -l | tr -d " ")
    [ "$OLD" -eq 0 ] || { echo "FAIL: 旧版本 1.1.17 仍存在"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] services/agent/package.json version 字段精确为 "1.1.29"
  Test: manual:bash -c '
    VERSION=$(node -e "const p=require(\"./services/agent/package.json\");console.log(p.version)")
    [ "$VERSION" = "1.1.29" ] || { echo "FAIL: version=$VERSION 期望 1.1.29"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] agent-installpack.yml 配置 services/agent/** push 自动触发（确保 version bump merge 后 build 触发）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\".github/workflows/agent-installpack.yml\",\"utf8\");
      if (!c.includes(\"services/agent/**\")) process.exit(1);
      if (!c.includes(\"push\") && !c.includes(\"workflow_dispatch\")) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: agent-installpack.yml 未配置 services/agent/** 自动触发路径"; exit 1; }
  '
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] Agent E2E 全链路：填 original_script + 选 W-G + 选 9:16 → job 完成 → detected_aspect 有值
  Screenshots:
    - ws3-03-form-filled.png    期望：original_script textarea 已填入文案，W-G 模板已选中，9:16 比例已选中
    - ws3-04-submitted.png      期望：已点击"开始处理"，进度条可见
    - ws3-05-final.png          期望：处理完成状态（处理完成/下载链接可见），detected_aspect 在控制台输出有值
  期望：所有截图与期望描述一致；agent-e2e-video.yml GHA run 绿灯
