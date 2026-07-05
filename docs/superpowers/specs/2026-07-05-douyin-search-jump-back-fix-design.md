# 设计：修复抖音搜索触发后跳回搜索首页

日期：2026-07-05
关联文件：`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`
关联决策：Brain decision `e11c7155-3250-4331-b237-b00896ac5502`
关联 Journey：客户智能获客路径（Line 02，`afa6abca-53c0-4815-8594-b7fb81ca547f`）

## 背景

`DouyinCollectService` 是一个 Android AccessibilityService 状态机，驱动"搜索关键词 → 点第一条视频 → 进评论区 → 抓留言人"的采集流程。真机反馈：触发搜索后有时不停在结果页，而是跳回搜索首页，导致后续步骤找不到视频卡片。

## 根因（两个独立缺陷，均可导致该症状）

1. `triggerSearch()`（第 207-221 行）：找不到搜索确认按钮时，fallback 分支执行 `ACTION_NEXT_AT_MOVEMENT_GRANULARITY`——这是"按粒度移动光标"的动作，语义上根本不是提交搜索。正确动作应为 `ACTION_IME_ENTER`（API 30+，专门用于确认 IME 的搜索/回车动作）。

2. `handleTypingKeyword()`（第 248-261 行）：调用异步的 `typeKeyword(root)` 后，**同一行同步**把 `state` 切到 `WAITING_SEARCH_RESULTS`。但 `typeKeyword` 内部真正触发搜索要再经过两段 `delay`（`SEARCH_MS` + `CLICK_MS`）才会跑到 `triggerSearch()`。在这个空窗期内，输入关键词后联想词/历史记录列表的刷新事件会被误路由到 `handleSearchResults()`；其兜底逻辑（找第一个尺寸够大的可点击节点）虽然已经改成按卡片尺寸判断（`ec858fea`），但仍有可能命中该过渡页面上的大尺寸可点击元素（如联想词横幅），造成误点击、跳到非预期页面。

## 修法

### 修法 1：fallback 动作语义修正
```kotlin
input?.performAction(AccessibilityNodeInfo.ACTION_IME_ENTER)
```
替换原来的 `ACTION_NEXT_AT_MOVEMENT_GRANULARITY`。

### 修法 2：消除状态机竞态
新增过渡态 `State.SUBMITTING_SEARCH`（介于 `TYPING_KEYWORD` 和 `WAITING_SEARCH_RESULTS` 之间）：
- `handleTypingKeyword()` 里把 `state = State.WAITING_SEARCH_RESULTS` 改成 `state = State.SUBMITTING_SEARCH`（`onAccessibilityEvent` 分发表里该状态无对应 handler，天然不会被误处理，同时依然阻止 `typeKeyword` 被重复调用）
- 真正的 `state = State.WAITING_SEARCH_RESULTS` 从 `handleTypingKeyword` 移到 `triggerSearch()` 内部（搜索动作真正发出之后）

### 修法 3：结果页防抖加固
`triggerSearch()` 切到 `WAITING_SEARCH_RESULTS` 时记录时间戳 `searchTriggeredAtMs = SystemClock.elapsedRealtime()`；`handleSearchResults()` 收到事件时若 `elapsedRealtime() - searchTriggeredAtMs < RESULTS_SETTLE_MS`（400ms）则直接丢弃，防止触发搜索后的过渡态渲染被误判为"结果已出现"。

## 可测试性

`DouyinCollectService` 直接依赖 Android 框架类型（`AccessibilityNodeInfo`/`AccessibilityEvent`），本模块无 mockk/Robolectric，无法脱离真机对完整 handler 做单元测试。

处理方式：把两条新增的纯判定逻辑抽成 `internal` 的无 Android 依赖纯函数，放在同文件内，供 JUnit 直接测试：
- `shouldEnterSubmitting(currentState: State): Boolean`（辅助验证状态转移前置条件，行为等价于原 `if` 判断，仅为可测试化抽出）
- `isResultEventDebounced(triggeredAtMs: Long, nowMs: Long, settleMs: Long): Boolean`

这两个函数不依赖 Android 类型，可直接用 JUnit 覆盖，不需要引入新测试框架。

## 测试计划

新增 `DouyinCollectServiceStateTest.kt`（纯 JUnit，无需 Robolectric）：
- `isResultEventDebounced`：settle 窗口内返回 true（丢弃），窗口外返回 false（放行）——覆盖竞态场景的核心判定
- `shouldEnterSubmitting`：仅 `TYPING_KEYWORD` 状态允许进入 `SUBMITTING_SEARCH`，其余状态不允许（防止重复触发）

先写这两组 failing test（对应新状态/新函数尚不存在，编译失败或断言失败），commit-1；再实现修法 1-3 让测试转绿，commit-2。

## 影响范围

仅 `DouyinCollectService.kt` 单文件改动，新增一个 enum 值和两个纯函数，不改变现有对外广播接口（`ACTION_COLLECT_RESULT` 等），不影响评论提取（`NodeExtractor`）等下游逻辑。

## 验收标准

- [ ] `DouyinCollectServiceStateTest` 两组 test 先以 failing 状态 commit
- [ ] 三处修法实现后测试转绿
- [ ] CI（`services/agent-android` 相关 job）全绿
