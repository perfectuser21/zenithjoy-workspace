---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: Dashboard UI + E2E Spec 更新

**范围**: `LocalVideoPipelinePage.tsx` 加 `original_script` textarea + 画幅选择器（9:16/16:9/自动检测）+ createJob 传两个新字段；`e2e/agent-video-pipeline.spec.js` 补 original_script 填写 + API 字段断言
**大小**: M（~130 行净增/改，2 文件）
**依赖**: Workstream 2 和 Workstream 3 完成后

> **WS4 BEHAVIOR oracle 说明**:
> Dashboard 前端（TSX 组件）无独立 HTTP 端点可测；UI 字段存在性验证通过源码检查。
> E2E spec 内容验证通过 grep/源码断言；Playwright 真实浏览器验收在 Final E2E windows_cloud 完成。

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `LocalVideoPipelinePage.tsx` 含 `original_script` 的 useState 声明
  Test: bash -c 'grep -q "original_script" apps/dashboard/src/pages/LocalVideoPipelinePage.tsx && echo OK || { echo FAIL; exit 1; }'

- [ ] [ARTIFACT] `LocalVideoPipelinePage.tsx` 含 `target_aspect` 相关 state 或 select 元素
  Test: bash -c 'grep -q "target_aspect" apps/dashboard/src/pages/LocalVideoPipelinePage.tsx && echo OK || { echo FAIL; exit 1; }'

- [ ] [ARTIFACT] `e2e/agent-video-pipeline.spec.js` 含 `original_script` 断言或填写
  Test: bash -c 'grep -q "original_script" e2e/agent-video-pipeline.spec.js && echo OK || { echo FAIL; exit 1; }'

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] createJob 函数（Dashboard axios.post）携带 original_script 字段到 API
  Test: manual:bash -c 'F="apps/dashboard/src/pages/LocalVideoPipelinePage.tsx"; POST_BLOCK=$(grep -A 20 "axios\.post" "$F" | head -30); echo "$POST_BLOCK" | grep -q "original_script" || { echo "FAIL: axios.post 未传 original_script"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] createJob 函数携带 target_aspect 字段到 API（画幅选择器的值）
  Test: manual:bash -c 'F="apps/dashboard/src/pages/LocalVideoPipelinePage.tsx"; POST_BLOCK=$(grep -A 20 "axios\.post" "$F" | head -30); echo "$POST_BLOCK" | grep -q "target_aspect" || { echo "FAIL: axios.post 未传 target_aspect"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] UI 包含画幅选择器，选项含 "9:16" 和 "16:9"（用户可选）
  Test: manual:bash -c 'F="apps/dashboard/src/pages/LocalVideoPipelinePage.tsx"; grep -q "9:16" "$F" || { echo "FAIL: 缺画幅选项 9:16"; exit 1; }; grep -q "16:9" "$F" || { echo "FAIL: 缺画幅选项 16:9"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] E2E spec 验证 job API response 含 original_script 字段（hasOwnProperty 或 includes 或 !== undefined 检查）
  Test: manual:bash -c 'F="e2e/agent-video-pipeline.spec.js"; grep -q "original_script" "$F" || { echo "FAIL: E2E spec 缺 original_script 验证"; exit 1; }; (grep -qE "hasOwnProperty|!== undefined|\\.original_script" "$F") || { echo "FAIL: E2E spec 未做 original_script 存在性断言"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] E2E spec 验证 detected_aspect 字段（ffprobe 结果）在 job response 中出现
  Test: manual:bash -c 'grep -q "detected_aspect" e2e/agent-video-pipeline.spec.js || { echo "FAIL: E2E spec 未验证 detected_aspect"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段名不出现在 Dashboard createJob 调用（aspect_ratio / raw_script / source_script 不作为 key 传入）
  Test: manual:bash -c 'F="apps/dashboard/src/pages/LocalVideoPipelinePage.tsx"; for banned in "aspect_ratio:" "raw_script:" "source_script:"; do grep -q "$banned" "$F" && { echo "FAIL: 禁用字段 $banned 存在于 Dashboard"; exit 1; } || true; done; echo OK'
  期望: OK
