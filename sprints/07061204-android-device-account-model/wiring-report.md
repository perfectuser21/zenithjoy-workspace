# DeviceAccountModel 真实接线报告（Sprint 07061301-device-account-scan-wiring）

## 背景

PR #1131 交付了 `DeviceAccountModel.kt`（9 个纯判定函数），但全仓库零调用点——没有真实
的"打开抖音切换账号界面读取账号列表"无障碍服务代码，`AgentService.kt` 也没有触发账号扫描
的逻辑。本 sprint 用 TDD 补齐这条真实执行路径。

## 改动文件清单

### 新增

- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/ScanMutex.kt`
  三服务（账号扫描/采集/触达）共享的全局互斥标记（`@Volatile var busy: Boolean`）。
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountRegistry.kt`
  进程内存态"最近一次扫描结果"注册表，供扫描间的冲突判定输入 + 派发前一致性核对使用。
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt`
  真实的账号扫描无障碍服务：状态机 + BroadcastReceiver 任务触发 + 打开/读取/关闭"切换账号"
  面板 + 全流程超时兜底强制退出 + 结果广播上报。companion object 内的纯函数
  （`shouldRunScan`/`resolveAccountsToPersist`/`buildScanDecisions`/`applyOfflineDetection`/
  `checkDispatchConsistency`）真实调用 `DeviceAccountModel` 的 7 个函数
  （`shouldSkipScanDueToMutex`/`resolveScanReadResult`/`dedupeSameDeviceAccounts`/
  `filterAccountsByTenant`/`resolveDeviceConflict`/`shouldInvalidateOldDeviceRecord`/
  `shouldLogConflictAlert`），另外还接线了 `checkAccountOffline`（Step 6）与
  `evaluateDispatchAccountStatus`（Step 7），9 个纯函数全部有真实调用点。
- `services/agent-android/app/src/main/res/xml/douyin_account_scan_config.xml`
  新无障碍服务的配置资源（参照 `douyin_dm_outreach_config.xml` 写法）。
- `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/account/DeviceAccountScanServiceLogicTest.kt`
  TDD 测试文件（先于实现写出，RED→GREEN），11 条用例覆盖互斥锁判定/扫描保鲜/冲突覆盖判定
  /去重/下线判定/派发一致性核对。

### 修改

- `services/agent-android/app/src/main/AndroidManifest.xml`
  注册 `DeviceAccountScanService` 无障碍服务（独立 service 声明，绑定新 xml config）。
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`
  - 新增 `runAccountScanLoop()`：30-60 分钟随机间隔（`Random.nextLong`，与 `RandomDelay` 同
    风格，禁止固定常量）定时广播触发账号扫描。
  - 新增 `accountScanResultReceiver` + `reportAccountScanResult()`：接收扫描结果广播，打印
    清晰的"待上报中台"日志（真实中台写接口未在本 sprint 合同范围内，留有明确 TODO 标注需要
    对接 `agent_platform_sessions` 及 tenantId 服务端反查约束）。
  - `routeDmOutreachTask()` 新增 Golden Path Step 7 接线：派发触达任务前调用
    `DeviceAccountScanService.checkDispatchConsistency(profileUrl)`，若目标账号在
    `DeviceAccountRegistry` 中记录为已下线（与派发假设不一致）→ 触发一次实时重扫 + 该次
    任务按未登录处理转失败，不再启动无障碍执行流程点一个已登出账号。
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`
  `startCollect`/`reportResult`/`finishWithError` 处读写 `ScanMutex.busy`（任务运行期间
  `true`，结束时 `false`），实现跨服务互斥标记的"写"端。
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt`
  `startOutreach`/`finishWithOutcome` 处同样读写 `ScanMutex.busy`。

## TDD RED → GREEN 证据

### RED（新增测试文件后，编译失败）

```
e: .../DeviceAccountScanServiceLogicTest.kt:32:9 Unresolved reference: ScanMutex
e: .../DeviceAccountScanServiceLogicTest.kt:40:20 Unresolved reference: DeviceAccountScanService
e: .../DeviceAccountScanServiceLogicTest.kt:95:31 Unresolved reference: DeviceAccountRegistry
...(共 20+ 条 Unresolved reference / 编译错误)

FAILURE: Build failed with an exception.
> Task :app:compileDebugUnitTestKotlin FAILED
> Compilation error. See log for more details
```

### GREEN（实现 `ScanMutex`/`DeviceAccountRegistry`/`DeviceAccountScanService` 后）

```
> Task :app:compileDebugUnitTestKotlin
> Task :app:testDebugUnitTest

BUILD SUCCESSFUL in 1s
23 actionable tasks: 6 executed, 17 up-to-date
```

`DeviceAccountScanServiceLogicTest.xml`：
```
<testsuite name="com.zenithjoy.agent.account.DeviceAccountScanServiceLogicTest"
  tests="11" skipped="0" failures="0" errors="0" ... />
```

## 验收 grep 完整输出

```
$ grep -rln "DeviceAccountModel\." services/agent-android/app/src/main --include="*.kt" | grep -v DeviceAccountModel.kt
services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt
services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/ScanMutex.kt
services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt
```

`AgentService.kt` 与 `DeviceAccountScanService.kt` 是真实业务调用点（`ScanMutex.kt` 命中是
类头注释里提到 `DeviceAccountModel.shouldSkipScanDueToMutex` 的说明文字，非代码调用）。

## 编译测试最终结果

```
$ ./gradlew :app:testDebugUnitTest
BUILD SUCCESSFUL in 2s
23 actionable tasks: 15 executed, 8 up-to-date
```

全仓库 Android 单测汇总：**15 个测试类，共 109 条测试，全部 PASS（0 failures，0 errors）**。
其中新增 `DeviceAccountScanServiceLogicTest` 11 条，`DeviceAccountModelLogicTest`（PR #1131
遗留）29 条不变仍全绿，其余既有测试类（DouyinCollectService/DouyinDmOutreachService/
HttpHeartbeatLoop 等）均未受影响。

## 接缝清单（未真验前不得标 done，沿用 sprint 07061204 合同既有边界）

- 无障碍服务真实读取"切换账号"面板的 resource-id/content-desc 命名（`switch_account_entry`/
  `account_item`/`tv_douyin_id` 等）是按现有 `DouyinCollectService`/`DouyinDmOutreachService`
  同款猜测式命名 + content-desc 优先的写法占位，真机版式需要人工在 Honor 真机
  （Tailscale 100.91.227.1）核实并修正，这是 sprint 07061204 合同接缝清单第 1 条本身就标注
  的已知未验证项，本次接线不改变该风险状态。
- 中台写回 `agent_platform_sessions` 的真实 API 端点未实现（本 sprint 任务书明确排除在范围
  外），`reportAccountScanResult` 目前只做日志占位 + TODO 标注。
- tenantId 目前 Android 侧本地是空字符串占位（不信任设备本地值，等服务端按 agent_id 反查），
  `buildScanDecisions`/`ScannedAccount` 的 tenantId 参数在真实中台对接前只用于本地扫描内部
  上下文，不构成生产可用的租户隔离实现。
