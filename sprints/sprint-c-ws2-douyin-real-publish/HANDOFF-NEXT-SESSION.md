# Sprint 2.1a 接力文档（新会话从这里开始）

**写于**: 2026-05-08 11:30
**当前分支**: `cp-05080845-ws2-sprint-21a-ws1`
**目标**: 完成 e2e 真实测（rog Windows 真机 + 手机扫码 + 真发抖音视频）

---

## TL;DR — 你要干的 3 件事

1. **RDP 到 rog（西安 Windows 玩家机，Tailscale `rog-xian`）** 启动 Agent
2. **浏览器注册新账号** + 配 license_key + 重启 Agent
3. **触发"绑定抖音" + 手机扫码 + 选视频 + 真发** → 把过程归档到 `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md`

完成后开 PR 合并到 main。

---

## 已完成（不要重做）

| ✅ | 内容 | 位置/证据 |
|---|---|---|
| ✅ | PRD v3 + Contract round 2 APPROVED + 5 ws 实现 + 测试 + task-plan | 12 个 commit on `cp-05080845-ws2-sprint-21a-ws1` |
| ✅ | DB migration 跑完 | `psql -d cecelia -c "\d zenithjoy.publish_tasks"` 显示 type 字段 + CHECK + 索引 |
| ✅ | mac mini API 重启加载新代码 | PID 88922，`curl localhost:5200/api/account/me` → 401（活的）|
| ✅ | rog Agent 代码 sync | `~/Desktop/zenithjoy-agent/src/handlers/douyin-publish.ts` 含 `[type-route]` 日志 |
| ✅ | rog .env 配好 | `ZENITHJOY_API_BASE=http://100.71.151.105:5200` + CDP_URL |
| ✅ | rog Chrome :19222 启动 | 独立 user-data-dir `C:\Temp\zenithjoy-chrome`，不影响日常 Chrome |

---

## 待办（按顺序，约 30 分钟）

### Step 1: RDP 到 rog（你的物理位置 / Microsoft Remote Desktop）

```
rog-xian
Tailscale IP: 100.98.253.95
User: asus（看 ssh config 是 zenithjoy21xx，但 home dir 是 C:\Users\asus）
```

如果 ssh 也行（不需 GUI 调试时）：`ssh rog-xian`

### Step 2: 验 + 装依赖（如果 npm install 没跑过）

```powershell
cd $HOME\Desktop\zenithjoy-agent

# 验 node_modules 是否完整
Test-Path node_modules\playwright  # 应 True
Test-Path node_modules\tsx          # 应 True
Test-Path node_modules\ws           # 应 True

# 如果任一 False
npm install --no-audit --no-fund
```

### Step 3: 启 Agent（前台跑，看实时 log）

```powershell
cd $HOME\Desktop\zenithjoy-agent
npm start
```

**期望 log**：
```
[agent] starting...
[agent] heartbeat → http://100.71.151.105:5200
[agent] heartbeat ok, agent_id=...
```

**坑 1**：如果报 `LICENSE_KEY required` 之类 — 跳到 Step 4 拿 license 后回来重启 Agent。

**坑 2**：如果报 connection refused — 检查本机 mac mini API 是否还在跑：
```powershell
# rog 上测连通
Invoke-WebRequest -Uri http://100.71.151.105:5200/api/account/me -UseBasicParsing
# 期望 401
```

如果 mac mini API 挂了，回 mac mini 跑：
```bash
cd /Users/administrator/perfect21/zenithjoy/apps/api
nohup node dist/index.js > /tmp/zenithjoy-api.log 2>&1 &
```

### Step 4: 浏览器注册新账号（在 rog 已启的 Chrome :19222 里）

打开新 tab → 访问中台 Dashboard：

```
https://autopilot.zenjoymedia.media
（或者直接 http://100.71.151.105:5200，但需要前端，dashboard 走 hk）
```

操作：
1. 用全新邮箱（如 `lead-2.1a-$(date +%s)@zenithjoy.test`）注册
2. 密码任意（如 `Smoke!Test2026`）
3. 注册成功后 → 打开个人中心拷 `license_key`
4. 回 PowerShell，停 Agent (Ctrl-C)，编辑 .env：
   ```powershell
   notepad $HOME\Desktop\zenithjoy-agent\.env
   # 加一行：LICENSE_KEY=<拷的 license_key>
   ```
5. 重启 Agent: `npm start`

### Step 5: 触发"绑定抖音" → 手机扫码

在 Dashboard：
1. 找"绑定抖音"按钮（如果 UI 没做，直接 curl 触发）：
   ```powershell
   curl.exe -X POST http://100.71.151.105:5200/api/publish/task `
     -H "Content-Type: application/json" `
     -H "Cookie: <你登录后的 cookie>" `
     -d "{\"agent_id\":\"<你的 agent_id>\",\"platform\":\"qr_bind_douyin\",\"payload\":{}}"
   ```

2. Agent 控制台会输出：
   ```
   [qr-login] navigating to https://creator.douyin.com/
   [qr-login] not logged in, screenshot saved: C:\Users\asus\.zenithjoy\cookies\douyin-qr-*.png
   [qr-login] waiting for login (90s timeout)...
   ```

3. **打开 QR 截图文件** → 拿手机抖音 App 扫码登录

4. Agent 检测到登录 → 输出：
   ```
   [qr-login] login detected after scan
   [type-route] handleQrBindDouyin task=<id> qr_login=success cookie_local_path=...
   ```

5. **截图保存这一段 console log + QR 截图文件**（存为 evidence）

### Step 6: 真发抖音视频（核心 P0 bug 验证）

准备一个本地 mp4：
```powershell
# 从你日常抖音素材文件夹拷一个，或用 ffmpeg 生成测试视频
copy C:\Users\asus\Videos\test.mp4 C:\Temp\smoke-2.1a.mp4
```

在 Dashboard 触发发布（如果 UI 没做，curl 触发）：
```powershell
curl.exe -X POST http://100.71.151.105:5200/api/publish/task `
  -H "Content-Type: application/json" `
  -H "Cookie: <cookie>" `
  -d "{\"agent_id\":\"<id>\",\"platform\":\"douyin\",\"type\":\"video\",\"payload\":{\"video_path\":\"C:\\\\Temp\\\\smoke-2.1a.mp4\",\"title\":\"sprint-2.1a-smoke\",\"tags\":[\"测试\"]}}"
```

**关键验证**：
- 中台返回 `{"task_id":"...","status":"pending","type":"video"}` ← **type 必须是 video**
- Agent 控制台输出：
  ```
  [type-route] handleDouyinPublishTask task=... type=video
  [type-route] resolveDouyinScriptPath type=video real=true script=publish-douyin-video.cjs
  ```
  ← **必须是 video.cjs，不是 image.cjs（P0 bug 防回归）**

**TODO**：`publish-douyin-video.cjs` 里有 selectors 占位符（`// TODO lead 自验填 selectors`），实际跑会停在上传页。lead 在这里要：
1. 用 Chrome DevTools (F12) 看抖音上传页真实选择器（`input[type=file]` / 标题输入框 / 发布按钮）
2. 编辑 `~/Desktop/zenithjoy-agent/publishers/douyin-publisher/publish-douyin-video.cjs`
3. 替换 TODO 段为真选择器
4. 重新触发发布
5. Agent 真上传视频 + 真点发布按钮 → 抖音返回视频 URL

### Step 7: 验证 + 归档 evidence

手机抖音 App 看见刚发的视频 → 拷视频公网 URL（如 `https://www.douyin.com/video/7234567890`）

编辑 evidence 文件：
```powershell
notepad C:\Users\asus\Desktop\zenithjoy-agent\.agent-knowledge\golden-path-1\lead-acceptance-sprint-2.1a.md
```

或在 mac mini 编辑（同步 git）：
```bash
cd /Users/administrator/perfect21/zenithjoy
vim .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md
```

填 evidence template 里所有字段（参考文件本身的 placeholder）。

**关键内容**：
- ✅ ssh xian-pc 不通（但 rog 通） → 注：sprint contract 写的 worker_machine 是 xian-pc，实际用 rog，需在 evidence 注明决策
- ✅ 用真邮箱注册 + license_key
- ✅ 弹扫码窗 + 手机真扫码（**严禁** 写"用了预置 cookie"，validator 会拒）
- ✅ type=video 全程路由证据（`[type-route]` 日志摘录）
- ✅ 抖音公网 URL（含完整 https://...douyin.com/video/...）
- ✅ 手机抖音 App 视频截图（路径或 base64）

### Step 8: 跑 validator + 开 PR

```bash
cd /Users/administrator/perfect21/zenithjoy
git pull  # 拉最新（lead 在 rog 上 commit 的 selector 修改）
bash scripts/check-lead-acceptance.sh .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md
# 期望：OK: evidence 合格

# 开 PR
gh pr create --base main --head cp-05080845-ws2-sprint-21a-ws1 \
  --title "WS2 Sprint 2.1a — 修架构 + 抖音 video 真发 + Lead 自验" \
  --body "见 sprint-prd.md + lead-acceptance-sprint-2.1a.md"
```

---

## 可能踩的坑（按概率排序）

### 坑 A: rog 上 npm start 报 `tsx not found`

```powershell
# 强制 npm install
cd $HOME\Desktop\zenithjoy-agent
Remove-Item -Recurse -Force node_modules
npm install --no-audit
```

### 坑 B: Agent 启动后 heartbeat 401 / 403

LICENSE_KEY 没配 / 配错。检查 .env 里 LICENSE_KEY 跟 Dashboard 个人中心显示的一致。

### 坑 C: Chrome :19222 没起 / 已被关

```powershell
Get-Process chrome | Where-Object { $_.MainWindowTitle -ne "" } | ForEach-Object { Write-Output "$($_.Id): $($_.MainWindowTitle)" }
# 找不到带 zenithjoy 标题的 → 重启
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=19222","--user-data-dir=C:\Temp\zenithjoy-chrome"
```

### 坑 D: video.cjs 跑到 TODO 段就停

预期内 — 这是 walking-skeleton thin 的"丑 OK"。lead 现场补真选择器。

### 坑 E: 抖音风控（接 contract Risk R1）

Lead 自验时账号被风控 → evidence 标准降级（PRD ASSUMPTION 5）：
- 接受 "真发布请求 + 抖音返回处理中状态"
- 注明 "R1 触发"
- 不算 sprint FAIL

### 坑 F: 抖音 UI 改版导致选择器失效（接 contract Risk R3）

video.cjs 里写的选择器抖音改了 → Agent 截图存 `~/.zenithjoy/agent-fail-screenshots/` → lead 看截图找新选择器更新代码。

---

## 关键文件路径（mac mini）

| 文件 | 用途 |
|---|---|
| `sprints/sprint-c-ws2-douyin-real-publish/sprint-prd.md` | PRD v3 |
| `sprints/sprint-c-ws2-douyin-real-publish/contract-draft.md` | Contract round 2 APPROVED |
| `sprints/sprint-c-ws2-douyin-real-publish/HANDOFF-NEXT-SESSION.md` | **本文件** |
| `apps/api/db/migrations/20260508_014306_publish_tasks_add_type.sql` | 已跑 ✅ |
| `apps/api/src/services/walking-skeleton.service.ts` | 中台 createPublishTask 接 type |
| `apps/api/src/routes/walking-skeleton.ts` | API 路由 zod 校验 type |
| `services/agent/src/handlers/douyin-publish.ts` | Agent 路由按 type（修硬编码 bug） |
| `services/agent/publishers/douyin-publisher/lib/qr-login.cjs` | 扫码共享模块 |
| `services/agent/publishers/douyin-publisher/publish-douyin-video.cjs` | video 真发（含 TODO selectors） |
| `services/agent/publishers/douyin-publisher/publish-douyin-video-dryrun.cjs` | CI dryrun 用 |
| `.github/workflows/scripts/smoke/golden-path-1-smoke.sh` | smoke Step 6 升级了 type=video |
| `.agent-knowledge/golden-path-1/lead-acceptance-template.md` | 通用 lead 自验模板 |
| `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md` | **本 sprint evidence 占位（你填）** |
| `scripts/check-lead-acceptance.sh` | Validator 防作弊 |

## 关键 IP / 端口

| 角色 | IP / 域名 | 端口 |
|---|---|---|
| Mac mini API | `100.71.151.105` (Tailscale) | `5200` |
| Mac mini Brain | `100.71.151.105` | `5221` |
| Hong Kong Dashboard | `autopilot.zenjoymedia.media` | 443 |
| rog Tailscale | `100.98.253.95` | ssh / RDP |
| rog Chrome 调试 | `localhost:19222`（rog 本地） | - |

---

## 接力新会话开场白（直接复制粘贴）

```
我接力 Sprint 2.1a 的 e2e 实测。

读这个文件了解所有上下文：
sprints/sprint-c-ws2-douyin-real-publish/HANDOFF-NEXT-SESSION.md

当前分支 cp-05080845-ws2-sprint-21a-ws1，所有代码已 push。
Mac mini API 跑着加载新代码，DB migration 已跑，rog 代码已 sync 到 ~/Desktop/zenithjoy-agent，
Chrome :19222 已起。

我要 RDP 到 rog 走 e2e — 帮我盯着 Agent 启动日志 + 验证 type=video 路由 +
帮我归档 evidence 到 .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md。

如果哪步卡住，按 HANDOFF 文档的"可能踩的坑"自查。
```
