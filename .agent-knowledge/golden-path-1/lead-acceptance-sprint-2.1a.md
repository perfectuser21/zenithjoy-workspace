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

