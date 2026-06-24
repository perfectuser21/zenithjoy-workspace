ZenithJoy Agent — 部署说明
=====================================

[ 一、安装与启动（无黑窗）]

前提：微信必须是 4.1.8.107 版本（4.1.9/4.1.10 不支持）
      开机已登录微信

步骤：
1. 把 .env.template 拷贝改名为 .env
   编辑 .env，把 ZENITHJOY_LICENSE 改成你的真 license
   （dashboard https://autopilot.zenjoymedia.media/dashboard/agent "License" 页拷贝）

2. 双击「启动 ZenithJoy Agent」快捷方式（安装时自动生成，指向 start.vbs 无窗入口）
   —— 全程无黑色控制台窗口；首次启动会自动注册开机自启。
   （start.bat 是内部启动脚本，由快捷方式/开机自启隐藏调用，不需要也不要手动双击它）

3. 任务栏右下角出现「悦升云端」托盘图标即启动成功；
   打开 Dashboard https://autopilot.zenjoymedia.media/dashboard/agent 看到"Agent 在线"即可。

4. 用另一个微信给本机微信发一条消息，等 5-15 秒收到 AI 回复即装好。

日志：%APPDATA%\zenithjoy-agent\launch.log（启动器）
      %USERPROFILE%\.zj\agent.log（Agent 主进程）

功能说明：
- 后台静默回复：微信可最小化/后台，AI 仍能读消息并回复，不抢鼠标键盘
- 防重复：同一联系人回复后 30 秒内不重复发，重启后记录不丢
- 崩溃自愈：监听进程崩溃后 30 秒自动重启
- 微信自启：检测到微信未运行时自动拉起，等扫码登录


[ 二、常见问题 ]

SmartScreen 弹"Windows 已保护你的电脑"：
  点"更多信息" -> "仍要运行"
  或右键 zenithjoy-agent.exe -> 属性 -> 勾"解除锁定" -> 确定

微信更新后监听失效：
  微信降回 4.1.8.107（4.1.10 开始 UIA 控件树不兼容）

注销开机自启：
  powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Unregister

升级安装包：
  解压新版到新目录，复制旧 .env 过去，重新双击快捷方式即可
  %APPDATA% 下的日志和已回复记录自动继承
