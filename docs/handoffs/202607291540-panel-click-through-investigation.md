# Handoff：作战窗收起态点击穿透排查——多个真实架构bug已修，最终定位在Chromium合成层，未彻底解决

**Verdict**: PARTIAL PASS
**Branch**: cp-07291126-panel-topmost-reassert (PR #1530/#1534已合并)

## 完成（真实证据确认）
- 核心进程真的会拉起作战窗WPF壳（真机截图证实）
- 展开态视觉设计补齐（深色卡片布局，真机截图证实，此前纯白）
- 补了收起按钮（单测4用例先红后绿）
- 收起态点击区域CSS高度从"只占内容高度"改成height:100vh撑满整条窗口
- WPF `Topmost=true`对已是true的窗口是no-op的坑：改用`False→True`显式切换
- 直接P/Invoke `SetWindowPos(HWND_TOPMOST)`兜底，不依赖WPF Topmost抽象层
- 收起态点击区域从8个WPF单位(150% DPI下12真实像素，远低于可用点击目标)加宽到28单位(42真实像素)
- 去掉`AllowsTransparency="True"`+`Background="Transparent"`：确认RpaMini态的鼠标穿透一直是走原生`WS_EX_TRANSPARENT`实现，不依赖WPF的AllowsTransparency；而收起/展开态视觉上都是纯色不透明，AllowsTransparency是历史遗留、不再需要、且会引入per-pixel点击穿透副作用
- WebView2 `DefaultBackgroundColor`此前从未设置，已显式设为不透明色

## 没完成 / 未解决
- 收起态灯带点击展开这个具体交互，用远程SSH+schtasks模拟鼠标(SetCursorPos+mouse_event)持续无法验证生效
- **关键诊断发现**：在CollapsedStrip加了最底层window级pointerdown/mousedown/click原始事件监听(临时诊断代码，已完全revert，未进git)，真机测试显示**连一个DOM事件都没触发**——证明合成鼠标事件根本没有到达WebView2/Chromium渲染进程内部，虽然`WindowFromPoint`已确认命中的是本面板自己的`Chrome_RenderWidgetHostHWND`（进程命令行确认`--webview-exe-name=ZenithJoyAgentPanel.exe`）
- 已排除：z-order问题(GetWindow验证面板确实在最上层，只有一个无害IME窗口在上面)、too-narrow问题(加宽到42px仍无效)、透明度穿透问题(去掉AllowsTransparency仍无效)、DWM合成状态损坏问题(一次干净重启后复测仍无效)
- 高度怀疑：Chromium对`mouse_event`这类legacy合成输入API有自己的输入来源校验/过滤机制(现代Chromium出于反自动化/反clickjacking考虑，对非硬件来源的输入可能有额外过滤)，这是**测试方法本身的局限**，不一定代表真实物理鼠标点击也无效——Explorer/开始菜单/微信(Qt)这些非Chromium界面对同样的合成点击都有真实反应，唯独WebView2内容没有任何反应

## 真机事故（已恢复）
排查过程中为了强制刷新DWM合成状态，`taskkill /IM dwm.exe /F`导致xian-rog真实屏幕黑屏（壁纸/图标/任务栏消失，进程本身都健康）。标准恢复手段(InvalidateRect全局重绘、重启explorer.exe、Win+Ctrl+Shift+B显卡驱动重启快捷键)均未能恢复，最终由用户物理重启机器解决。这是一次真实操作事故，记录在案，以后**绝不再对共享真机的DWM/系统合成进程做实验性kill**。

## 下一步
- 需要用户用真实物理鼠标在xian-rog上直接测试收起态灯带点击是否生效——这是当前唯一能给出确定答案的验证方式
- 若真实物理鼠标也点不中，需要换用`SendInput`(而非legacy `mouse_event`)配合正确的硬件来源标志位重新测试，或者接入WebView2远程调试协议(CDP)用`Input.dispatchMouseEvent`做更底层的输入注入验证
- 若真实物理鼠标点击正常，说明本次所有架构修复(z-order/透明度/点击区域宽度)已经解决问题，只是我的远程测试方法本身有盲区

## 数据源
- `apps/agent-panel-host/MainWindow.xaml` / `MainWindow.xaml.cs`（AllowsTransparency/ReassertTopmost/DefaultBackgroundColor）
- `apps/agent-panel/src/styles/panel.css`（.panel-collapsed height:100vh）
- Brain issue `dfde285c`（点击穿透排查全过程记录，已过时部分内容——最新结论在本handoff）

## 产物
- PR #1517/#1519/#1520/#1521/#1522/#1524/#1526/#1527/#1530/#1534：本轮全部相关修复，均已合并
- 真机部署：xian-rog v2.0.94（含全部代码修复，含一次完整重启恢复）
