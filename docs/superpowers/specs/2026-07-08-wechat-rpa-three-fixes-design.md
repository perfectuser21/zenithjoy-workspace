# wechat-rpa 三修设计：窗口最大化自愈 / 欢迎回来屏自动点击 / 回顶相对坐标+前台点击

- 日期：2026-07-08
- 任务：Brain task 07b127e4（handoff 202607081455 三遗留问题）
- 根因与修法已真机实证：wechat-cs-troubleshooting skill §2.K/§2.J/§2.I + decision c278092a
- Issues：99741ff9（A，P0）/ e78d98bc（B，P1）/ 8e163d87（C，P1）

## 修 A：主窗口非最大化 → 心跳自愈（P0）

**根因（实证）**：窗口宽 <~700px 微信进单栏布局，会话列表整个不在 UIA 树（sessions 读到聊天气泡）；
微信重启后默认非最大化，每次自愈重启都掉回此坑。SW_MAXIMIZE 从 session-1 直接可用（4→26 实证）。

**实现**：
1. 纯函数 `window_needs_maximize(is_zoomed, is_iconic) -> bool`（listen_chat.py 顶层，CI 可测）：
   可见（非 iconic）且非最大化 → True。**iconic（托盘/最小化）不动**——最小化是合法运行态
   （"微信最小化也能跑"），强行弹最大化窗口会打扰客户机操作者；本 PR 只修实证过的
   "可见小窗口"失败态。
2. 心跳块（每 ~60s，mw 非空时）：ctypes 读 `IsZoomed/IsIconic`，需要则 `ShowWindow(hwnd, 3)` +
   log `[窗口自愈] 非最大化(WxH)→已最大化`；冷却 300s（`_WINDOW_MAXIMIZE_COOLDOWN`）防抖。
3. 观测：heartbeat diag 新增 `window_state: {zoomed, iconic, w, h, maximize_heals}`
   （build_diag 纯函数扩展）→ 心跳日志 + health json + 中台可见 = 告警通道。

## 修 B：欢迎回来确认屏自动点击自愈（P1）

**根因（实证）**：重启后 `mmui::LoginWindow title='微信'` 常是"欢迎回来"确认屏
（Button 进入微信/切换账号/仅传输文件，UIA name 全暴露），代码只检测不自愈。
DPI 假设已推翻；实证有效点击 = AttachThreadInput 拉前台 + `click_input()`
（UIA Invoke 和不抢前台的 PostMessage 对 mmui 按钮均无效）；点击后主窗口 ~10s 才出现。

**实现**：
1. find_weixin.py 新增：
   - 纯函数 `classify_login_window(button_names: list[str]) -> str`：
     含"进入微信" → `'welcome_screen'`，否则 → `'privacy_lock'`（CI 可测）。
   - `find_welcome_enter_button()`：枚举 `mmui::LoginWindow title='微信'` 的 Button，
     返回 (login_hwnd, 进入微信按钮 wrapper) 或 None。
2. listen_chat.py 新增纯函数 `should_attempt_welcome_click(attempts, last_attempt_at, now,
   max_attempts=3, cooldown=120) -> bool`（CI 可测）。
3. 主循环 `mw is None and screen_locked` 分支接自愈：
   - `find_welcome_enter_button()` 命中 → prev_fg 记录 → `_set_foreground_window(login_hwnd)`
     （复用现有 AttachThreadInput 实现）→ `btn.click_input()` → 轮询 `get_main_window()` 最长 20s →
     成功则接修 A 的最大化 + 还原 prev_fg（按 `_should_restore_foreground`）+ 计数清零。
   - 3 次失败 → log 显式告警行 + diag 新字段 `welcome_click_fails`（中台可见），不再静默挂死。
   - 未命中（真隐私锁）→ 维持现状（提示人工关隐私保护）。

## 修 C：回顶导航按钮窗口相对坐标 + 前台点击 + 切换验证（P1）

**根因（实证）**：`_find_left_nav_button_point` 的 `left_max=90` 判**屏幕绝对坐标**，
窗口不贴屏幕左边缘必"导航按钮不全"；且 PostMessage 点击不抢前台时对导航按钮无效。

**实现**：
1. `_find_left_nav_button_point(buttons, name, left_max=90, win_left=0)`：
   判定改 `r.left - win_left < left_max`（纯函数，向后兼容 win_left=0）。
2. `_reset_session_list_to_top`：
   - 调用时传 `win_left=mw.rectangle().left`；
   - 点击前 prev_fg 记录 + `_set_foreground_window(main_hwnd)`，收尾按
     `_should_restore_foreground` 还原（与 reply 路径同款焦点纪律）；
   - 点击升级梯：先 `_click_screen_point`（PostMessage，前台态下）→ 用
     `_on_contacts_tab(mw)`（"通讯录管理" Button 存在；切换后列表在顶部该按钮必在树里）
     验证切换生效；未生效 → 回退 `btn.click_input()`；
   - 保持原子不变量：任一步失败绝不把微信留在通讯录 tab（回程"微信"按钮同升级梯 + 重试）。
3. 不引入任何滚动（铁律：回复循环不准滚动/开群）。

## 测试策略（TDD，commit-1 红 / commit-2 绿）

CI 单测（vitest 不适用，纯 python：pytest 风格随现有 tests/ 目录惯例）：
- `tests/test_nav_button_relative.py`：窗口 x=964 时旧绝对逻辑找不到（回归记录）、
  新 win_left 相对逻辑找到；win_left=0 兼容不变。
- `tests/test_welcome_screen_heal.py`：classify_login_window 三态 +
  should_attempt_welcome_click 重试/冷却/上限真值表。
- `tests/test_window_maximize_heal.py`：window_needs_maximize 真值表
  （zoomed→False / iconic→False / 可见非最大化→True）+ diag 字段透传。

环境接缝守卫（真机）：
- heartbeat diag 新字段（window_state / welcome_click_fails）= 打包进 agent 的运行时自检上报。
- job3 真机气泡可读性 gate（xian-rog）在本 PR 必须真跑通——修 C 正是它持续失败的根因，
  它由此从"连坐挡道"恢复为有效闸门（proven-to-fire：它已经红过 6 次）。

## 版本
- line04 manifest.json bump 1.0.113 → 1.0.114（CI 闸 lint-line04-manifest-version-bump 强制）。

## 不包含
- iconic（托盘）态的 normal placement 尺寸矫正（未实证，观测字段先行，后续按数据立案）。
- §2.I 的 sender 名字识别错 / 待发队列过期（独立立案）。
- 滚动机制任何改动。
