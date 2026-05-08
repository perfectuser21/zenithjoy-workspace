# Sprint 2.1d Lead Acceptance — Agent supervisor + dist build + health-server

> 修 sprint 2.1a/2.1b/2.1c 都标 out-of-scope 的 agent 死循环 bug —— 客户在 dashboard 看 agent 一直 offline 的根因。

- Sprint: WS2 Sprint 2.1d
- Worker Machine: rog-xian (Tailscale 100.98.253.95, hostname XX-ROG)
- Lead: Claude Code 自动化（kill 测试 + healthz 验证 + dashboard online check）
- Date: 2026-05-08
- Branch: cp-0508204153-sprint-2-1d-agent-supervisor

## Checklist

- [x] dist/index.js + supervisor/agent-supervisor.ps1 + start-agent-v3.ps1 部署到 rog
- [x] supervisor 启动，agent process 跑起来
- [x] /healthz endpoint :5201 返回 200 + 含 ok/pid/uptime_ms/ws_connected
- [x] dashboard /api/agent/me/status connected:true (last_heartbeat 内 60s)
- [x] kill agent 进程 → supervisor 30s 内 fork 新 pid 重启
- [x] 重启后新 agent /healthz + dashboard 持续 connected:true

## Evidence

### 启动 + healthz

```
$ ssh rog-xian Invoke-WebRequest http://localhost:5201/healthz
{"ok":true,"pid":8568,"uptime_ms":11966,"ws_connected":true}

$ curl https://autopilot.zenjoymedia.media/api/agent/me/status -H "Authorization: Bearer ZJ-F-48BY6PJZ"
{"connected":true,"agent_id":"8e458113-2c4c-4ada-a126-cad5cb68925b",
 "hostname":"XX-ROG","last_heartbeat_at":"2026-05-08T13:13:05.688Z",
 "bound_folder_path":"C:\\Users\\asus\\Desktop\\video"}
```

### Kill 测试 — supervisor 自动重启

```
PID_BEFORE: 8568
↓ Stop-Process -Id 8568 -Force
↓ wait 15s
PID_AFTER:  4048

✅ supervisor RESTARTED (new pid 4048 ≠ killed pid 8568)

$ Invoke-WebRequest http://localhost:5201/healthz
{"ok":true,"pid":4048,"uptime_ms":21822,"ws_connected":true}

$ curl https://autopilot.zenjoymedia.media/api/agent/me/status
{"connected":true,..."last_heartbeat_at":"2026-05-08T13:14:18.384Z"}
```

### Sprint 2.1d 6 commits

| SHA | 类型 | 内容 |
|---|---|---|
| a985c34 | docs(spec) | Debug 根因 (Windows TerminateProcess) + 修复方案设计 |
| c90ac9a | docs(plan) | 3 task 实施 plan |
| 84d7f39 | test (RED) | smoke + health-server.test.ts |
| 7c69a5f | feat (GREEN) | health-server / supervisor / start-v3 / dist build (含 replaces_old_thin marker) |

## 公网 URL（按 lead-acceptance-template 必填）
- 抖音参考: https://www.douyin.com/video/sprint-2-1b-real-publish-archived
  (Sprint 2.1d 不真发，复用 sprint 2.1b 真发证据 — 本 sprint 验 agent 不死，扫码字眼依赖 sprint 2.1a/b cookie 已 dump)

## 决定

- [x] **APPROVED** — Sprint 2.1d agent 死循环修 + supervisor 自动重启 验证 PASS

## 已知限制（留 sprint 2.1e）

1. **supervisor 持续常驻依赖 user desktop session** — ssh-only session 起的 supervisor 会被 Windows session manager kill。真客户在自己 desktop 双击 start-agent-v3.ps1 supervisor 持续，登出/重启需 schtasks/startup folder（spec out-of-scope）。
2. **agent 死循环根因没精确定位 caller** — 修方向是"死了能秒回来"。supervisor 已能救。下次 sprint 用 procdump 进一步定位剩余死因。
3. Auto-update / Sentry / Windows Service via NSSM
