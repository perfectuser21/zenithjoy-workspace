ZenithJoy Agent — 1 分钟跑通
=============================

3 步装好 + 启动:

1. 把 .env.template 拷贝改名为 .env
   编辑 .env，把 ZENITHJOY_LICENSE 改成你的真 license（dashboard "License" 页拷贝）

2. 双击 start.bat
   首次会启 chrome :19222（用独立 user-data-dir，不影响日常 chrome）
   然后启 agent.exe

3. 回 dashboard https://autopilot.zenjoymedia.media/dashboard/agent
   看到 "Agent 在线" 即可

碰到 SmartScreen 提示 "Windows 已保护你的电脑":
- 点 "更多信息" → "仍要运行"
- 或右键 zenithjoy-agent.exe → 属性 → 勾选底部 "解除锁定" → 确定

碰到 chrome 找不到:
- 先装 Chrome 浏览器（必须）

agent 日志:
- %USERPROFILE%\.zj\agent.log
