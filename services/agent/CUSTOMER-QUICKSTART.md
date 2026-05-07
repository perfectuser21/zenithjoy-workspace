# ZenithJoy Agent 客户启动指引（30 分钟跑通版）

> Walking Skeleton #1 thin 阶段：先用命令行跑通，后续再做 .dmg 安装包。

## 前置条件

- macOS 12+（Apple Silicon 或 Intel 都行）
- Node 18+（自查：`node -v`，输出 `v18.x` 或更高）
- Google Chrome 已安装
- 一个**测试用**抖音账号（⚠️ 第一次跑请用小号，不要用主号 / 公司主号）

## 5 步操作

### Step 1: clone 仓库 + 装依赖

```bash
git clone https://github.com/perfectuser21/zenithjoy-workspace.git
cd zenithjoy-workspace/services/agent && npm install
```

### Step 2: 拿 license

浏览器打开 <https://autopilot.zenjoymedia.media> → 注册账号 → 登录后 Dashboard 显示 license（格式 `ZJ-F-XXXXXX`）→ 复制留用。

### Step 3: 启动 Chrome 调试模式

```bash
open -na "Google Chrome" --args --remote-debugging-port=19222 --user-data-dir=$HOME/zenithjoy-chrome-profile
```

- 在打开的 Chrome 窗口里登录抖音创作者后台 <https://creator.douyin.com>（用测试账号）
- **保留这个 Chrome 窗口不要关**，Agent 需要复用它发布视频

### Step 4: 启动 Agent

```bash
ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media \
ZENITHJOY_LICENSE=<你的-license-key> \
ZENITHJOY_AGENT_REAL_PUBLISH=1 \
npm start
```

看到日志「heartbeat OK / agent_id=xxx」= 成功。

> 💡 觉得手敲环境变量太麻烦？用 `bash scripts/customer-start.sh` 一键启动（先 `export ZENITHJOY_LICENSE=ZJ-F-XXXXXX`）。

### Step 5: 在 Dashboard 上完成绑定 + 发视频

1. 浏览器回到 <https://autopilot.zenjoymedia.media> → Agent 页面 → 看到自己的 agent online
2. 点「扫码绑定抖音」→ 用前面那个 Chrome 完成
3. 点「绑文件夹」→ 选本地一个目录，丢 1 个 mp4 进去（文件名英文，避免空格）
4. 点「发布」→ 等 1-2 分钟 → 抖音 APP 看测试号首页应有此视频

## 常见问题

- **`lsof -i:19222` 端口被占** → kill 旧进程：`lsof -ti:19222 | xargs kill -9`
- **Chrome 没扫码登录抖音** → Step 3 启动后必须手动登录抖音创作者后台
- **heartbeat 401** → license 拼错或服务端没拿到 Bearer header，复查 Step 4 的 `ZENITHJOY_LICENSE`
- **视频发不出去** → 看 agent 日志最后一行 JSON `{"ok":false,"error":"..."}`，按 error 字段排查

## 反馈

走通 / 卡住 / 有想法都欢迎反馈到 GitHub issue 或群里 @陈梦阳。
