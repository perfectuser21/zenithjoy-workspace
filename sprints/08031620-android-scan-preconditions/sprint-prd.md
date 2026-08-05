# Sprint PRD — 安卓账号扫描前置条件修复（锁屏 + 后台启动拦截 + 错误码分层）

## OKR 对齐

- **对应 KR**：Path2 客户智能获客路径 — 账号扫描真机可靠性
- **当前进度**：抖音内部导航族根因已修复并真机验证通过（08-03，run 30796426553 全绿）；本 sprint 修剩余两个独立根因
- **本次推进预期**：三种已知失败根因（内部导航/锁屏/后台启动拦截）全部覆盖，`OPEN_PANEL_FAILED` 不再是大杂烩错误码

## 背景

Path2 安卓账号扫描 `OPEN_PANEL_FAILED` 此前诊断出多个不同根因混在同一错误码下。08-03 已用真实 `agent_scan_failures` 记录确诊另外两个独立、尚未修复的根因：
- 07-31 记录（id `da659ea0`，agent `e017953c`）：失败瞬间 tree_dump 是**锁屏界面**（"上滑解锁"+时钟），说明设备闲置锁屏时扫描必然失败。
- 07-30 记录（id `236f43b1`，agent `2abec9ab`，realme RMX3478/ColorOS）：失败瞬间 tree_dump 是**手机桌面 launcher**（抖音图标可见），说明 `startActivity` 拉起抖音被后台弹窗权限静默拦截，从未真正进入抖音进程。

这两个场景目前都被归入笼统的 `OPEN_PANEL_FAILED`，运维无法从错误码本身分辨"设备该做什么"。

## Golden Path（核心场景）

系统触发账号扫描 → 经过前置条件检查（锁屏/前台状态）→ 到达明确分类的终态（成功继续扫描 或 精确错误码上报）

具体：

1. 系统收到账号扫描任务，在导航抖音前先检测设备锁屏状态（keyguard/屏幕交互态）
   - 若锁屏可编程解锁（软锁）→ 系统自动唤醒并解锁 → 继续原扫描流程
   - 若锁屏无法编程解锁（如密码锁）→ 系统上报错误码 `SCREEN_LOCKED`，扫描本轮终止（不再误判为 `OPEN_PANEL_FAILED`）
2. 系统拉起抖音 App 后，在既有等待窗口内检测是否真正进入抖音前台
   - 若检测到抖音前台 → 继续原扫描流程（我tab定位/切换账号面板等，本 sprint 不改动这部分逻辑）
   - 若等待超时仍未进入抖音前台（后台启动被系统拦截，如 ColorOS 弹窗权限限制）→ 系统上报错误码 `LAUNCH_BLOCKED`，扫描本轮终止
3. 系统在失败详情（detail）中统一附带：当前 App 版本号（versionName）、失败发生的阶段（stage）、失败瞬间的前台包名 —— 供运维/开发不用重新登真机复现即可判断根因方向
4. 运维在 Agent 诊断页可查看"后台弹窗权限"自检项（尽力而为的近似信号），提前发现潜在 `LAUNCH_BLOCKED` 风险机型

## 边界情况

- 设备完全无响应（`rootInActiveWindow` 为 null）→ 归入既有 `UNKNOWN`/`READ_FAILED` 语义，本 sprint 不新增错误码
- 唤醒尝试后仍处于锁屏状态（如密码锁、无法程序化解锁）→ 视为"不可解锁"，直接上报 `SCREEN_LOCKED`，不做无限重试
- 拉起抖音后短暂进入前台又被系统踢回桌面（闪退/被杀）→ 在既有等待窗口内仍未稳定停留在抖音前台，按 `LAUNCH_BLOCKED` 处理
- 已进入抖音但停留在无底部导航栏的深层子页 → 沿用既有 `NAV_STUCK_SUBPAGE` 语义，不受本 sprint 影响
- 已进入个人页但"切换账号"面板长时间不出现 → 沿用既有 `PANEL_TIMEOUT` 语义，不受本 sprint 影响

## 范围限定

**在范围内**：
- `DeviceAccountScanService.kt` 增加锁屏检测/唤醒逻辑（`openSwitchAccountPanel()` 调用前置）
- `launchDouyinApp()` / `awaitDouyinForeground()` 增加"确认进入前台"超时判定与 `LAUNCH_BLOCKED` 上报
- 错误码分层：`SCREEN_LOCKED` / `LAUNCH_BLOCKED` 为新增，`NAV_STUCK_SUBPAGE` / `PANEL_TIMEOUT` 保留既有语义不变
- failure detail 结构扩展：versionName + stage + 前台包名
- Agent 诊断页新增"后台弹窗权限"自检展示项（`Settings.canDrawOverlays()` 近似信号，只展示不跳转设置）
- JVM 单元测试：用 07-30/07-31 两条真实失败记录的 tree_dump 做 fixture，覆盖新错误码判定路径
- `build.gradle.kts` bump versionCode/versionName

**不在范围内**：
- 自动跳转系统权限设置页（本 sprint 只做检测和诊断页提示，不做自动引导操作）
- Agent 诊断页除"后台弹窗权限自检项"外的其他 UI 改动
- 真机 E2E 脚本改动或新增（真机回归已由 08-03 上线的 `account-scan-realmachine-smoke.sh` nightly 车道自动覆盖，合并装机后自动验证，本 sprint 不新增/修改该脚本）
- `NAV_STUCK_SUBPAGE` / `PANEL_TIMEOUT` 判定逻辑本身的任何修改

## 假设

- [ASSUMPTION: 锁屏检测使用 `AccessibilityService` 上下文可获取的信号（如 `PowerManager.isInteractive()` 判断屏幕是否点亮，配合已有的 `performGlobalAction`/唤醒手势尝试解锁），无需申请额外系统权限]
- [ASSUMPTION: "后台弹窗权限自检"用 `Settings.canDrawOverlays()` 作为尽力而为的近似信号，不同厂商（ColorOS/MIUI/EMUI）后台启动限制的真实开关状态无统一 API 可读，本 sprint 不追求 100% 准确判定]

## 预期受影响文件

- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt`：新增锁屏检测/唤醒逻辑、前台确认超时判定、错误码常量拆分、failure detail 扩展字段
- `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/account/*.kt`：新增/扩展 JVM 测试，用两条真实 fixture（`agent_scan_failures` id `da659ea0` 锁屏 / `236f43b1` launcher）覆盖新判定路径
- `services/agent-android/app/build.gradle.kts`：bump versionCode/versionName
- Agent 诊断页相关 Kotlin/布局文件：新增"后台弹窗权限"自检展示项

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先；本 sprint 无匹配 NFR 决策记录 -->
- 超时/延迟: 沿用既有等待窗口约定（不在本 sprint 内调整既有超时数值，只新增"超时后终态判定"分支）
- 频控: 无新增
- 版本要求: 无新增（不锁抖音版本）
- 可观测: failure detail 必须带 versionName + stage + 前台包名（PrepPRD 显式要求）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；area 级唯一命中与本 line 场景不相关（cortex.js recordLearnings 验证方法论），不适用本 sprint，予以排除 -->
- （本 line 暂无与安卓账号扫描直接相关的 invariant 记录）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成/进行中 ability 的 golden_path -->
- 视频/图文内容判定门槛+留言触达门槛化: 客户在 Dashboard 填「目标画像描述」→ 存 `acquisition_config.target_profile_desc` → 安卓 Agent 点开视频卡片 → 中台判定 API 调 Gemini 多模态模型做 OCR/转写+语义判定

## E2E 验收

> proposer 将在 GAN 阶段按 `target_environment: local_api` 填入真实 JVM 测试运行脚本（Gradle test 命令），无需真机/浏览器交互。

```bash
# 占位：期望验收点（自然语言）
# 1. JVM 单测全绿：两条真实 fixture（da659ea0 锁屏 / 236f43b1 launcher）分别命中 SCREEN_LOCKED / LAUNCH_BLOCKED 新错误码判定
# 2. 既有 NAV_STUCK_SUBPAGE / PANEL_TIMEOUT 相关测试保持全绿（未被破坏）
# 3. failure detail 结构包含 versionName/stage/前台包名 三字段
# 4. CI 全绿；build.gradle.kts versionCode 已 bump
# 5. 真机段不在本 sprint 验收范围内 —— 合并后由 nightly account-scan-realmachine-smoke.sh 车道自动回归（08-03 已验证全绿的现成通道）
```

## journey_type: agent_remote
## journey_type_reason: 本 sprint 改动的是远端安装在客户/测试设备上的 Android Agent（AccessibilityService 无障碍服务代码），属于远端 agent 协议/自动化代码，非 Dashboard UI、非 Brain 后端、非纯 engine skill
## target_environment: local_api
## target_environment_reason: 验收标准是 JVM 单元测试全绿 + CI 全绿（Gradle test 在 GitHub Actions ubuntu-latest 上跑，无需浏览器/远端真机交互）；真机回归已由独立的、08-03 已验证全绿的 nightly self-hosted 车道覆盖，不在本 sprint proposer/evaluator 需要驱动的环境范围内
## journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f
## step_id: step5
