# Bug PrepPRD：tryLocatorAssist 单次抓树时机竞态——树可能在渲染未稳定时被抓拍

## 症状
0824真机强制失败闭环连续测试 scan_me_tab，AI(gpt-5.4-mini)连续6次选错(view_id分别为
1u_/zuu/0ll/desc/gla/e6e)。经三层排查确诊：不是模型能力问题、不是多窗口问题(dumpsys
accessibility确认抖音是覆盖全屏的单一APPLICATION窗口)、不是MAX_NODES/BYTES截断
(两次失败快照均无truncated标记)——是`tryLocatorAssist`只抓一次树快照，抓拍时机可能
撞上底部导航所在子树还没渲染稳定的过渡帧：对比两次独立失败(`e6e`案例/`gla`案例)，
同一容器`id=w5w`的bounds分别是`[0,0][1080,2149]`和`[0,0][1080,0]`——同一view在不同
抓取瞬间bounds天差地别，实锤是布局/Lynx渲染还没稳定。

## 根因假设
主查找路径(`awaitNode`)对"渲染没稳"这类情况已有防护——轮询最多12次/5.5秒才采信。
但`tryLocatorAssist`自己的树抓取(`rootInActiveWindow?.let {...}`)是**单次快照，没有
同款重试/稳定性等待**——它在主查找轮询彻底放弃之后才被调用，理论上此时应已稳定，但
真机证据显示某些时刻这个假设不成立。

## 关联上下文
- 见 memory `ai_oncall_uitree_missing_bottomnav_rootcause_0824.md`
- 同批真机复测已修复的三个bug：PR#1725(bounds兜底)/PR#1728(verified信号改真结果)/
  PR#1731(bounds有效性防崩溃)——本次是这条链路上更深一层的问题

## 修法
`tryLocatorAssist`抓树时不再只抓一次，改为最多抓3次(间隔250ms)，每次都做一次序列化，
挑序列化结果**字节数最大**的那次发给AI（更完整的渲染帧通常产出更多可序列化的节点/
文本，是"渲染是否稳定"的低成本代理指标，不需要专门识别"底部导航"这类目标相关的逻辑，
保持通用性——不止对scan_me_tab有效，对其它调用点/其它Service的同名tryLocatorAssist
未来复用这个模式时也一样受益，但本次实现范围仍限定`DeviceAccountScanService.kt`）。

## Regression Test 计划
本仓库无 Mockito/Robolectric，源码锚点静态检查：断言 `tryLocatorAssist` 函数体内
树抓取部分有重试循环结构（多次调用`UiTreeSnapshot.serialize`并比较长度，不是只调用
一次就直接使用结果）。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] CI 全绿
