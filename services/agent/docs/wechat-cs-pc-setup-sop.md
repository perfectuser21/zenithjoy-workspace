# 微信 AI 客服 — 全新 PC 部署 SOP

> 目标读者：给客户装机的实施人员，或内部测试新机器。
> 目标状态：和 xian-rog（当前生产机）完全一致的运行状态。

---

## 一、当前功能一览（所有运行模式）

装完后的机器具备以下能力，与 xian-rog 当前状态一致：

| 能力 | 说明 |
|---|---|
| **后台静默回复** | 微信可最小化、可在后台，AI 仍能读消息、发回复，不抢鼠标/键盘焦点 |
| **自动回复模式（auto）** | 监听到私聊 → POST 中台 `/api/wechat/draft-generate?mode=auto` → DeepSeek 生成回复 → 直接发出 |
| **草稿审核模式（review）** | 监听到私聊 → POST 中台 → 写飞书待审台，人工审后才发（未来功能，当前默认 auto） |
| **防重复回复（dedup）** | 同一 sender 成功回复后 **30 秒内**跳过相同或新消息，防止两条重复 AI 回复 |
| **已回复持久化** | 重启 listener 后不会对同一条消息再回，已回复集合存 `C:\Users\Public\zj-replied.json` |
| **崩溃自愈** | listen_chat.py 退出/崩溃 → 30 秒内 watchdog 自动重启，无需人工介入 |
| **开机自启** | 用户登录 Windows 即自动启动监听，无需任何手动操作 |
| **心跳上报** | 每 60 秒向中台 `/api/wechat/listener-heartbeat` 上报存活+诊断数据 |
| **微信自启** | 监听进程检测到微信未运行时，自动 spawn `Weixin.exe`，用户扫码即可 |

### 后台发送原理（v1.1.97+）

```
SetValue(reply_text)              ← 把文字写入微信输入框（UIA ValuePattern，不碰焦点）
AttachThreadInput(my_tid, wx_tid) ← 把当前线程挂到微信线程的消息队列
SetFocus(main_hwnd)               ← 临时把焦点给微信主窗口
PostMessage(WM_KEYDOWN, VK_RETURN)← 后台模拟回车，触发发送
AttachThreadInput(detach)         ← 立刻解挂，焦点归还给原窗口
验证 get_value() == ""            ← 输入框清空 = 发送成功，否则走兜底
```

**结果**：前台用户正在玩游戏、打字、操作其他窗口，完全感知不到微信在后台回复消息。

---

## 二、环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11（64 位） |
| 微信版本 | **必须 = 4.1.8.107**（4.1.9 / 4.1.10 的 UIA 控件树被砍，pywinauto 读不到消息） |
| 网络 | 能访问 `autopilot.zenjoymedia.media`（中台 HTTPS + WSS） |
| 安装包版本 | **≥ v1.1.97**（含 AttachThreadInput + 30s dedup + replied 持久化） |
| 其他 | 不需要额外安装 Python / Node.js，安装包内置 |

---

## 三、安装步骤（从零到跑通）

### 步骤 1：安装正确版本的微信

> **为什么必须锁版本**：微信 4.1.10 把 UIA Automation Provider 迁到新架构，
> 导致 pywinauto 读不到聊天列表控件树。4.1.8.107 是当前最新可用版本。

1. 从官方降级包下载（内部存档）安装 WeChat 4.1.8.107
2. 安装完后**锁版本**，防止自动更新：
   ```
   打开微信 → 帮助 → 关于 → 关闭自动更新
   ```
   或用注册表彻底禁更新（见下方「运维 Q&A」）
3. 扫码登录微信，确保能正常收发消息

---

### 步骤 2：下载安装包

从 Dashboard 下载最新安装包：
```
https://autopilot.zenjoymedia.media/dashboard/agent
```
点「下载完整安装包」→ 下载 `zenithjoy-agent-v1.1.97+.zip`（版本号以实际为准）

解压到稳定路径，例如：
```
C:\ZenithJoy\
  zenithjoy-agent-v1.1.97\
    start.bat
    install-autostart.ps1
    listener-watchdog.bat
    wechat-rpa\
      listen_chat.py
    python-embedded\
      python.exe
    .env.template
    ...
```

---

### 步骤 3：填写 License

```
把 .env.template 复制一份，改名为 .env
用记事本打开 .env，找到：
  ZENITHJOY_LICENSE=__PLACEHOLDER__
改成你的真实 License Key（Dashboard "License" 页查看）
保存
```

或者直接双击 `start.bat`，首次运行时会交互式提示输入并自动写入。

---

### 步骤 4：首次启动 Agent（连接中台 WebSocket）

> **架构说明**：微信监听（`listener-watchdog.bat` → `listen_chat.py`）和 Agent 主进程（`zenithjoy-agent.exe`）是**两个独立进程**。
> - 微信回复功能只需要 `listener-watchdog.bat`，它直接调中台 API，不依赖 agent 主进程。
> - `start.bat` 负责启动 agent 主进程（用于 Dashboard 连接、视频流水线、发布任务等）。
>
> 如果你**只需要微信 AI 回复**，可以跳过此步骤，直接到步骤 5。

**双击 `start.bat`**（需要 Dashboard 连接或视频功能时运行）

`start.bat` 会自动完成：
1. 验证 License（向中台预检，失败直接报错）
2. 解压内置 Node.js 运行时（首次约 30 秒）
3. Narrator 快开快关（备用 UIA 解锁，`listen_chat.py` 自己也会在启动时做这一步）
4. 启动 `zenithjoy-agent.exe`，连接中台 WebSocket

**验证**：打开 Dashboard → 看到「Agent 在线」即 Agent 部分就绪。

> **Narrator 解锁何时发生**：`listen_chat.py` 启动时会自动调 `_activate_uia()`，
> 用 PowerShell 开关一次 Narrator，无需手动操作。`listener-watchdog.bat` 拉起 `listen_chat.py` 后，解锁自动完成。

---

### 步骤 5：注册开机自启（微信监听守护）

以管理员身份运行 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ZenithJoy\zenithjoy-agent-v1.1.97\install-autostart.ps1"
```

输出：
```
[autostart] 已注册开机自启任务 ZenithJoyWeChatListener
[autostart]   触发: 登录时（ONLOGON），用户 asus
[autostart]   目标: C:\ZenithJoy\...\listener-watchdog.bat
```

这会在 Windows 任务计划程序里注册 `ZenithJoyWeChatListener`，用户每次登录后自动拉起 `listener-watchdog.bat`。

---

### 步骤 6：立刻启动监听（不等重启）

```
双击 C:\ZenithJoy\zenithjoy-agent-v1.1.97\listener-watchdog.bat
```

或在任务计划程序里手动运行 `ZenithJoyWeChatListener`。

`listener-watchdog.bat` 是死循环守护：
```
启动 listen_chat.py → 如果退出 → 等 30 秒 → 重启 → 循环
```

---

### 步骤 7：验证全链路

1. 用另一个微信号给本机微信发一条消息（如「你好」）
2. 等待 5~15 秒（中台调 DeepSeek 时间）
3. 对方收到 AI 回复 ✅

**查日志**（实时）：
```
C:\Users\Public\zj-listener.log
```

正常日志长这样：
```
[2026-06-06 12:30:01] [listen_chat] start polling (pywinauto), middleware=https://autopilot.zenjoymedia.media
[2026-06-06 12:30:05] unread: 1 sender=张三 content=你好
[2026-06-06 12:30:07] _uia_send: AttachInput+Enter 成功（后台静默）
[2026-06-06 12:30:07] auto-replied OK sender=张三
```

---

## 四、系统文件位置一览

| 文件 | 路径 | 说明 |
|---|---|---|
| 监听日志 | `C:\Users\Public\zj-listener.log` | 实时运行日志，每条操作有时间戳 |
| 已回复集合 | `C:\Users\Public\zj-replied.json` | (sender, content) 已回复记录，重启不丢 |
| Agent 日志 | `%USERPROFILE%\.zj\agent.log` | Agent WebSocket 连接日志 |
| 任务计划名称 | `ZenithJoyWeChatListener` | 任务计划程序 → 任务计划程序库 里查看 |

---

## 五、运维 Q&A

**Q: 微信更新了怎么办？**
A: 微信自动更新到 4.1.10+ 后监听会失效（读不到消息）。需降回 4.1.8.107。
永久禁更新（注册表）：
```powershell
# 以管理员运行
reg add "HKLM\SOFTWARE\Policies\Tencent\WeChat" /v DisableUpdate /t REG_DWORD /d 1 /f
```

**Q: 任务计划程序里的任务消失了怎么办？**
A: 重新运行 `install-autostart.ps1`：
```powershell
powershell -ExecutionPolicy Bypass -File install-autostart.ps1
```

**Q: 改了 .env 里的 License / 中台地址，要重启吗？**
A: 需要。`listener-watchdog.bat` 启动时读一次 `.env`，之后修改不生效。
在任务计划程序里「结束任务」再「运行」，或重新登录 Windows。

**Q: 想手动停止监听？**
A: 打开任务计划程序 → `ZenithJoyWeChatListener` → 结束任务。
或 `taskkill /F /IM python.exe`（会杀所有 Python 进程，注意）。

**Q: 注销开机自启？**
```powershell
powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Unregister
```

**Q: 升级安装包？**
A: 解压新版到新目录 → 复制旧 `.env` 到新目录 → 注销旧自启 → 用新路径注册新自启。
旧 `zj-replied.json` 和 `zj-listener.log` 在 `C:\Users\Public\`，自动继承。

**Q: 开机后微信没登录，AI 还能回复吗？**
A: 不行。`listen_chat.py` 检测到微信未运行时会自动 spawn `Weixin.exe` 并等扫码，
但需要有人扫码才能开始监听。建议：
- 设置微信自动登录（记住密码 / 免扫码模式）
- 或用手机扫码登录后再重启监听进程

---

## 六、安装包版本说明

| 版本 | 包含内容 | 能力 |
|---|---|---|
| ≤ v1.1.80 | 基础监听 | SetValue + button.Invoke 发送（前台模式，会抢焦点） |
| v1.1.95+ | 改 AttachThreadInput | 后台静默发送，WeChat 最小化也能发出 |
| v1.1.97+ | + replied 持久化 + 30s dedup | 防重复回复，重启不重发，推荐版本 |

**务必使用 v1.1.97+。**

---

## 七、与 xian-rog 的对照关系

xian-rog 目前的生产配置是本 SOP 所描述状态的手工版本：
- 任务名：`ZJlisten`（老名，功能等同于 `ZenithJoyWeChatListener`）
- 守护脚本：`C:\Users\Public\sl4.bat`（等同于 `listener-watchdog.bat`）
- listen_chat.py 路径：`C:\Users\asus\Downloads\zenithjoy-agent-v1.1.95\wechat-rpa\listen_chat.py`

新客户机按本 SOP 走，得到完全一致的功能，且路径更整洁。
