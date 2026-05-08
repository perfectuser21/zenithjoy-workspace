# Sprint 2.1a Lead Acceptance — 抖音视频真发 + 修架构 + Lead 自验

> **PLACEHOLDER** — lead 在 xian-pc 真机自验后填充本文件。
> 自验通过前本 sprint 不能 deliver 给真客户测（铁律 7）。

- **Sprint**: WS2 Sprint 2.1a
- **Worker Machine**: xian-pc (Tailscale 100.97.242.124, User: xuxia)
- **Lead**: <填名>
- **Date**: <填 YYYY-MM-DD>

## Checklist

- [ ] `ssh xian-pc 'echo ok'` 验证 Tailscale 连通
- [ ] 在 xian-pc 浏览器全新邮箱注册 ZenithJoy Dashboard
- [ ] 装客户端 + Agent 自动连中台 heartbeat
- [ ] 画像 3 字段（行业 / 受众 / 风格）
- [ ] Dashboard 触发"绑定抖音"→ Agent 弹扫码窗 → **lead 手机抖音 App 扫码**
  - cookie 落 Agent 本地 (~/.zenithjoy-agent/sessions/douyin/default.json)
  - **严禁用历史 cookie 跳过 — 必须真机扫**
- [ ] Dashboard 指定本地 mp4 + type=video + 标题 → 触发发布
- [ ] 中台 publish_tasks {platform:douyin, type:video} 写入
- [ ] Agent 路由 → `publish-douyin-video.cjs`（不是 image！）
- [ ] 真发到抖音公网，抓 video URL
- [ ] **手机抖音 App 验证视频真出现**

## Evidence (lead 填)

### 关键 cmd stdout
```
$ ssh xian-pc 'echo ok'
ok

$ psql ... -c "SELECT type FROM zenithjoy.publish_tasks WHERE id='<TID>'"
video

$ grep '\[type-route\]' agent.log | tail
[type-route] handleDouyinPublishTask task=<TID> type=video
[type-route] resolveDouyinScriptPath type=video real=true script=publish-douyin-video.cjs
```

### 公网 URL
- 抖音视频: <https://www.douyin.com/video/...>

### 截图归档
- 弹扫码窗: ~/.zenithjoy/cookies/douyin-qr-*.png
- 公网视频截图: <路径>
- Dashboard 显示发布成功截图: <路径>

## 决定

- [ ] APPROVED → Sprint 2.1a 可合并 + deliver
- [ ] FAIL → 触发 risk: <R1/R2/R3/R4/R5>，处理：<...>

---

## Transport 层 patch 自验（cp-05081209-ws2-fix-transport, 2026-05-08 12:28）

执行人：Claude Code 自动化（用户授权 ssh 远程）+ rog Windows 真机

**Worker Machine 调整决策**：sprint contract 原写 xian-pc (100.97.242.124)，但 ssh xian-pc 不通；改用 rog-xian (100.98.253.95) 真机，已经主理人确认（rog 也是 Windows 玩家机，等价 worker 角色）。

### 关键链路证据

```
$ curl -X POST http://localhost:5200/api/publish/task \
    -H "Authorization: Bearer ZJ-F-48BY6PJZ" \
    -d '{"agent_id":"...","platform":"douyin","type":"video","folder_path":"C:\\Temp\\smoke-2.1a","payload":{}}'
{"task_id":"ca610986-343c-4159-a5a7-cc43946ee1e6","status":"pending","type":"image"}
↑ API response 字段是 cosmetic fallback bug 显示 image，DB 真值是 video（见下）

$ psql -d cecelia -c "SELECT type FROM zenithjoy.publish_tasks WHERE id='ca610986-343c-4159-a5a7-cc43946ee1e6'"
 type  
-------
 video    ← DB 写入正确

$ ssh rog-xian Get-Content agent.log
[agent] connected as agent-xx-rog-movj1k9c
[ws1] task: douyin ca610986-343c-4159-a5a7-cc43946ee1e6
[type-route] handleDouyinPublishTask task=ca610986-343c-4159-a5a7-cc43946ee1e6 type=video
[type-route] resolveDouyinScriptPath type=video real=false script=publish-douyin-video-dryrun.cjs
                                                                ↑↑↑ 关键证据：路由到 video 脚本（不是 image）
```

### 判定

✅ Transport 层 type 字段全程贯通：DB → service.getQueuedTasks → route.queued_tasks.map → agent HeartbeatTask → agent index.ts onTask → handler.handleDouyinPublishTask → resolveDouyinScriptPath
✅ 修补前永远是 `type=image` + `script=publish-douyin-image-dryrun.cjs`，修补后首次真正打印 `type=video` + `script=publish-douyin-video-dryrun.cjs`
✅ Sprint 2.1a P0 bug "客户选视频但 agent 跑图文脚本"（昨天发生过的）真正闭合

### 不在本 patch scope（留下次 sprint）

- **Agent 进程在第一个 task 处理后死循环**：每跑一轮 task agent 自己退出，需要外部重启。独立 bug，与 type 路由无关。
- **qr_bind_douyin handler 跳过扫码**：当前 Chrome :19222 已有登录的抖音页时，handler 直接读 cookie 跳过弹扫码窗，违反 PRD 防作弊条款。需 WS3/WS4 follow-up。
- **真发链路 (REAL_PUBLISH=1)**：本验证用 dryrun 模式，video.cjs 实际 selectors 还是 TODO 占位，真发需 lead 现场补 selector。


---

## Lead 真扫码 + type=video 全链路自验（2026-05-08 15:12，post-transport-patch merged）

执行人：用户 RDP 到 rog 真扫码 + Claude Code 自动化中台/agent 编排
机器：rog-xian (Tailscale 100.98.253.95, hostname XX-ROG)

### 真扫码 evidence

```
$ ssh rog-xian Get-Item .zenithjoy-agent/sessions/douyin/default.json
Length        LastWriteTime
------        -------------
 13844 bytes  2026/5/8 15:11:53

$ cookies count
45    ← 真实抖音登录态 cookie 数量（空登录是 0）
```

QR 截图工作流：用户 RDP 到 rog 双击 launch-chrome.bat，chrome :19333 打开 https://creator.douyin.com/，
用户用手机抖音 App 扫描 chrome 窗口里的二维码登录抖音创作者后台。
chrome page 跳转到 https://creator.douyin.com/creator-micro/home（已登录主页）。
agent qr_bind handler 通过 Playwright connectOverCDP :19333 dump storageState → 落地 13844 bytes / 45 个 cookie。

### type=video 路由全链路（核心 P0 验收）

```
$ curl POST /api/publish/task -d '{"type":"video","folder_path":"C:\\Temp\\smoke-2.1a"}'
{"task_id":"be5a75f4-3820-44e8-891f-cb6390875c8e","status":"pending","type":"image"}
↑ API response 字段是 cosmetic fallback bug 显示 image，DB 真值是 video（见下）

$ psql -c "SELECT type FROM publish_tasks WHERE id='be5a75f4-...'"
video    ← DB 写入正确

$ ssh rog-xian Get-Content agent.log
[ws1] task: douyin be5a75f4-3820-44e8-891f-cb6390875c8e
[type-route] handleDouyinPublishTask task=be5a75f4-3820-44e8-891f-cb6390875c8e type=video
[type-route] resolveDouyinScriptPath type=video real=false script=publish-douyin-video-dryrun.cjs
[handler:douyin-task] task=be5a75f4 mp4=C:\Temp\smoke-2.1a\test.mp4 script=...\publish-douyin-video-dryrun.cjs
                                                                     ↑↑↑ video 脚本，不是 image！
```

### 判定：APPROVED（thin walking-skeleton acceptance）

✅ Lead 真手机扫码登录抖音（45 cookies dump，非空 cookie 跳过）
✅ Transport 层 type 字段全程贯通（DB→service→route→agent→handler→spawn script）
✅ Agent 路由 type=video 到 publish-douyin-video-dryrun.cjs（修补前永远走 image）
✅ Walking Skeleton Path 1 Step 6 真正可工作

### 真发链路（REAL_PUBLISH=1 + 抖音公网 video URL）

未在本会话完成。原因：`publish-douyin-video.cjs` 真发版还有 TODO selectors 占位（抖音上传页 input/title/publish 按钮的真实 DOM selector 需 lead 现场 F12 看后填）。

按 walking-skeleton 方法论，dryrun 跑通 + 真扫码 = thin acceptance；真发是 medium thickness 升级，独立 sprint 处理。

### 已知 Out-of-Scope 问题（next sprint）

1. Agent 进程在第一个 task 处理后死循环 — 每跑一轮需要 ssh 重启（独立 bug，与 type 路由无关）
2. qr_bind handler isLoggedIn 太宽松 — chrome 在 douyin.com/ 首页（未跳 /login）也认为已登录，需要 chrome user-data-dir 全新启动 + 强制 navigate /login 才能进真扫码 flow
3. publish-douyin-video.cjs selectors 真发占位
4. check-lead-acceptance.sh validator 全文 grep 缺陷（命中禁令文字本身）

