# Bug PrepPRD：AI on-call 指认节点bounds退化/屏外时 tapNodeCenter 崩溃 SCAN_EXCEPTION

## 症状
0824凌晨真机强制失败闭环第四轮复测（HONOR ANY-AN00，清空缓存后逼出全新AI调用）：
AI(gpt-5.4-mini)指认 view_id=`com.ss.android.ugc.aweme:id/0ll`，`findNodeByIds`在当前
树里确实找到了一个该id的节点，但调用 `tapNodeCenter` 时抛出未捕获异常
`Path bounds must not be negative`，整个账号扫描任务以 `SCAN_EXCEPTION` 崩溃退出，
而不是走已有的"未找到→坐标兜底"降级路径。

## 根因假设
`findNodeByIds(root, vararg ids)`（DeviceAccountScanService.kt:685-691）对
`root.findAccessibilityNodeInfosByViewId(id)` 返回的多个候选节点无条件取
`list[0]`，不校验该节点在屏幕上的实际bounds是否有效——抖音的 RecyclerView/Lynx
渲染场景下同一 view_id 可能同时挂着多个实例（一个可见、一个刚划出屏幕外/被
回收但仍留在树里，bounds 退化或为负值）。`tapNodeCenter`（同文件545-548行）
拿到这类退化节点后，直接用 `node.getBoundsInScreen(r)` 算出的中心坐标构造
`Path().moveTo(x,y)` 发手势，退化/越界坐标导致 Android 侧抛出
"Path bounds must not be negative"，且调用链上没有任何 try/catch 兜底，
直接冒穿到最外层任务处理，被记成 SCAN_EXCEPTION。

## 关联上下文
- 同一批AI on-call 真机复测发现的第三个问题，前两个已修：PR#1725(bounds兜底)、
  PR#1728(verified信号改真结果)
- 见 memory `ai_oncall_scan_me_tab_realfeedback_and_new_crash_0824.md`
- 本质上跟 STEP_KNOWLEDGE 想解决的"同一view_id多实例歧义"是同一类问题，
  但复现现象不同（这次是崩溃而不是点错）

## 修法
双管齐下，范围限定 `DeviceAccountScanService.kt`（本次真机证据复现的唯一文件，
`DouyinCollectService.kt`/`DouyinDmOutreachService.kt` 里同名的 tapNodeCenter/
tapAtCoordinate 有同样潜在风险，但未经真机验证，留作后续技术债不在本次处理）：

1. `tapNodeCenter`：拿到节点 bounds 后先校验 `!r.isEmpty && r.left >= 0 && r.top >= 0`，
   退化/负坐标节点直接跳过点击（记警告日志），不构造手势——不崩溃、不影响其余
   已有的"未见效果→CLEAR_TOP重试/坐标兜底"降级路径（该路径本来就在，只是之前
   走不到，因为进程已经崩了）。
2. 保持 `tapNodeCenter` 签名不变（Unit，5处调用点均不消费返回值），最小化改动
   范围，不引入新的调用方改动。

## Regression Test 计划
本仓库无 Mockito/Robolectric，沿用源码锚点静态检查风格：断言 `tapNodeCenter`
函数体在构造 `tapAtCoordinate` 调用之前，必须先做 bounds 有效性校验
（`isEmpty`/`left`/`top` 相关判断），且校验失败分支不能调用 `tapAtCoordinate`。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] CI 全绿
