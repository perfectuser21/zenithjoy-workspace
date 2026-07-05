# Bug PrepPRD：抖音搜索触发后有时跳回搜索首页，导致点不到视频

## 症状
Agent 在 `DouyinCollectService` 状态机里完成关键词输入后触发搜索，页面有时不停在搜索结果页，而是跳回搜索首页，导致后续找不到视频卡片点击。

## 根因假设（两个独立根因，均命中同一症状）

1. **`triggerSearch()` fallback 动作语义错误**（`DouyinCollectService.kt:190`）：找不到确认按钮时用 `ACTION_NEXT_AT_MOVEMENT_GRANULARITY`（按粒度移动光标）代替提交搜索，这不是"触发搜索"的正确动作，真正应该用 `ACTION_IME_ENTER`（API 30+，语义为确认 IME 的搜索/回车动作）。

2. **状态机竞态**（`handleTypingKeyword()`，`DouyinCollectService.kt:221-234`）：调用异步的 `typeKeyword(root)` 后，同一行**同步**把 `state` 切到 `WAITING_SEARCH_RESULTS`，但 `typeKeyword` 内部真正触发搜索要再等两段 delay（`SEARCH_MS` + `CLICK_MS`）才会执行到 `triggerSearch()`。在这个空窗期内，输入关键词后弹出的联想词/历史记录列表刷新事件会被误路由到 `handleSearchResults()`，其兜底逻辑"随便找第一个 clickable 的 ImageView"很可能命中联想词页面上的历史图标/清除按钮，被误当成"视频卡片"点击，从而跳到非预期页面。

## 关联上下文
- 相关 Journey：客户智能获客路径（Line 02，journey_id=afa6abca-53c0-4815-8594-b7fb81ca547f）
- 相关文件：services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt

## 修法
- `triggerSearch()`：fallback 分支改用 `input?.performAction(AccessibilityNodeInfo.ACTION_IME_ENTER)`
- 新增过渡态 `State.SUBMITTING_SEARCH`：`handleTypingKeyword()` 里改成 `state = State.SUBMITTING_SEARCH` 再调用 `typeKeyword(root)`（既防止重复触发，又不会被 `handleSearchResults()` 误处理，因为该状态没有对应 handler）；真正的 `state = State.WAITING_SEARCH_RESULTS` 移到 `triggerSearch()` 触发搜索**之后**才切
- `handleSearchResults()` 加固：记录进入 `WAITING_SEARCH_RESULTS` 的时间戳，收到结果事件时若距进入时间 < `RESULTS_SETTLE_MS`（如 500ms）防抖丢弃，避免刚触发搜索时的过渡态渲染被误判成"结果已出现"

## Regression Test 计划
该服务是 `AccessibilityService`，直接依赖 Android 框架的 `AccessibilityNodeInfo`/`AccessibilityEvent`，当前模块无 mockk/Robolectric（只有纯 JUnit）。计划：把状态转移判定逻辑（"是否应该切换到 SUBMITTING_SEARCH"、"是否应该因防抖丢弃结果事件"）抽成独立可测的纯函数/小类，对其写 JUnit failing test 覆盖竞态场景（模拟"typeKeyword 还未完成时收到内容变化事件"），修复后测试转绿，永久留在 CI。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）：fallback 动作语义修正 + 状态机竞态消除 + 结果页防抖加固
- [ ] CI 全绿
