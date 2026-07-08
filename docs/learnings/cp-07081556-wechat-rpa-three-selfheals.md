# Learning: 微信 RPA 三自愈——窗口最大化 / 欢迎屏点击 / 回顶前台点击

分支：cp-07081556-wechat-rpa-three-fixes（2026-07-08）
关联：issues 99741ff9 / e78d98bc / 8e163d87，skill wechat-cs-troubleshooting §2.K/§2.J/§2.I，decision c278092a

### 根本原因

1. **窗口非最大化 = 静默停摆（A）**：微信窗口宽 <~700px 进单栏布局，会话列表**整个不在 UIA 树**，
   scan 读到的 "sessions" 是聊天气泡，unread 永远 0 且心跳"一切正常"。微信重启后默认非最大化，
   每次自愈重启都自动掉坑。
2. **欢迎回来屏只检测不自愈（B）**：重启后 `mmui::LoginWindow title='微信'` 常是不需要密码的
   确认屏（进入微信/切换账号/仅传输文件），代码把它当隐私锁等人工。三次自动点击尝试失败的
   真因不是 DPI（pywinauto import 即置 per-monitor aware），是**没先拉前台**：UIA Invoke 和
   后台 PostMessage 对 mmui 自绘按钮均无效，AttachThreadInput 拉前台 + click_input 实证有效。
3. **回顶按钮定位用屏幕绝对坐标（C）**：`left_max=90` 判 `r.left<90`，只有窗口贴屏幕左边缘
   （最大化）才成立；窗口在 x=964 时"导航按钮不全"必现 → job3 gate 连坐挡无关 PR。

### 下次预防

- [ ] mmui 控件的"点击是否生效"结论必须配截图 ground truth，UIA 判据（按钮选中态/特征控件存在性）
      在 mmui 上大量不可靠（"新的朋友"不在树里、"通讯录管理"会滚出虚拟列表、legacy_state 全 0）
- [ ] 任何"检测到坏状态"的代码必须同 PR 配自愈或告警，禁止只检测不动作静默挂死
      （本次 diag 新增 window_state / welcome_click_fails 字段，中台可见）
- [ ] 微信重启类自愈收尾必须接 SW_MAXIMIZE（重启默认非最大化，不接就掉回 A 坑）
- [ ] click_input（真实鼠标注入）例外仅限窗口管理自愈函数
      （test_uia_interaction.py `_PHYSICAL_INPUT_EXCEPTION_FUNCS` 白名单锁死），发送/回复路径禁令不放松
