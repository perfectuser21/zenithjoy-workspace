# Lead 真机自验 — 微信 4.0 隐形 AI 客服（pywinauto + auto-reply）

> Path 4 Step 5：私聊自动回复。真机微信 E2E 进不了 CI（Linux 沙箱无微信桌面端），
> 由 Lead 在 xian-rog（Lead 自检机）真机自验并在此留证。CI 只跑 scan_unread / 频控纯逻辑
> 单测 + listen_chat --dryrun + apps/api auto-reply integration。

## 测试设备

- 机器：xian-rog（Lead 自检机；将来真客户 worker 形态样本是 xian-pc）
- 系统：Windows 10 + 微信 4.0（Weixin.exe）
- 运行时：Python 3.12 + pywinauto(uia)（`pip install pywinauto -i https://pypi.tuna.tsinghua.edu.cn/simple`）
- 中台：本机 apps/api（local_api），OpenRouter DeepSeek key 来自 1Password「OpenRouter API Key」

## 前置条件

- [ ] 微信 4.0 已扫码登录（主窗口 class_name = `mmui::MainWindow`，非 `mmui::LoginWindow`）
- [ ] 讲述人（Narrator）已开 ≥5 分钟再关（解锁 UIAutomation，否则微信 4.0 读不到元素）
- [ ] zenithjoy-agent 以"登录微信的那个 Windows 用户"身份运行（否则 click_input 报"拒绝访问"）
- [ ] 飞书「客户档案」表内已有该测试客户名（名单 SSOT；名单外不回）
- [ ] 飞书「互动记录」表可写（auto-reply 复用最近 10 轮上下文 + 入库）

## 测试步骤

1. 启动 listen_chat.py 真模式（非 --dryrun），确认 stderr 打印 `pywinauto version: ...`
2. 用另一台手机/小号，以名单内客户身份给本人微信发一条私聊"你好"
3. 观察：会话跳顶 + 出现 `[N条]` 未读 → listener `scan_unread` 解析出 {sender, content}
4. 中台 `/api/wechat/draft-generate?mode=auto` 返回 reply 文本（带飞书最近 10 轮上下文）
5. listener `reply_in_chat`：select 打开会话 → `chat_input_field` set_text → 点"发送" → 客户收到"本人"回复
6. 异常用例：讲述人失效（读不到 `chat_input_field`）→ stderr 告警；微信掉线 → `get_main_window()` 返 None 跳过

## 截图

- [ ] 截图 1：listener 启动日志（stderr pywinauto version + start polling）
- [ ] 截图 2：客户手机端收到 AI 回复的会话（证明对方视角是"本人"回的，隐形）
- [ ] 截图 3：频控生效证据（同一号 1 分钟内第 3 条被 `rate_limited` 拦）

## 飞书互动记录

- [ ] 互动记录表新增行：客户名 / 客户原话 / AI 草稿（= 实际发出的 reply）/ 生成时间 / 状态 pending_review
- [ ] 截图：飞书 Bitable「互动记录」对应行链接或截图

## 结论

- [ ] 全链路通过（读未读 → DeepSeek 带上下文回 → 自动发出 → 客户收到，隐形）：是 / 否
- [ ] 频控 ≤2 私聊/分钟、操作间隔 ≥1s 真机生效：是 / 否
- [ ] 备注 / 遗留问题：
- 自验人：________  日期：________
