# 设计：立即扫描按钮冷却自动解锁

## 背景
真人真机实测复现：`AcquisitionAccountsPage.tsx`（PR #1424）里 `scanOnCooldown = Date.now() < scanCooldownUntil` 是纯派生值，没有定时器强制重渲染。60秒冷却期满后，只要用户不做其它会触发 state 变化的操作，按钮 disabled 属性永久卡在 true，点击完全无响应。

## 方案
`handleTriggerScan` 成功分支设置 `scanCooldownUntil` 后，额外调用一次性 `setTimeout(() => setScanCooldownUntil(0), 60_000)`，60秒后强制触发一次重渲染，解除冷却。组件卸载时用 `useEffect` cleanup 清理该 timer（存进 ref），防止内存泄漏和"对已卸载组件调用setState"的 React warning。

## 测试策略
Playwright E2E（复用 PR #1424 的 `acquisition-account-scan-trigger.spec.ts`）：用 Playwright 内置 `page.clock` 快进 60 秒，断言按钮 disabled 属性变回 false 且可再次触发第二次请求。先在无修复的代码上跑一遍确认报红，再实现让它转绿。

## 不包含
- 不改服务端限流逻辑（60秒/租户的服务端 rate limit 保持不变，这里只修前端 UI 状态不同步的问题）
- 不改扫描本体/结果上报逻辑
