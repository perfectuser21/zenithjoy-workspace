# HANDOFF：安卓 DeviceAccountModel 接线已合并 + 全链路真机验证待续

> 交接时间：2026-07-06 13:5x 北京时间。新 session 直接从「立即要做的事」开始。

## 一句话现状

`DeviceAccountModel.kt` 的孤立工具类问题已彻底修完并合并（PR #1132，main 分支）。**下一步是把 Line02 抖音获客全链路在真机上真正跑一遍给用户看**，但手机 adb 连接刚好断了，需要用户配合一个物理操作才能继续，本 session 到此中断。

---

## 立即要做的事（新 session 第一件事）

手机（Honor 100，Tailscale IP `100.91.227.1`，hostname `honor-100-1`）的 adb 连接断了：
```bash
adb connect 100.91.227.1:5555
# → failed to connect: Connection refused
```
Tailscale 网络本身是通的（`tailscale ping 100.91.227.1` 有 pong），只是设备侧 adb 没监听 5555 端口了（大概率手机重启后无线调试状态复位，或者走的是 Android 11+ 无线调试配对模式、端口是动态的不一定是 5555）。

**需要用户配合**（上一轮已经问过，还没回复就要求写 handoff）：
1. 让用户看一下手机「设置 → 开发者选项 → 无线调试」是否还开着，如果开着把当前显示的 `IP:端口` 告诉你（不一定是 5555）；
2. 或者更简单：让用户拿数据线插一下电脑，跑 `adb tcpip 5555` 重新开无线调试模式，然后可以拔线。

拿到新端口后：
```bash
adb connect 100.91.227.1:<端口>
adb devices -l   # 确认设备出现
```

---

## 已完成：PR #1132（DeviceAccountModel 真实接线）

- **背景**：PR #1131 交付了 `DeviceAccountModel.kt`（9个纯判定函数：`dedupeSameDeviceAccounts`/`resolveDeviceConflict`/`shouldInvalidateOldDeviceRecord`/`shouldLogConflictAlert`/`filterAccountsByTenant`/`resolveScanReadResult`/`checkAccountOffline`/`evaluateDispatchAccountStatus`/`shouldSkipScanDueToMutex`），但全仓库零调用点。
- **本次做的**：新增 `DeviceAccountScanService`（无障碍服务，374行）+ `ScanMutex`（三服务共享全局互斥标记）+ `DeviceAccountRegistry`（扫描结果进程内存态注册表），把9个函数真正接进去；`AgentService` 新增30-60分钟随机间隔定时扫描 + dm_outreach 派发前一致性核对。
- **过程中 Evaluator+Judge 独立复核揪出并修复了两处真实阻塞缺陷**（不是走过场）：
  1. 派发前一致性核对最初传的 `account_label`（用户绑号时自己起的任意字符串）去查以真实抖音号 `douyinId` 为 key 的 Registry，命名空间对不上，核对形同虚设。**查清账号绑定链路（`apps/api/src/routes/agent-burner.ts` 的 `initiate-bind`）目前根本没有 `account_label ↔ douyinId` 映射**，无法做到"按账号精确核对"，诚实降级为"按设备维度近似判定"（本机本轮扫描到的账号全灭才触发 `TRIGGER_RESCAN_AND_FAIL`，否则 PROCEED）。**这是一个已知的架构债务，代码注释里标了后续升级路径**：如果未来账号绑定链路补上 douyinId 映射，`checkDispatchConsistency` 应该升级回账号级精确核对。
  2. `DeviceAccountScanService.startScan` 超时清理逻辑原本只覆盖 `withTimeoutOrNull` 返回 null（超时）分支，非超时异常（真机 UIA 常见的 `IllegalStateException`/`DeadObjectException`）会穿透导致 `ScanMutex.busy`/`state` 永久卡死、面板半开——已改用 try/catch/finally 兜底。
- **最终**：118 个单测全绿，CI 绿，`gh pr merge` 已合并，`git log -1` = `afee5d61` → merge commit 在 main。
- **遗留的已知风险（写进 PR，不是隐藏的）**：
  - `account_label → douyinId` 映射依然没打通，一致性核对目前只能做到设备级近似（多账号登录同一设备时，若只有目标账号下线、其他账号还在线，会误放行）。
  - `ScanMutex` 只是 `@Volatile Boolean`，check→set 非原子（TOCTOU），已在 sprint 07061204 contract-draft.md 风险登记 #4 里 scope-out，未来 sprint 待办。

## 上一 session 用户明确要求的下一步

用户对我列的四项遗留清单回复「你肯定是都跑通给我展示啊」——**意思是不是让你挑一项做，而是要把 Line02 智能获客全链路在真机上真正跑通一遍，实测给他看，不是写文档/讲道理**。具体指的是这条链：

```
抖音搜关键词 → 找视频 → 抓评论 → （人工/AI分析选出一个commenter）
→ locateProfileBySearch(按抖音号搜索定位主页) → performWarmup(关注+点赞热身)
→ DouyinDmOutreachService 发私信（留自己的企微/联系方式话术）
```

这条链此前**只在不同 session 里分段测过**（search+comment scrape 测过、DM发送测过两次成功发给真实陌生人、warmup 部分只是单测没有真机验证），**从来没有一次性端到端跑通给用户看过**。这是新 session 要做的核心任务。

## 新 session 建议的执行顺序

1. **先解决 adb 连接**（见上面「立即要做的事」）。
2. **确认设备上装的是最新版本 App**（含 78e9df28/e72b93c7/afee5d61 三个 commit 的代码）：
   ```bash
   export JAVA_HOME=$(/usr/libexec/java_home -v 17)
   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
   cd /Users/administrator/perfect21/zenithjoy/services/agent-android   # 用主仓库或新 worktree，别用本次已完成任务的旧 worktree
   git log --oneline -1   # 确认在 main 最新
   ./gradlew :app:assembleDebug
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```
   如果安装确认弹窗被系统反劫持保护挡住（`adb shell input tap` 在 `PackageInstallerActivity` 上无效），上一 session 已经把手机「监控ADB安装应用」开发者选项关掉了，理论上不会再弹这个确认框；如果又弹了，说明这个设置被重置了，需要用户手动点一下或者重新关掉。
3. **确认无障碍服务权限已授权**（`DouyinCollectService`/`DouyinDmOutreachService`/`DeviceAccountScanService` 三个都要在系统设置里手动开无障碍权限，新装的 App 通常需要重新勾选）：
   ```bash
   adb shell settings get secure enabled_accessibility_services
   ```
   确认三个服务的完整类名都在里面，缺了用 `adb shell am start -a android.settings.ACCESSIBILITY_SETTINGS` 打开设置页让用户手动勾（无障碍权限授权是 Android 系统级安全限制，adb 打不开这个开关，必须真人点一下）。
4. **端到端真跑一遍**，每一步都截图/uiautomator dump 留证据：
   - a. 触发一次关键词搜索采集任务（复用之前跑通过的 dispatch 方式，参考 memory `douyin_dm_outreach_spike.md` / 本 session 之前的 AgentService dispatch 调用方式），确认能搜到视频、抓到评论、CollectResult 广播上报正确。
   - b. 从抓到的评论里挑一个 commenter（可以用真实抖音号，参照上次用户已明确授权过的"随便选一个真实用户发送非敏感测试消息"的先例——**但这次涉及关注+点赞热身，属于新动作，如果要用真实陌生人账号做，需要再次跟用户确认是否继续沿用同样的授权范围，不要自己假设已经默认覆盖热身动作**）。
   - c. 跑 `locateProfileBySearch` 定位主页 → `performWarmup`（关注+点赞，注意 `isFollowRateLimited`/`isLikeRateLimited` 独立小时频控）→ 确认真机上关注/点赞按钮确实被点击且状态变化（截图为证）。
   - d. 跑 DM 发送，确认真送达（复用 `isInputCleared` 判定 + 人工看手机确认对方收到）。
   - e. 触发一次 `DeviceAccountScanService` 扫描，确认切换账号面板能被真实打开、账号列表能读出来、扫描完成后面板被正确关闭（不留半开状态）、`ScanMutex` 在整个过程中没有卡死其他两个服务。
5. **过程中如果任何一步真机上暴露出新 bug**（这在这个项目里几乎是常态，历史上几乎每次真机测试都会挖出单测覆盖不到的问题），**当场用 systematic-debugging 流程修**（先写失败测试，改代码，Evaluator+Judge 复核，走 PR），不要绕过。
6. **全部跑通后**，把结果（哪几步真的验证了、截图/日志证据在哪、还有哪些边界没覆盖）汇报给用户，不要只说"应该没问题"。

## 关键文件/路径速查

- 新服务：`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt`
- 搜索+采集：`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`
- 私信触达+热身：`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt`
- 任务分发：`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`
- 本次 sprint 文档：`sprints/07061204-android-device-account-model/`（prep-prd.md/sprint-prd.md/contract-draft.md/contract-dod.md/wiring-report.md）
- Gradle/Android 环境变量（每次新开 shell 都要重新 export）：
  ```bash
  export JAVA_HOME=$(/usr/libexec/java_home -v 17)
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
  ```

## 本次已完成 worktree 处理

`/Users/administrator/perfect21/zenithjoy/.claude/worktrees/cp-07061301-device-account-scan-wiring`（分支 `cp-07061301-device-account-scan-wiring`）已合并进 main，**新 session 不需要复用这个 worktree**，用主仓库或新开一个 worktree 继续真机验证工作即可；这个旧 worktree 可以按需清理（未主动清理，留着以防万一）。
