# Bug PrepPRD：立即扫描按钮 60 秒冷却后不会自动解锁

## 症状
真人真机测试实测复现：用户在「智能获客→绑抖音小号」页点"立即扫描"，按钮变灰+出现"已发送，最长等待约30秒"提示。等待超过60秒后再点按钮——完全没反应，浏览器控制台确认点击事件根本没触发（原生 `disabled` 属性仍为 true）。

## 根因假设
`apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`（PR #1424 引入）：
```tsx
const scanOnCooldown = Date.now() < scanCooldownUntil;
```
这是纯派生值，只在组件重渲染时被重新求值。`scanCooldownUntil` 在成功触发后被设为 `Date.now()+60000`，但代码里没有任何定时器（`setTimeout`/`setInterval`）在 60 秒后主动触发一次重渲染——如果用户在这之后不做任何其它会引起 state 变化的操作（这个页面本身很静态），`scanOnCooldown` 的值永远停留在"上次渲染时"计算出的 `true`，按钮 `disabled` 属性因此永久卡在 `true`，原生 HTML button 不会响应点击。

final review 时已经发现并讨论过这个问题，判定为"Minor，会被其它 state 变化自愈"，但真人实测证明这个假设不成立——这个页面没有其它会触发重渲染的交互，用户被真实卡住。

## 关联上下文
- 相关 Journey：客户智能获客路径（afa6abca-53c0-4815-8594-b7fb81ca547f），Path2 Step 7
- 相关 PR：#1424（引入该 bug）
- 相关文件：`apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`

## 修法
在 `handleTriggerScan` 成功分支设置 `scanCooldownUntil` 之后，额外 `setTimeout(() => setScanCooldownUntil(0), 60_000)` 强制在 60 秒后触发一次重渲染（不用 `setInterval` 轮询，一次性定时器足够，逻辑更简单）。需要在组件卸载时清理 timer（`useEffect` cleanup 或 ref 记录 timer id），防止内存泄漏/对已卸载组件调用 setState 的 warning。

## Regression Test 计划
Playwright E2E（复用 PR #1424 已建的真浏览器测试文件 `apps/dashboard/e2e/acquisition-account-scan-trigger.spec.ts`，新增一个用例）：用 `page.clock`（Playwright 内置时钟 mock）快进 60 秒，断言按钮的 `disabled` 属性变回 `false`，且能再次成功点击触发第二次请求（mock 第二次 `page.route` 响应，断言真的发出了第二次 POST）。

> proven-to-fire：先跑这条新测试在当前（有 bug 的）代码上，确认报红（60秒后按钮仍是 disabled）；加 setTimeout 后重跑转绿。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 已为本 bug 配 proven-to-fire 守卫（亲眼看它报红过一次）
- [ ] CI 全绿
