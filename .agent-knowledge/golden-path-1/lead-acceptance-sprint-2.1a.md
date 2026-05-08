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
  - **严禁预置 cookie 跳过 — 必须真机扫**
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
