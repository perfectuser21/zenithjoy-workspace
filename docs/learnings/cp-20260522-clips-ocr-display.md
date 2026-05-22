## OCR 文字展示 + 图文采集稳定性修复（2026-05-22）

### 根本原因

1. **API 测试 mock 顺序与 controller 执行顺序不符**：controller 先调 `getSettings`，再调 `getExistingClip`，但测试 mock 顺序反了，导致重复提交测试拿到错误 HTTP 状态码。

2. **callback 控制器调用 `ocrImages()` 但测试未 mock**：`clips-extractor.service` mock 只覆盖了 `extractClip`，漏掉 `ocrImages`，导致图文 callback 测试收到 500（`TypeError: ocrImages is not a function`）。

3. **OCR_RELAY_URL 硬编码 IP**：`clips-extractor.service.ts` 原有 fallback `|| 'http://38.23.47.81:7789'`，DeepSeek Code Review 标 🔴，必须改为纯环境变量。

4. **E2E Golden Path 点击目标错误**：`FAKE_CLIP_DONE.title = '测试视频标题'`，列表渲染 `{clip.title || clip.url}`，UI 显示 title 而非 URL。测试用 `getByText(DOUYIN_URL)` 找不到元素，Playwright 等待 30 秒超时。

5. **smoke 脚本路径错误**：`lint-feature-has-smoke` 要求 `.github/workflows/scripts/smoke/*.sh`，初始放在 `scripts/smoke/` 下被 CI 拒绝。

6. **TDD commit 顺序**：`feat:` commit 早于 `test:` commit，`lint-tdd-commit-order` 失败，用 cherry-pick 重排后解决。

### 下次预防

- [ ] 写 API 测试前先 grep controller 方法，按真实调用顺序排 `mockResolvedValueOnce`
- [ ] mock 某 service 时，列出该 service 所有导出函数，全部 mock 一遍（即使暂时不用的 mock 返回 undefined/null）
- [ ] 环境变量绝不写 fallback 硬编码 IP；新 service 文件写完立即 grep `38.23.47.81`
- [ ] E2E fixture 的 `title` 字段非 null 时，列表点击目标必须用 title 文字，不能用 URL
- [ ] `feat:` PR 新增 smoke 脚本直接放 `.github/workflows/scripts/smoke/`，不要放其他路径
- [ ] TDD 顺序：test commit 先 push，impl commit 后 push；如果先写 impl 用 `git rebase -i` 或 cherry-pick 重排
