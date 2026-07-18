# Handoff：`/collect/start` NO_SEARCH_INPUT 偶发误判已修（承接上一 session 的孤岛流水线调研）

- task_id: unknown（本次为交互式 /dev 路径 A，未走"有头模式"注册 Brain task，`.dev-mode` 无 `task_id` 字段，跳过 Brain DB 回写，仅写本 docs/handoffs 镜像）
- verdict: PASS
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1375（已合并，squash merge）

## 完成

承接上一 session 交接单（`docs/handoffs/202607180830-android-full-day-4bugs-plus-orphan-pipeline-found.md`）标注的下一步①：验证 `/collect/start` 采集链路的 `NO_SEARCH_INPUT` 是否为真实 bug。

1. 用 systematic-debugging 走完整四阶段（root cause → pattern match → hypothesis → TDD 实现），全程静态代码分析，未接触真机：
   - **根因**：`DouyinCollectService.kt` 的 `typeKeyword()` 有两条独立调用路径——事件驱动路径 `handleTypingKeyword()`（`TYPE_WINDOW_STATE_CHANGED` 触发，有 `shouldEnterSubmitting(state)` 状态守卫）和 `openSearchBar()` 协程的直调路径（点击搜索入口后 `delay`+`awaitRootInActiveWindow` 拿到 root 后**无条件**调用，完全没有状态守卫）。事件驱动路径通常几十~几百毫秒内就先完成打字、把 state 推进到 `SUBMITTING_SEARCH`；直调路径至少要等 1.3s+，若这期间 `awaitRootInActiveWindow` 没能在 4 次轮询内拿到新 root，会兜底退回点击前那份**必然没有搜索框**的旧 root，用它再次判空，对一个其实已经在正常推进的任务错误触发 `finishWithError("NO_SEARCH_INPUT")`——这就是"偶发"的成因。
   - **Phase 2 pattern match 关键证据**：同文件的 `triggerSearch()` 早就用单飞闩 `mayStartStage1Work` 解决过同类"两条路径都调用同一状态转换函数"的问题（真机 e8597732 ALL_SHARE_FAILED 根因），`openSearchBar()` 直调 `typeKeyword` 完全没套用这个已验证有效的治法，是本 bug 的直接原因。
   - PR#1363（WakeLock+提交超时兜底）改的是"输入框已找到、提交搜索之前"那段，未覆盖本问题，是独立根因，两者不冲突。
2. TDD 两次 commit：commit-1 写 failing test `DouyinCollectServiceSearchInputRaceTest`（源码静态断言，沿用 `DouyinCollectServiceWakeLockTest` 的写法——本机无 Android SDK 跑不了真实 AccessibilityService 单测），确认先红；commit-2 在 `openSearchBar()` 直调 `typeKeyword` 前加 `shouldEnterSubmitting(state)` 守卫+`state=SUBMITTING_SEARCH` 切换，确认变绿。
3. 本地跑全量单测 418 个，0 失败，确认无回归。
4. CI 全绿，auto-merge 生效，PR #1375 已合并。

## 没做 / 遗留

- **真机复现验证未做**：修复完全基于代码静态分析（两条调用路径的时序竞争 + 同文件已有的单飞闩模式佐证），没有拉真实设备复现"改前必现/改后不再发生"。原交接单要求的"重跑鱼香肉丝验证"这个动作本身没有执行——因为本次投入的是根因分析而非重复原有的真机复现步骤。建议下次有真机可用时，用同一关键词多跑几十次 `/collect/start`，确认 `NO_SEARCH_INPUT` 不再出现。
- **孤岛代码清理未做**：上一 session 标注的下一步②——`/keyword-search`（旧）与 `/collect/start`（新）两条采集流水线仍在并行跑，共享同一个 `DouyinCollectService` 单例/state机/WakeLock，仅靠 busy-guard（`state!=IDLE` 拒绝）先到先得，非真正互斥调度，纯耗电——本次完全没有touch，留给下一 sprint。

## 下一步

1. 有真机可用时，验证本次修复：多次真机运行 `/collect/start` 关键词采集，确认 `NO_SEARCH_INPUT` 不再偶发出现。
2. 承接孤岛代码清理：下线 `/keyword-search` 旧流水线（`AcquisitionKeywordPollLoop.kt` + `AgentService.kt:382-393 keywordPollLoop` + 服务端 `POST /keyword-search`/`GET /pending-keyword-tasks`），主流程已全部切到 `/collect/start`；旧接口目前仍挂在 `AcquisitionConfigPage.tsx` 的"设置"齿轮里，下线前确认没有客户还在用旧入口。走"先减肥再增肌"两段式 commit。

## 数据源

- 分支：`cp-0718090430-fix-no-search-input`（已合并，worktree 已清理）
- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1375
- 涉及文件：`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`（`openSearchBar()`）、新增测试 `DouyinCollectServiceSearchInputRaceTest.kt`
- Sprint PrepPRD：`sprints/0718090430-fix-no-search-input/prep-prd.md`

## 决策引用

- decision 564c60fb：初版根因假设（render-timing，写在 systematic-debugging 深挖之前，已被本次更精确的"双路径竞态"结论取代，仅存档）
- 上一 session 相关：`docs/handoffs/202607180830-android-full-day-4bugs-plus-orphan-pipeline-found.md`（本次承接的交接单）

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1375
- 涉及 commit：f57b8fe0（failing test）、bef6d3af（修复）
