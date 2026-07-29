## 安卓Path2账号扫描OPEN_PANEL_FAILED——点我tab后单次固定delay检查过早（2026-07-29）

### 根本原因
`DeviceAccountScanService.openSwitchAccountPanel()` 点"我"tab后检查"切换账号"入口是否出现，
原实现只 `delay(1500L)` 单次检查一次。个人页在真机上渲染较慢时(CLEAR_TOP冷启动后的首次
渲染、头像等网络内容加载)，1500ms 常常不够，检查时机过早导致误判为"未见切换账号"，
转入 CLEAR_TOP 整轮重试；因为每一轮重试走的是完全相同的固定延迟路径，同一台设备连续
3 次重试会系统性地全部命中同一时序窗口、全部失败——真机复现(07-28 staging
`agent_scan_failures` 表，2台干净设备 afc3505c/f182e64e 共3次)的失败 tree_dump 均证实
"我，按钮"底部导航节点其实一直存在，只是流程从未等到导航真正完成。

同一个文件里 `readMyProfile()` 已经用轮询等待(`repeat(4){delay(800L);查"抖音号"锚点}`)
解决过同类问题，但 `openSwitchAccountPanel()` 里等"切换账号"这一步没有对齐同一模式，是
两处等待策略不一致导致的回归。

### 下次预防
- [ ] 涉及真机 UIA 页面导航的等待逻辑，一律用轮询(repeat/for + delay + 条件检查)而不是单次固定 delay，参照 `superpowers` 的 `condition-based-waiting` 技巧
- [ ] 同一个 Service/文件里如果已有被真机验证过的等待模式(如 readMyProfile 的轮询)，新增的类似导航步骤要主动对齐它，而不是各写各的等待策略
- [ ] 本仓库测试环境无 Mockito/Robolectric，回归测试只能对涉及 UIA 时序的改动做源码静态结构断言(照抄 `DeviceAccountScanServiceMeTabLocateTest` 写法)，不能真正驱动运行时行为——真机复跑仍是唯一的最终验证手段，PrepPRD 验收标准里必须显式标注这一限制(golden-path-2-smoke.sh TODO 标记)
