---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: E2E spec 更新 + GHA version 更新

**范围**: e2e/agent-video-pipeline.spec.js 补充 original_script 填写 + W-G 模板 + 9:16 选择 + detected_aspect API 验证；.github/workflows/agent-e2e-video.yml default version → 1.1.29
**大小**: S（~70 行净增/修改，2 文件）
**依赖**: Workstream 2 完成后（E2E 验证 WS1+WS2 全链路功能）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 original_script 填写步骤
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('original_script'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 detected_aspect API 验证
  Test: node -e "const c=require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');if(!c.includes('detected_aspect'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `.github/workflows/agent-e2e-video.yml` agent_version default 值为 "1.1.29"
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/agent-e2e-video.yml','utf8');if(!c.includes('1.1.29'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] E2E spec 含 W-G 模板选择步骤（点击 W-G 或 WG 按钮相关代码）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");
      if (!c.includes(\"W-G\") && !c.includes(\"WG\") && !c.includes(\"W_G\")) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: E2E spec 缺 W-G 模板选择步骤"; exit 1; }
  '
  期望: OK

- [ ] [BEHAVIOR] E2E spec 含 original_script 文案填写动作（fill 或 type 调用）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");
      if (!c.includes(\"original_script\")) process.exit(1);
      // 确认有实际填写动作（fill/type/locator）
      const hasAction = c.includes(\"fill\") || c.includes(\"type\") || c.includes(\"locator\");
      if (!hasAction) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: E2E spec original_script 无填写动作"; exit 1; }
  '
  期望: OK

- [ ] [BEHAVIOR] E2E spec 含 detected_aspect API 验证（检查 apiResp.detected_aspect 有值）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");
      if (!c.includes(\"detected_aspect\")) process.exit(1);
      // 确认有非空验证（不只是 log 输出）
      const hasAssert = c.includes(\"detected_aspect\") && (c.includes(\"expect\") || c.includes(\"toBe\") || c.includes(\"!=\") || c.includes(\"!==null\") || c.includes(\"!= null\"));
      if (!hasAssert) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: E2E spec detected_aspect 无验证断言"; exit 1; }
  '
  期望: OK

- [ ] [BEHAVIOR] GHA workflow agent_version default 为 1.1.29（不是旧值 1.1.17）
  Test: manual:bash -c '
    COUNT=$(grep "default:" .github/workflows/agent-e2e-video.yml | grep "1.1.29" | wc -l | tr -d " ")
    [ "$COUNT" -ge 1 ] || { echo "FAIL: GHA workflow default version 未更新 expected=1.1.29"; exit 1; }
    OLD=$(grep "default:" .github/workflows/agent-e2e-video.yml | grep "1.1.17" | wc -l | tr -d " ")
    [ "$OLD" -eq 0 ] || { echo "FAIL: 旧版本 1.1.17 仍存在"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] E2E spec 截图步骤存在（page.screenshot 调用）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"e2e/agent-video-pipeline.spec.js\",\"utf8\");
      if (!c.includes(\"screenshot\")) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: E2E spec 缺截图步骤"; exit 1; }
  '
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] Agent E2E 全链路：填 original_script + 选 W-G + 选 9:16 → job 完成 → detected_aspect 有值
  Screenshots:
    - 03-form-filled.png    期望：original_script textarea 已填入文案，W-G 模板已选中，9:16 比例已选中
    - 04-submitted.png      期望：已点击"开始处理"，进度条可见
    - 05-final.png          期望：处理完成状态（处理完成 / 下载链接可见），detected_aspect 在控制台输出有值
  期望：所有截图与期望描述一致；agent-e2e-video.yml GHA run 绿灯
