# ZenithJoy Agent 客户启动指引（30 分钟跑通版）

> Walking Skeleton #1 thin 阶段：先用命令行 / 批处理跑通，后续再做 .exe / .dmg 一键安装包。

## 选择你的系统

- **Windows 10 / 11**（推荐 — 客户主流） → 见下方 [Windows 启动](#windows-启动主流程)
- **macOS 12+**（开发者备用） → 见下方 [macOS 启动](#macos-启动开发者备用)

---

## Windows 启动（主流程）

### 前置条件

- Windows 10 或 Windows 11
- Node.js 18+（[官网下载 LTS](https://nodejs.org/)，安装时勾选 "Add to PATH"）
- Google Chrome 已装在默认路径
- 一个**测试用**抖音账号（⚠️ 第一次跑请用小号，不要用主号 / 公司主号）

### 5 步操作

#### Step 1: 注册 + 拿 license + 下载 Agent

1. 浏览器打开 <https://autopilot.zenjoymedia.media> → 注册账号 → 登录
2. Dashboard → "Agent 客户端" 页 → 复制 license（格式 `ZJ-F-XXXXXX`）
3. 同页面点 **「下载 Agent v0.1.0 (.tar.gz)」** → 拿到 `zenithjoy-agent-v0.1.0.tar.gz`

#### Step 2: 解压 + 装依赖（cmd 或 PowerShell 都行）

Windows 10 1709 / Windows 11 自带 `tar.exe` 命令：

```cmd
cd %USERPROFILE%
tar -xzf Downloads\zenithjoy-agent-v0.1.0.tar.gz
cd zenithjoy-agent
npm install
```

如果 `tar` 找不到 → 用 7-Zip / 资源管理器自带的"全部解压"，把 tar.gz 解压到任意目录后 `cd` 进去。

#### Step 3: 一键启动（推荐）

```cmd
set ZENITHJOY_LICENSE=ZJ-F-你的key
scripts\customer-start.bat
```

脚本会：
1. 自动找 `chrome.exe`（默认路径或 LocalAppData 安装）
2. 启动 Chrome 调试模式（端口 19222），弹出新窗口
3. 启动 Agent npm 进程（前台运行，看日志）

**在弹出的 Chrome 窗口里登录** <https://creator.douyin.com>（用测试号），保留窗口不关。

> 💡 不想用脚本？手动版（cmd 里）：
> ```cmd
> set ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media
> set ZENITHJOY_LICENSE=ZJ-F-你的key
> set ZENITHJOY_AGENT_REAL_PUBLISH=1
> start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=19222 --user-data-dir="%USERPROFILE%\zenithjoy-chrome-profile"
> npm start
> ```

#### Step 4: 看日志确认握手

终端日志出现 `heartbeat OK / agent_id=xxx` = Agent 跟 autopilot 握手成功。

#### Step 5: 在 Dashboard 完成绑定 + 发视频

1. 浏览器回 <https://autopilot.zenjoymedia.media> → Agent 客户端页 → 看到自己的 agent 状态变绿（已连接）
2. 「扫码绑定抖音」→ 用 Step 3 那个 Chrome 完成
3. 「绑文件夹」→ 选一个本地目录（比如 `C:\Users\你\Desktop\test-videos`），丢 1 个 mp4 进去（文件名英文，避免空格）
4. 「发布」→ 等 1-2 分钟 → 抖音 APP 看测试号首页应该有这条视频

### Windows 常见问题

- **`tar` 命令找不到** → Windows 版本太老（< 1709），用 7-Zip 解压
- **`netstat` / `findstr` 命令找不到** → cmd 默认带，不会丢；如果丢了用 PowerShell
- **chrome.exe 找不到** → 装在非默认路径。打开 customer-start.bat，把 `set CHROME_EXE=` 一行改成你实际路径
- **`npm install` 报 node-gyp build failed** → 装 [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（C++ 桌面开发负载）
- **heartbeat 401** → license 拼错或服务端没拿到 Bearer header
- **视频发不出去** → 看 agent 日志最后一行 JSON `{"ok":false,"error":"..."}`，按 error 字段排查

---

## macOS 启动（开发者备用）

### 前置条件
- macOS 12+（Apple Silicon 或 Intel 都行）
- Node 18+（`node -v` 自查）
- Google Chrome
- 测试用抖音账号

### 操作

```bash
tar -xzf ~/Downloads/zenithjoy-agent-v0.1.0.tar.gz -C ~ && cd ~/zenithjoy-agent
npm install
export ZENITHJOY_LICENSE=ZJ-F-你的key
bash scripts/customer-start.sh
```

`scripts/customer-start.sh` 会自动启动 Chrome 19222 + agent npm start。其余步骤同 Windows 第 4-5 步。

### macOS 常见问题

- `lsof -i:19222` 端口被占 → kill：`lsof -ti:19222 | xargs kill -9`
- 其他与 Windows 一致

---

## 反馈

走通 / 卡住 / 有想法都欢迎反馈到 GitHub issue 或群里 @陈梦阳。
