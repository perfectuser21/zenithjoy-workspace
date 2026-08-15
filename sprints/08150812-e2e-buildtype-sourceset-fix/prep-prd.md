# Bug PrepPRD：e2e buildType 从未真正包含 src/debug 源码，DebugE2ETriggerReceiver 从未被安装到任何真机

## 症状
真机复现 OPEN_PANEL_FAILED 时，需要绕开服务端 `/account-scan/trigger` 的限流+心跳窗口死锁，改用 `DebugE2ETriggerReceiver`（仅编进 `e2e` buildType 的本地 adb 广播触发器，见 `services/agent-android/app/src/debug/kotlin/com/zenithjoy/agent/debug/DebugE2ETriggerReceiver.kt` 文件头注释）。按注释指引 `./gradlew :app:assembleE2e` 编译、装到两台不同品牌真机（realme/ColorOS「小白」、荣耀/MagicOS「第四台」）后，`adb shell am broadcast -a com.zenithjoy.agent.DEBUG_E2E ...` 发出的广播被系统 `ActivityManager` 正常 enqueue，但 App 进程从未产生任何 `DebugE2ETrigger`/`DeviceAccountScanSvc` 日志——一度被误判为两种不同的厂商后台限制问题（ColorOS Hans 进程冻结、荣耀启动管理锁）。

## 根因假设
`app/build.gradle.kts` 里 `e2e` buildType 用 `initWith(getByName("debug"))` 只复制了 debug 的构建*配置*（签名/可调试标志等），AGP 按 buildType 名字找源码目录的默认约定是 `src/e2e/`，从不会自动带上 `src/debug/`。`aapt2 dump xmltree` 反查已装到真机上的 e2e 包 manifest 实锤验证：receiver 列表里只有 `BootReceiver`/`ProfileInstallReceiver`，完全没有 `DebugE2ETriggerReceiver`——这个类和它的 manifest 声明从未被真正编进任何一次实际安装到真机的 e2e 包，「仅 debug 变体存在」的设计意图从一开始就没有生效。

## 修法
`app/build.gradle.kts` 的 `android {}` 块内新增：
```kotlin
sourceSets {
    getByName("e2e") {
        kotlin.srcDir("src/debug/kotlin")
        manifest.srcFile("src/debug/AndroidManifest.xml")
    }
}
```
显式把 `src/debug` 纳入 `e2e` 变体的编译单元。

## 验证（已完成，非事后声明）
1. 修复前：`aapt2 dump xmltree app-e2e.apk --file AndroidManifest.xml` 反查已装到荣耀真机的旧构建，确认 receiver 列表里没有 `DebugE2ETriggerReceiver`（此为 failing 状态的实锤证据）
2. 修复后：本地 `./gradlew :app:assembleE2e` 重新编译，同样用 `aapt2 dump xmltree` 反查新产物，确认 `DebugE2ETriggerReceiver` 已出现在 receiver 列表，`exported=true`，intent-filter action 为 `com.zenithjoy.agent.DEBUG_E2E`
3. 真机装机验证：把修复后的 e2e 包装到荣耀真机（MAA-AN00，经 rog WiFi 调试连接），`adb shell am broadcast` 触发后，logcat 里首次真实产出了 `DeviceAccountScanSvc: account scan task received: requestId=...` 等分步日志（此前该日志从未出现过），证明广播链路已经真正打通

## Regression 计划
Gradle 配置本身不便写传统单测，用一条 CI 静态检查脚本兜底防回归：断言 `app/build.gradle.kts` 里存在 `sourceSets { getByName("e2e")` 且引用了 `src/debug`——如果这段被误删/重构掉，CI 直接红，不用等到下次真机排障才发现。

## 验收标准
- [x] `./gradlew :app:assembleE2e` 编译成功
- [x] `aapt2 dump xmltree` 反查确认 `DebugE2ETriggerReceiver` 已在 manifest 中且 exported=true
- [x] 真机装机后广播触发产出真实 `DeviceAccountScanSvc` 日志（已在荣耀 MAA-AN00 上验证）
- [ ] 新增 CI 静态检查脚本防止 sourceSets 配置被误删
