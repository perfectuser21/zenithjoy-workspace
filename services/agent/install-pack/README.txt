ZenithJoy Agent v1.1.97 — 部署说明
=====================================

[ 一、微信 AI 客服（核心功能）]

前提：微信必须是 4.1.8.107 版本（4.1.9/4.1.10 不支持）
      开机已登录微信

步骤：
1. 把 .env.template 拷贝改名为 .env
   编辑 .env，把 ZENITHJOY_LICENSE 改成你的真 license
   （dashboard https://autopilot.zenjoymedia.media/dashboard/agent "License" 页拷贝）

2. 以管理员身份用 PowerShell 注册开机自启：
   powershell -ExecutionPolicy Bypass -File install-autostart.ps1

3. 双击 listener-watchdog.bat 立刻开始监听（不用等重启）

4. 用另一个微信给本机微信发一条消息，等 5-15 秒收到 AI 回复即装好

日志：C:\Users\Public\zj-listener.log
已回复记录（重启不丢）：C:\Users\Public\zj-replied.json

功能说明：
- 后台静默回复：微信可最小化/后台，AI 仍能读消息并回复，不抢鼠标键盘
- 防重复：同一联系人回复后 30 秒内不重复发，重启后记录不丢
- 崩溃自愈：监听进程崩溃后 30 秒自动重启
- 微信自启：检测到微信未运行时自动拉起，等扫码登录


[ 二、Agent 主进程（Dashboard + 视频流水线）]

1. 确保 .env 已填好 ZENITHJOY_LICENSE（同上）

2. 双击 start.bat（需要 Dashboard 或视频功能时运行）

3. 打开 Dashboard https://autopilot.zenjoymedia.media/dashboard/agent
   看到"Agent 在线"即可

agent 日志：%USERPROFILE%\.zj\agent.log


[ 三、常见问题 ]

SmartScreen 弹"Windows 已保护你的电脑"：
  点"更多信息" -> "仍要运行"
  或右键 zenithjoy-agent.exe -> 属性 -> 勾"解除锁定" -> 确定

微信更新后监听失效：
  微信降回 4.1.8.107（4.1.10 开始 UIA 控件树不兼容）

注销开机自启：
  powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Unregister

升级安装包：
  解压新版到新目录，复制旧 .env 过去，重新注册自启即可
  C:\Users\Public\ 下的日志和已回复记录自动继承
