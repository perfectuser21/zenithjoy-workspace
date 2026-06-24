# Bug PrepPRD：windows Playwright job "No tests found" + 加截图 artifact

## 症状
PR #844 接的 `e2e-line04-cs-stats.yml` windows job2 跑了但失败：`Error: No tests found` —— Playwright 没匹配到 cs-work-stats.spec.ts / cs-daily-report.spec.ts，等于配了没真跑。

## 根因
`e2e-ui-verify.ps1` 的 playwright 调用用了**反斜杠**路径 `e2e\cs-work-stats.spec.ts e2e\cs-daily-report.spec.ts`。windows 上 Playwright 的 positional path-filter 不认反斜杠 → 匹配不到任何 spec → "No tests found"。
对照绿的 `cs-config-permission.ps1`（`e2e/cs-config-permission.spec.ts`）和 `agent-e2e-video.yml`（`e2e/agent-video-pipeline.spec.js`）都用**正斜杠**。

## 修法
1. ps1 playwright 路径改正斜杠 `e2e/cs-work-stats.spec.ts e2e/cs-daily-report.spec.ts`。
2. spec 截图改写到 `apps/dashboard/screenshots/cs-work-stats|cs-daily-report/`（Playwright cwd 相对路径）。
3. workflow 加 `actions/upload-artifact@v4`（`if: always()`，name=cs-stats-ui-screenshots，path=apps/dashboard/screenshots/）→ 老板能下载看页面真渲染样子。
4. .gitignore 忽略 screenshots/ test-results/ playwright-report/（CI 产物不入 git）。

## 本地真执行验证（已通过，正斜杠）
- build dashboard(VITE_SKIP_AUTH=true) → vite preview :5174 → `playwright test e2e/cs-work-stats.spec.ts e2e/cs-daily-report.spec.ts`（**正斜杠**）→ **3 passed**。
- 4 张截图真写出（122-142KB），肉眼确认 01-today.png 正确渲染「客服工作汇总」页：小齐(真发)12/9/5/180 + 小白(演练)3/2/2/30 + 今天/昨天切换 + 私域客服侧栏。

## 验收标准
- [ ] CI `E2E Line04 CS Stats` windows job2 真绿（2 spec 真执行 pass，不再 No tests found）
- [ ] artifact `cs-stats-ui-screenshots` 出来、含 4 张页面截图
- [ ] required 全绿后合并
