# PrepPRD：微信个微客服「窗口可见 + 不抢焦点 + 真送达可验证」生产化

> 本 PRD 由 2026-06-21 一次超长真机调试 session 收敛而来。**先读"关键修正"再动手，别重走弯路。**

## 0. 关键修正（血泪，别再犯）
1. **不要降微信版本。** 微信 4.1.x 已全线升 Qt 渲染（`mmui::MainWindow` 没了，主窗口是 `Qt51514QWindowIcon`）。xian-pc 和 xian-rog **两机二进制完全相同、都是 Qt**。这是腾讯**按账号灰度、服务端下发**的，降版本/封补丁/禁更新器全部失败（patch 每次登录自动重下重装）。**花几小时降版本=纯浪费，禁止再碰。**
2. **Qt 上 UIA 照样能用。** "4.1.10 砍了 UIA"是错的——实测 `SetValue` 写入成功、消息真送达。所以**不需要 mmui，直接在 Qt 上做。**
3. **不要"静默/藏窗口"。** 把窗口挪屏外/DWM cloak 是错方向：用户看不了、没法验证送达、还卡死（窗口留屏外+cloak 打不开）。
4. **`sent=True` ≠ 真送达。** `_uia_send` 的 sent=True 只是"输入框清空+发了Enter"自报。**必须读回会话验证原文真出现。**

## 1. 目标（用户语言）
个微客服在客户 Windows 机上：窗口**留屏上你随时能看**，AI 回消息时**不抢你的鼠标键盘、不抢你正在用窗口的焦点**，而且**能确认消息是真发出去了**（不是假的 sent=True），**回给对的人、不回自己、有频控防封**。

## 2. 需求清单（9 条，verbatim from skill 当前正确定义）
**机制层：**
1. 不抢键盘鼠标 —— 纯 UIA `SetValue` + `PostMessage`（往微信窗口消息队列塞回车），不碰系统鼠标/光标/全局键盘。**已满足**，是多 agent 同机共存命脉。
2. 不抢前台焦点 —— 窗口可见，回复完 `SetForegroundWindow(操作前的前台窗口)` 把焦点还回去。（Qt 上切会话只能 `Select()`，会短暂抢前台 ~2s，用"还焦点"抵消；PostMessage 点击在 Qt 上坐标打不中、切不动，别指望它切会话。）
3. 窗口可见（不藏）—— 最小化只用 `SW_SHOWNOACTIVATE(4)` 还原，不挪屏外、不 cloak。
4. **真送达确认** —— 发完读回目标会话预览/气泡，确认发送原文真出现才算成功，替掉 `sent=True`。
**正确性层：**
5. 回对人/防串台 —— `_open_chat` 切到目标 + `_chat_title_matches` 校验命中才发（已有逻辑，保留）。
6. 不回自己/防自回复风暴 —— 靠未读角标只对别人来的会话动手 + 去重（见 skill 故障模式 1/2）。
7. 频控防封 —— 每分钟 ≤N 条、间隔 ≥1s。
**内容/审核层（产品决策，需用户拍板）：**
8. AI 回复内容（DeepSeek 拼对话历史）。
9. **审核台 vs 直接自动发** —— Path 4 设计是"AI 拟草稿→飞书审批→才发"，本 sprint 是否启用？（默认先直接自动回，审核台后续加？需用户定）

## 3. 已验证（带证据，别重测）
- **发送真送达**：`verify3` 读回 `默忆preview: '默忆\nTest 1234 verify\n12:45'` → `DELIVERED: True`（读回确认，非自报）。
- **B 安全（不抢焦点不致命）**：全 repo 搜，发布 agent（抖音/快手/微博/私信触达 douyin-publish.ts 等）**全是 Playwright/CDP 后台驱动 Chrome**，不依赖前台；唯一带前台输入模式的只有微信 RPA 自己（且是窗口定位非全局键鼠）。微信抢焦点不影响发布。
- **Qt 上切会话**：`_open_chat` 用 `Select()` 能切（verify3 `title_match=True`）但短暂抢前台；`_post_click_item`（PostMessage 点击）在 Qt 上 `title_match=None`（切不动）。

## 4. 实现任务（services/agent/wechat-rpa/listen_chat.py + 部署）
1. **B 窗口可见模式**：`_ensure_tray_visible` 去掉挪屏外/cloak；最小化只 `SW_SHOWNOACTIVATE(4)`。（或加配置开关，默认 visible-no-steal。）
2. **不抢焦点**：`reply_in_chat` 开头 `prev=GetForegroundWindow()`，finally 里 `if prev and prev!=微信hwnd: SetForegroundWindow(prev)`。
3. **真送达验证硬步骤**：`reply_in_chat` 返回 True 前，读回目标会话预览/气泡确认原文出现；不出现 → 返回 False（视为未送达，下轮重试）。改造/强化现有 `_verify_sent`。
4. 保留：`_open_chat`+`_chat_title_matches` 防串台、未读角标不回自己、`rate_limiter` 频控。
5. **版本 bump 6 处**（manifest×2 + walking-skeleton.service.ts/.test.ts + heartbeat-modules.test.ts + heartbeat-module-health-smoke.sh）+ `diff -r` 同步 build-modules/line04 + 重打包 + **重启 mmv 中台进程**（见 memory feedback_module_bump_needs_mw_redeploy）+ agent 重新部署。

## 5. 真机测试方法（踩过的坑，照做）
- **机器**：xian-rog（`asus@100.98.253.95`，Lead 自检机，agent 在 `C:\Users\asus\zj-agent\zenithjoy-agent-v2.0.19\`，PsExec `C:\Users\asus\PSTools\PsExec64.exe`，嵌入 python 在 agent 的 `python-embedded\`，有 pywinauto）；xian-pc（`xuxia@100.97.242.124`，python `C:\Program Files\Python312\python.exe` 有 pywinauto 0.6.9，wechat-rpa 代码可 scp 到 `C:\Users\xuxia`，PsExec `C:\Users\Public\PsExec64.exe`）。
- **必须 session 1**：`PsExec64.exe -i 1 -accepteula <bat/exe>`（SSH 在 session 0 看不到 session 1 微信）。
- **pythonw 隐藏跑的致命坑**：`listen_chat` import 时 `_emit_version_to_stderr()` 会 `sys.stderr.write`，**pythonw 的 sys.stderr=None → import 直接崩、不报错**；脚本读到的是**上次 python.exe 跑留下的旧输出 → 假"成功"信号**。解法：脚本开头 `sys.stderr = 同一个日志文件`。（顺手把 listen_chat 这个 stderr 崩点也修了：`_emit_version_to_stderr` 加 `if sys.stderr` 守卫。）
- **get_main_window 偶尔 None**：加重试（找窗瞬时失败）。
- **真送达验证**：发完读"默忆"会话项的 `element_info.name`（含最后消息预览），原文 substring 命中 = DELIVERED。
- **SSH 输出 GBK 乱码**：复杂命令 base64 投递脚本进去跑，别内联中文；读输出 `grep -avE "^ϵͳ|^���"`。

## 6. DoD（接缝断言 + 逻辑断言，治"假环境宣布胜利"）
**接缝断言（真机 xian-rog 真守护，必须真验，proven-to-fire）：**
- [ ] 真守护跑起来，给"默忆"回一条 → **读回确认真送达**（不是 sent=True）
- [ ] 回复全程**微信窗口留屏上、可正常打开**（不藏不卡）
- [ ] 回复完**焦点归还**（操作前前台窗口仍是前台）
- [ ] **不抢键鼠**：同机同时跑一个 CDP 浏览器自动化，微信回复时浏览器不受扰
- [ ] 切到的是**正确联系人**（防串台）
**逻辑断言（CI 单测）：**
- [ ] 真送达验证逻辑（读回原文命中才 True）
- [ ] 防串台标题校验、频控限速

## 7. Skill 参考
已更新 `~/.claude-account1/skills/wechat-uia-silent-send/SKILL.md` 顶部「当前正确定义」（覆盖旧藏窗口框架）。开发时以顶部为准，下方机制（_uia_send/_open_chat/防串台/频控/故障模式）仍有效。
