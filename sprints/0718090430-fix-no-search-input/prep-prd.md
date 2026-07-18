# Bug PrepPRD：`/collect/start` 关键词采集进入搜索页后偶发 `NO_SEARCH_INPUT`

## 症状
安卓 Agent 执行 `/collect/start` 关键词采集任务时，点击进入抖音搜索页后，偶发抛出 `error_code=NO_SEARCH_INPUT`，采集任务直接失败终止（真机曾复现一次，未确认是否稳定复现）。

## 根因假设（systematic-debugging 深挖后修正版）

`DouyinCollectService.kt` 里 `typeKeyword()` 有**两条独立调用路径**：

1. **事件驱动路径**（`handleTypingKeyword()`，`onAccessibilityEvent` 在 `state==TYPING_KEYWORD` 时分发）：监听 `TYPE_WINDOW_STATE_CHANGED`，先用 `findFirstEditText` 确认输入框已渲染，再用 `shouldEnterSubmitting(state)` 判断仍处于 `TYPING_KEYWORD`，然后把 `state` 切到 `SUBMITTING_SEARCH` 再调用 `typeKeyword(root)`。**有状态守卫**。
2. **直调路径**（`openSearchBar()` 协程）：点击"搜索"入口后 `delay(CLICK_MS 800~1800ms)` + `awaitRootInActiveWindow(attempts=4, intervalMs=500ms)` 拿到 `postClickRoot`（拿不到时兜底退回**点击前的旧 root**——那份快照上必然没有搜索框），随后**无条件**调用 `typeKeyword(postClickRoot)`。**没有任何状态守卫**。

由于无障碍事件（路径1）通常在点击后几十~几百毫秒内就触发，而直调路径（路径2）至少要等 800ms+500ms=1.3s 以上才会执行，**事件驱动路径几乎总是先完成打字、把 state 推进到 SUBMITTING_SEARCH（甚至更后面）**。此时若直调路径的 `awaitRootInActiveWindow` 又恰好没能在 4 次轮询内拿到新 root（真机上会发生——机型/系统抖动），会退回点击前那份**保证没有搜索框**的旧 root，`typeKeyword` 用这份过期快照再次判空 → 触发 `finishWithError("NO_SEARCH_INPUT")`。

`finishWithError` 内的单飞闩 `resultReported` 此时仍是 `false`（任务还在正常推进中，没有终态），于是这次误判会真实地把一个本该成功的任务错杀，报出 `NO_SEARCH_INPUT`——这正是"偶发"的成因：只在 `awaitRootInActiveWindow` 超时兜底触发、且事件驱动路径已抢先接管的时间窗口内出现。

**与同文件既有模式对照（Phase 2 pattern match）**：`triggerSearch()` 早就用单飞闩 `mayStartStage1Work` 防止"两条路径都调用导致状态被错误重置"的同类问题（真机 ALL_SHARE_FAILED 根因，见文件内 e8597732 注释）。`openSearchBar()` 直调 `typeKeyword` 完全没有套用这个已验证有效的治法，是本 bug 的直接原因。

**与 PR #1363 的关系**：PR#1363（WakeLock + 提交前独立超时兜底）改的是"输入框已找到、提交搜索之前"那段，未触碰 `typeKeyword` 开头的判空分支，也未触碰两条调用路径的互斥问题，是独立根因，未覆盖本 bug。

## 关联上下文
- 相关 Journey：Path2 智能获客 · 关键词采集（`/collect/start`）
- 相关 PR：#1363（已合并，未覆盖本问题）
- 相关 handoff：`docs/handoffs/202607180830-android-full-day-4bugs-plus-orphan-pipeline-found.md`
- 相关 decision：564c60fb（初版假设，本 PrepPRD 为 systematic-debugging 深挖后的修正版，见下方"决策修订"）

## 修法
`openSearchBar()` 直调 `typeKeyword(postClickRoot)` 前，比照 `handleTypingKeyword()` 和 `triggerSearch()` 已验证的单飞闩模式：先用 `shouldEnterSubmitting(state)` 确认仍停在 `TYPING_KEYWORD`（说明事件驱动路径还没抢先处理），确认后把 `state` 切到 `SUBMITTING_SEARCH` 再调用；否则静默跳过，交给已经在推进的事件驱动路径处理。两条路径互斥，谁先到谁处理，避免用过期快照对一个已经在正常推进的任务二次判空。

## Regression Test 计划
本机无 Android SDK，无法跑需要真实 `AccessibilityService`/`AccessibilityNodeInfo` 的单测，沿用 `DouyinCollectServiceWakeLockTest` 的源码静态断言写法：
- failing test（commit-1）：正则断言 `openSearchBar()` 函数体内，`typeKeyword(` 调用点之前必须出现 `shouldEnterSubmitting(state)` 判断和 `state = State.SUBMITTING_SEARCH` 赋值——当前代码没有，测试先红。
- 修复（commit-2）：加上守卫后测试变绿。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] CI 全绿（含既有 `DouyinCollectServiceStateTest`/`DouyinCollectServiceWakeLockTest` 不受影响）
