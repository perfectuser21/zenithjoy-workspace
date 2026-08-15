# 账号扫描 LAUNCH_BLOCKED 修复：透明 trampoline Activity 过厂商后台启动拦截 — 设计

- Brain task：`29320ff1-dd9c-42b1-b37a-4c5ec8ffecdd`
- GP-Anchor：`line02/keyword_acquisition#step5`（Brain journey `afa6abca` Step7「中台检测登录态」）；Feature `f466e190`
- 决策链：`964ba941`（点击注入方式已证伪）→ `61298fc6`（trampoline 真机 3/3）→ `7ea333a3`（bug-fix）
- PrepPRD：`sprints/08152048-account-scan-launch-trampoline/prep-prd.md`

## 1. 问题

`DeviceAccountScanService.launchDouyinApp()` 在无障碍服务里从后台 `applicationContext.startActivity(抖音)`。荣耀 iAware 判定"调用方没有前台 Activity"直接拒绝（`prevent start activity by iaware`，result 102），抖音从未到前台，扫描终态 `LAUNCH_BLOCKED`。4号机（MAA-AN00，Android 15）后台冷启动 5/5 复现。realme ColorOS（小白）在 sprint 08031620 已见同类拦截。

同机对照（e2e 包 2.1.20-e2e）：后台直启 0/5；先挂 1px `TYPE_ACCESSIBILITY_OVERLAY` 0/3（AOSP `BAL_ALLOW_VISIBLE_WINDOW` 放行、iAware 仍拦——它认的是前台 Activity，不是可见窗口）；**先 startActivity 自家 Activity 再拉抖音 3/3 PASS**（自家 Activity 放行 → 抖音 `BAL_ALLOW_VISIBLE_WINDOW result 0`）。点击注入（dispatchGesture / Shizuku）与本 bug 无关：抖音在前台时两者 3/3 = 3/3。

## 2. 方案取舍

| 方案 | 结论 |
|---|---|
| A. Shizuku `am start`（shell UID） | 否。仅 rog/pc4 机队装了 Shizuku，客户设备零收益 |
| B. 无障碍 overlay 造"可见窗口" | 否。真机 0/3，iAware 不认 |
| C. 复用 `MainActivity` 当 trampoline | 否。它 `onCreate` 解析 bind deeplink 并改写 config，有副作用，还会闪出完整 UI |
| **D. 专用透明 trampoline Activity（选定）** | 是。真机 3/3；无 UI、不进最近任务、不需要新权限、不依赖 Shizuku；对齐既有 `ShareIngestActivity` 模式 |

## 3. 设计

### 3.1 新增 `com.zenithjoy.agent.account.DouyinLaunchTrampolineActivity`

- 继承 `android.app.Activity`，无布局。
- Manifest：`exported="false"`、`excludeFromRecents="true"`、`noHistory="true"`、`taskAffinity=""`、`theme="@android:style/Theme.Translucent.NoTitleBar"`、`launchMode="singleTask"`（对齐 `ShareIngestActivity`）。
- 输入：`Intent extra EXTRA_TARGET_PACKAGE`（默认 `com.ss.android.ugc.aweme`）。
- 行为：`onResume()` 首次触发时（`launched` 守卫）用 `packageManager.getLaunchIntentForPackage(target)` + `FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TOP` 启动目标，随后 `finish()`。目标未装/异常 → 记日志后 `finish()`。
- 自杀兜底：`onCreate` 里 `postDelayed(2000ms)` 若仍未 finish 则 finish（焦点始终不来时不泄漏；与 `ShareIngestActivity` 的 3s 自杀同思路）。
- `onNewIntent` 更新 intent、`removeCallbacksAndMessages` 清掉旧自杀定时器再重挂，然后复位 `launched`（singleTask 复用场景；对齐 `ShareIngestActivity` 已踩过的复用带旧回调的坑）。

### 3.2 `DeviceAccountScanService.launchDouyinApp()` 改造

```
launchDouyinApp():
  try  startActivity(DouyinLaunchTrampoline.buildTrampolineIntent(this, DOUYIN_PKG))  → true
  catch(e) log; return launchDouyinDirect()   // 原实现原样保留：行为 = 改动前
```

- 所有 5 处 `launchDouyinApp()` 调用点自动受益（openSwitchAccountPanel 首次 + 重试、launchAndSettle、warmup、forceCloseToHome），后续 `awaitDouyinForeground()` 逻辑一字不动。
- trampoline 只负责"让 App 变前台并拉起目标"，不参与任何扫描判定；`awaitDouyinForeground` 仍是唯一"抖音到前台了吗"的裁判。
- 不改 `DouyinCollectService` / `DouyinDmOutreachService`（范围外，同类问题另立任务）。

### 3.3 `DouyinLaunchTrampoline`（Kotlin object；常量与 `resolveTargetPackage` 可 JVM 单测，`buildTrampolineIntent` 返回 Intent 只由 Activity/Service 调用、靠源文本守卫覆盖——本 repo 单测不能构造 android Intent）

- `EXTRA_TARGET_PACKAGE`、`DEFAULT_TARGET_PACKAGE`（= `DeviceAccountScanService.DOUYIN_PKG` 同一常量，服务侧改为引用它，不留两份字面量）
- `TRAMPOLINE_FLAGS = FLAG_ACTIVITY_NEW_TASK`
- `TARGET_FLAGS = FLAG_ACTIVITY_NEW_TASK or FLAG_ACTIVITY_CLEAR_TOP`（与原直启 flags 一致）
- `resolveTargetPackage(extra: String?): String`（空/空白 → 默认抖音包）
- `buildTrampolineIntent(context, targetPackage): Intent`

### 3.4 版本

`versionName 2.1.20 → 2.1.21`，`versionCode 24 → 25`（改 Agent 须 bump）。

## 4. 错误路径

| 场景 | 行为 |
|---|---|
| trampoline 自身被系统拦（未知 OEM）/ startActivity 抛异常 | 捕获 → 退回原直启；终态分类不变（LAUNCH_BLOCKED），诊断留痕不变 |
| trampoline 起来了但抖音没到前台（未装/冻结） | trampoline finish；`awaitDouyinForeground()` 既有超时 → 既有分类 |
| 锁屏 | 既有 SCREEN_LOCKED 前置检查在 trampoline 之前，行为不变 |
| 客户手机上出现残留 | excludeFromRecents + noHistory + taskAffinity="" + 2s 自杀，三保险 |
| 并发/重试多次调用 | 每次 NEW_TASK + singleTask + finish，无状态 |
| 未装 Shizuku / 生产设备 | 本方案不碰 Shizuku，零差异 |

## 5. 测试策略

- **逻辑守卫（CI，commit-1 先红）**
  - `DouyinLaunchTrampolineTest`（JVM 纯单测）：`resolveTargetPackage` 空/空白/显式值；`TARGET_FLAGS` 含 NEW_TASK|CLEAR_TOP；`TRAMPOLINE_FLAGS` 含 NEW_TASK。
  - `ManifestLaunchTrampolineActivityTest`（源文本守卫，对齐 `ManifestForegroundServiceTypeTest`）：Manifest 声明 `.account.DouyinLaunchTrampolineActivity` 且 `exported=false`、`excludeFromRecents=true`、`noHistory=true`、`taskAffinity=""`、Translucent 主题。
  - `DeviceAccountScanServiceLaunchTrampolineTest`（源文本守卫，对齐 `MainActivityRegisterErrorDisplayTest`）：`launchDouyinApp()` 经 `buildTrampolineIntent` 起 trampoline，且保留直启回退；trampoline Activity 在 `onResume` 起目标并 `finish`。
- **环境守卫（proven-to-fire）**：4号机 e2e 包，后台冷启动 `DEBUG_E2E scan`（不预拉抖音、不传 launch_mode）——修前 0/5 红（今日实测），修后 ≥3/3 `ok=true accounts>0`。执行脚本：scratchpad `launch-probe.sh bg 3`。
- **既有 smoke**：`golden-path-2-smoke.sh` 保持全绿（服务端断言不受影响）。

## 6. 不做

- Shizuku 相关（决策 964ba941 已证伪其价值）
- overlay 方案
- collect / dm 服务的同类改造
- 小白（realme ColorOS）复验——pc4/手机池离线，上线后用同一探针跑，另开任务
