## 安卓账号扫描 LAUNCH_BLOCKED：荣耀 iAware 拒绝后台拉起抖音，透明 trampoline 修复（2026-08-15）

### 根本原因
- `DeviceAccountScanService.launchDouyinApp()` 在无障碍服务里从后台 `startActivity(抖音)`；荣耀 iAware 判定"调用方没有前台 Activity"直接拒绝（logcat `prevent start activity by iaware`，result 102=START_ABORTED），AOSP BAL 本身放行。抖音从未到前台 → `LAUNCH_BLOCKED`（4号机后台冷启动 0/5 复现）。
- 前一晚 spike 把 logcat 里 `App .../com.zenithjoy.agent.e2e targets O+, restricted` 读成"dispatchGesture 撞安卓 O+ 后台执行限制"——那行是 ActivityManager 对 O+ 应用**广播入队**的常规信息日志，与手势无关。同机对照：抖音在前台时 dispatchGesture 3/3 = Shizuku tap 3/3，点击注入方式与失败无关（decision 964ba941）。
- iAware 认的是"前台 Activity"，不是 AOSP 的"可见窗口"：1px `TYPE_ACCESSIBILITY_OVERLAY` 让 AOSP 判 `BAL_ALLOW_VISIBLE_WINDOW` 但 iAware 仍拦（0/3）；先 startActivity 自家 Activity 再拉抖音放行（3/3，decision 61298fc6）。

### 下次预防
- [ ] 真机 RPA 失败先做**分层探针**（启动 → 前台 → 点击 → 读树），用 `am start`（shell UID）预拉目标 App 把"启动被拦"从"点击/注入"里剥出来，再谈换注入方式。
- [ ] 读 logcat 判根因时，`targets O+, restricted` 一类 ActivityManager 信息日志先查其语义（广播/进程限制），别直接对号入座到自己怀疑的模块。
- [ ] 厂商后台启动拦截（荣耀 iAware / realme ColorOS 应用启动管理）的通用解法：先起自家透明 noHistory/excludeFromRecents Activity 成为前台，再拉目标；不需要 Shizuku/新权限。同类调用点（DouyinCollectService / DouyinDmOutreachService）如再见 LAUNCH_BLOCKED，复用 `DouyinLaunchTrampoline`。
- [ ] 每次改注入/启动路径必须在 4号机（rog 192.168.1.96:5555，e2e 包 `DEBUG_E2E scan` 广播）跑后台冷启动探针 ≥3 次，修前红修后绿才算数。
