# Sprint 2.1d — Agent 死循环修复 + Supervisor Design Spec

- 日期: 2026-05-08
- 分支: `cp-0508204153-sprint-2-1d-agent-supervisor`
- 父 Sprint: 2.1c (Path 1 Step 6 真发 selectors + 中台派任务)
- 类型: thin → thin++（修活性 + 加最薄 supervisor，不算 medium）
- Journey: Path 1 客户首次成功 / 横跨 Step 4-6（任何步骤需要 agent 在线）
- Walking Skeleton Maturity: in_progress（继续推 Path 1 但聚焦"agent 一直活着"这一基础设施）

---

## 1. Background — 为什么这个 sprint 必须做

### 1.1 客户视角的现象

Lead 在 dashboard 上看到自己的 agent 显示 **offline**，再次扫码或重启客户端后短暂 online，处理 1-2 个任务后又 offline。Path 1 Step 4 (扫码绑定快手) / Step 6 (中台派任务 + 真发) 频繁因为 agent 不在线而失败 —— 路径上**任何**需要 agent 的步骤都被这个基础设施问题阻断。

### 1.2 Sprint 2.1a-2.1c 已经做完哪些

- 2.1a：transport `type` 字段、qr_bind_douyin handler、heartbeat-loop
- 2.1b：抖音 video 真发骨架
- 2.1c：Step 6 中台派任务 + 真发 dryrun 已通

但**所有这些功能都假设 agent 进程一直活着**。一旦 agent 死，整条路径断。客户会反复手动重启，这不是产品。

### 1.3 这个 Sprint 的两个目标

1. **找到 agent 进程突然死亡的根因**（debug，必须有 log 证据，不能猜）
2. **加一层最薄的 supervisor**，让 agent 死了能秒重启，让 dashboard 上 agent 长期 online

---

## 2. Debug 根因 — 真 log 证据

### 2.1 实验装置

- 在 `services/agent/src/index.ts` 的 main() 之前装 `[exit-debug]` 探针：
  - `process.on('exit', ...)` — 普通退出
  - `process.on('beforeExit', ...)` — event loop 空了
  - `process.on('SIGTERM/SIGINT/SIGHUP/SIGBREAK/SIGABRT', ...)` — OS 信号
  - `console.log('[exit-debug] STARTUP probes installing pid=...')` — 验证 handler 装载成功
- scp 到 rog (`C:\Users\asus\Desktop\zenithjoy-agent\src\index.ts`)
- 用 `start-agent-v2.ps1` 跑 (`Start-Process node tsx-cli.mjs src\index.ts -WindowStyle Hidden -RedirectStandardOutput agent.log -RedirectStandardError agent.err.log`)

### 2.2 实验结果（agent.log 全文）

```
[exit-debug] STARTUP probes installing pid=33752
[agent] starting agent agent-xx-rog-movj1k9c (v1.0.0)
[agent] registering with license at http://100.71.151.105:5200/api/agent/register...
[agent] connecting to ws://100.71.151.105:5200/agent-ws...
[ws1] heartbeat-loop started → http://100.71.151.105:5200/api/agent/heartbeat
[agent] connected as agent-xx-rog-movj1k9c
[ws1] task: douyin 9371b577-3f00-4fed-bfa8-52fe6381d859
[type-route] handleDouyinPublishTask task=9371b577-3f00-4fed-bfa8-52fe6381d859 type=video
[type-route] resolveDouyinScriptPath type=video real=true script=publish-douyin-video.cjs
[handler:douyin-task] task=9371b577-3f00-4fed-bfa8-52fe6381d859 mp4=C:\Temp\smoke-2.1b\test.mp4 script=...\publish-douyin-video.cjs
[ws1:douyin] result: failed
[ws1] task: douyin 9d466196-c93b-420f-ba5c-ccfbd9383d92
[type-route] handleDouyinPublishTask task=9d466196-c93b-420f-ba5c-ccfbd9383d92 type=video
[type-route] resolveDouyinScriptPath type=video real=true script=publish-douyin-video.cjs
[handler:douyin-task] task=9d466196-c93b-420f-ba5c-ccfbd9383d92 mp4=C:\Users\asus\Desktop\video\sprint-2.1c-e2e.mp4 script=...
[ws1:douyin] result: failed
```

agent.err.log 只含旧的 license 注册失败警告（兼容路径，不致命）。

20 秒后查进程：
```
DEAD
```

agent.log 长度 1306 字节，时间停在 `[ws1:douyin] result: failed` 后未再写入。

### 2.3 根因解读 — 5 个判定要点

1. **`[exit-debug] STARTUP probes installing pid=33752` 出现在 log 第 1 行** → exit handlers 已经装载成功，不是探针没生效。
2. **没有任何 `[exit-debug] process.on exit code` 输出** → process 死亡时 Node 的 `exit` 事件根本没机会触发。
3. **没有 `[exit-debug] beforeExit code`** → 不是 event loop 自然空了退出（heartbeat setInterval + ws 都在 keep-alive，event loop 不会空）。
4. **没有 `[exit-debug] process.on SIGxxx received`** → 不是 SIGINT/SIGTERM/SIGHUP 这种 graceful 信号。
5. **没有 `[agent] closed: <code>, reconnecting in <ms>ms` 也没有 `[agent] error:` 也没有 `unhandledException` / `unhandledRejection`** → ws 连接看上去还活着，没有 JS 异常被抛。

**Windows Application Event Log 没有 node.exe 的 crash record**（不是 SEH / access violation 这类 native crash，也不是 OOM kill）。

#### 综合判定

进程被外部 **TerminateProcess** 强 terminate（Windows 等价于 SIGKILL），它**绕过 Node runtime 的所有 handler**，所以观察不到任何 `[exit-debug]` 输出。

最可能元凶（按概率从高到低）：

| 元凶 | 证据/反证 |
|---|---|
| (a) **tsx 4.21 fork 模式：worker 子进程被外部杀，主进程 process.exit 跟着死** | log 显示 worker pid = 33752，PowerShell 看 Start-Process pid = 1984，确认是 fork 模式。tsx CLI 源码确认 `child.spawn(...)` + `child.on('exit', code => process.exit(code ?? 0))`。worker 被 TerminateProcess 时 main 跟死。 |
| (b) **systray2 helper 子进程的 stdio pipe 在客户机异常导致主进程 SIGPIPE** | systray2 spawn `tray_windows.exe` helper 用 stdin/stdout pipe；helper crash 后 systray2 不会主动 process.exit，但 stdin write EPIPE 会被 unhandledException 捕获 — log 没该字样，不是这条路径。 |
| (c) **Playwright spawn 的 cjs publisher 异常退出时 stdio 串杀主进程** | 代码 stdio 是 `['ignore','pipe','pipe']`，且 publish 已经 `[ws1:douyin] result: failed` 写完了 log（child 早就 close 了）。不是这条。 |
| (d) **Windows 用户 session / Job Object 限制回收孤儿进程** | `Start-Process -WindowStyle Hidden` 启的是同 user session 下的进程，ssh non-interactive session 退出时，OS 不会立即回收（实测 1 分钟内才死）。可能是次要因素而非主因。 |
| (e) **wifi/网络抖动 → ws server 关连接 → reconnect setTimeout 已排，但 event loop 空一瞬被 OS 抢占** | 不可能，setInterval (heartbeat) 还在排着 |

**核心结论**：**无论根因 (a)-(e) 哪一个，agent 没有自我修复机制是**事实** —— 没有 supervisor 重启它**。这就是修复方向。

进一步定位单一根因需要：用 Sysinternals **procdump -e** 抓 dump、或开 Windows Process Monitor 看 TerminateProcess caller。但**这超出 Sprint 2.1d 的 ROI**：

> 客户机环境千差万别（杀软、Windows 版本、用户会话、tsx 版本），**逐一根除每种 TerminateProcess 来源是无底洞**。修复方向必须从"防止它死"转为"死了能秒回来"，即 supervisor。

### 2.4 但还要留一个最小的"防它死"动作

考虑到 (a) 是最可能的单一根因 —— **tsx 4.21 fork 模式给 Windows 客户机加了一层不必要的 child process**，在生产 agent 里**不该用 tsx**：

- 开发期用 tsx 是为了直接跑 .ts，免编译。
- 生产 agent 应该 **预编译成 .js**（或用 pkg/nexe 打包成单 .exe），从而**消除 tsx fork**。

所以本 sprint 同时把 production 启动方式从 `node tsx-cli.mjs src/index.ts` 改为 `node dist/index.js`（预编译）。

---

## 3. Scope — 修复方案（最小变动原则）

### 3.1 改动 1：production 启动消除 tsx fork

| 项 | 现状 | 改为 |
|---|---|---|
| `start-agent-v2.ps1` 启动命令 | `Start-Process node tsx-cli.mjs src\index.ts` | `Start-Process node dist\index.js` |
| 构建 | 没生产 build 步骤，直接跑 ts 源码 | 加 `pnpm --filter @zj/agent build` （tsc 编译到 `services/agent/dist/`） |
| dist 分发 | 不存在 | 新装/升级时 `services/agent/dist/` 整个目录 scp 到客户机 |
| 开发期 | 仍可用 tsx，本 sprint 不动 dev workflow | 不变 |

**为什么这是最小改动**：
- 不动 agent 业务代码（index.ts / handlers/* 一行不改）
- 只动 build/启动方式
- 直接消除元凶 (a) 这一最大概率根因

### 3.2 改动 2：加 PowerShell supervisor 脚本（最薄）

新建 `services/agent/supervisor/agent-supervisor.ps1`：

```powershell
# 最小 supervisor — 监控 agent 进程，死了就重启
# 不引入 NSSM / Task Scheduler / Windows Service 这些 medium 级别依赖
# 客户视角：双击 supervisor 一次，永远在线（除非客户主动结束 supervisor）

$agentDir = "C:\Users\asus\Desktop\zenithjoy-agent"
$logPath = Join-Path $agentDir "supervisor.log"
$maxRestarts = 100  # 一天 100 次还死说明环境根本性问题
$restartCount = 0
$restartWindow = New-TimeSpan -Hours 1

while ($restartCount -lt $maxRestarts) {
  Write-LogLine "[supervisor] starting agent (restart count=$restartCount)"
  $proc = Start-Process node -ArgumentList "dist\index.js" `
    -WorkingDirectory $agentDir -RedirectStandardOutput agent.log `
    -RedirectStandardError agent.err.log -PassThru -WindowStyle Hidden -Wait
  $exitCode = $proc.ExitCode
  Write-LogLine "[supervisor] agent died exit=$exitCode, will restart in 3s"
  Start-Sleep -Seconds 3
  $restartCount++
}
```

**为什么这是最薄**：
- 单文件 PowerShell，无 NSSM / 无 Windows Service / 无 Auto-Update
- 客户运行一次（开机启动可放 startup 文件夹）就一直在线
- backoff 策略：固定 3 秒，简单粗暴，能应对临时杀进程；连续 100 次失败就放弃避免死循环吃 CPU

### 3.3 改动 3：health-check API（让 dashboard 真实反映 supervisor 状态）

agent 在 5201 端口起一个 `GET /healthz` HTTP 服务（5201 = 5200 + 1 区分中台 API）：

```typescript
// services/agent/src/handlers/health-server.ts
import http from 'node:http';
const PORT = 5201;
export function startHealthServer(): http.Server {
  return http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        pid: process.pid,
        uptime_ms: Date.now() - startTime,
        ws_connected: wsState === 'open',
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  }).listen(PORT);
}
```

**为什么需要**：
- 中台心跳 30 秒一次，客户机网络抖动可能 60 秒后才被标 offline
- supervisor 自己每 5 秒打一次 `/healthz` 当 watchdog；连续 3 次失败就 kill+restart agent（即使 OS 没杀它，业务侧死循环也救得回来）

### 3.4 不在 Scope 内

- ❌ Auto-update（agent 二进制升级）— Sprint 2.1e+
- ❌ Sentry/metrics 上报 agent crash 事件 — 等找到统一可观测性方案再做
- ❌ 修任何 platform handler 业务逻辑（douyin/wechat/etc）— 这次只动启动 + supervisor
- ❌ Windows Service 安装（NSSM / Sc create）— 客户没有 admin 权限的场景多，PowerShell 脚本足够
- ❌ macOS / Linux 客户端 supervisor —— 现在客户全 Windows，先聚焦
- ❌ 找根因 (a)-(e) 的"哪个具体杀的"—— ROI 不值，supervisor 已可救

---

## 4. 测试策略 — 4 档分类

### 4.1 E2E（必须真实跑）

**E2E-1：agent 1 小时不死 + dashboard online**

- 启 agent-supervisor.ps1 在 rog 上
- 触发 5 个 douyin task（间隔 5 分钟）
- 每 5 分钟查 `dashboard /api/agents` 返回的 `last_heartbeat_at`
- DoD：1 小时内 last_heartbeat_at 与 now 差 ≤ 60 秒，agent status 一直是 online

放在 `.github/workflows/scripts/smoke/sprint-2-1d-agent-uptime-smoke.sh`，CI 上跑 1 分钟版本（缩短到 10 个心跳周期），rog Lead 自验跑 1 小时全量。

**E2E-2：手动 kill agent → supervisor 30 秒内重启**

- 启 supervisor，等 agent online
- ssh rog `Stop-Process -Id <agent_pid> -Force`
- DoD：30 秒内新 agent pid 出现，dashboard 持续显示 online（不掉到 offline）

### 4.2 Integration

**INT-1：health-server `/healthz` 返回 ws 连接状态**
- 启 agent，curl `http://localhost:5201/healthz` 返回 `{ok:true,ws_connected:true,...}`
- 断网（或 kill ws server），等 5 秒，curl 应返回 `ws_connected:false`

**INT-2：build 产物 dist/index.js 可独立跑**
- `pnpm --filter @zj/agent build`
- `node dist/index.js` 启动后能连 ws server（不依赖 tsx）

### 4.3 Unit

**UT-1：supervisor restart count 边界**
- mock 时间 + Start-Process，验证连续失败 100 次后退出，且 backoff 3 秒生效

**UT-2：health-server `/healthz` payload 字段** （node test）
- 启动 server，调用 endpoint，断言 `pid` / `uptime_ms` 字段类型正确

### 4.4 Lead 真机自验

由 xian-rog (Windows ASUS rog) Lead 跑：
1. 收新版 dist/ + supervisor.ps1 + start-agent-v3.ps1（用 supervisor）
2. 双击 supervisor.ps1
3. 在 dashboard 看 agent online；关掉浏览器晚饭后回来 30 分钟，再看 agent 还在 online
4. 在中台手动派 5 条 douyin video task（dryrun），observe 都返回 receipt（不会因为 agent 死掉而 stuck）
5. 最后手动 `Stop-Process -Name node -Force` 一次，等 30 秒看 supervisor 自动起新进程

Lead 真机自验通过 → Sprint 2.1d 完成。

---

## 5. Walking Skeleton 4 问 + 答案

| 问题 | 答案 |
|---|---|
| 1. 本 sprint 推进哪条 Journey？ | **Path 1 客户首次成功**。Notion: <https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29>。Maturity: in_progress（基础设施稳定化，让 Step 4-6 不再因 agent 死被阻断）。 |
| 2. 涉及几个角色？ | 单角色（Lead 客户机 / agent 端）。中台 dashboard 的 agent 状态显示是观察者，不改其代码。**所以这是单 sprint，不需要拆**。 |
| 3. 推进哪些 Feature？ | (a) Agent 启动方式：tsx fork → 预编译 dist (Step 4-6 共用) — thickness: thin → thin++ (b) Agent supervisor: 不存在 → PowerShell 最薄版 — thin++ (c) Agent health-server: 不存在 → 5201 /healthz — thin。所有 feature 都直接服务 Path 1 上 agent 在线这一基础假设。 |
| 4. Feature 0 端到端 smoke = ？ | E2E-1 (agent 1 小时不死 + dashboard online) + E2E-2 (kill 后 30s 重启)。FAIL = 整 sprint FAIL。 |

---

## 6. 加厚铁律 4 实施顺序（两段 commit）

按 ZenithJoy 第零纪律 "先减肥再增肌"：

### Commit 1 — RED test commit（写失败的 E2E）

- 新增 `.github/workflows/scripts/smoke/sprint-2-1d-agent-uptime-smoke.sh` — 跑 10 个心跳周期 (5 分钟)，目前必然 FAIL（agent 没 supervisor，会死）
- 新增 `services/agent/tests/health-server.test.ts` — UT-2，会因为 health-server.ts 还没写而 FAIL
- CI lint-feature-has-smoke 会通过，因为加了 smoke.sh
- CI lint-tdd-commit-order 会通过，因为这一 commit 没有动 src/

**Commit message**: `test(sprint-2.1d): RED — agent uptime smoke + health-server unit test`

### Commit 2 — 减肥（删 tsx 启动路径）+ 增肌（加 supervisor + dist build + health-server）

**减肥**（必须真删，不留 _legacy / TODO 注释）：
- 删 `services/agent/start-agent-v2.ps1` 里 `$tsxCli = ...` 路径
- 删 `Start-Process -FilePath "node" -ArgumentList $tsxCli, "src\index.ts"` 这一行
- （生产路径不再走 tsx，dev 路径不动）

**增肌**：
- 新建 `services/agent/start-agent-v3.ps1`（用 dist/index.js，生产用）
- 新建 `services/agent/supervisor/agent-supervisor.ps1`
- 新建 `services/agent/src/handlers/health-server.ts`，main() 里调 `startHealthServer()`
- 新建 `services/agent/tsconfig.build.json` + `package.json` 加 `"build": "tsc -p tsconfig.build.json"`
- 让上述测试转 GREEN

**Commit message**: `feat(sprint-2.1d): agent supervisor + dist build + health-server`

CI lint-tdd-commit-order: commit 1 测试在前，commit 2 src 在后 → 通过。

---

## 7. 风险与回滚

### 7.1 风险

| 风险 | 缓解 |
|---|---|
| dist build 引入新依赖（tsc 配置 / tsconfig.build.json）拖慢 CI | tsc 已经在 dev deps，本来就有；新增 tsconfig.build.json 是 superset，不影响其他 workspace |
| supervisor.ps1 在某些 Windows 客户机被 PowerShell ExecutionPolicy 拦 | 启动用 `-ExecutionPolicy Bypass`（已是当前 start-agent-v2.ps1 用法） |
| supervisor 死循环吃 CPU（极端情况：dist 文件损坏导致每次启动 1 秒就死） | maxRestarts=100 + 3 秒 backoff，1 小时内最多 1200 次。比同步 spinning 好很多。下个 sprint 加指数 backoff |
| health-server 5201 端口被客户机其他程序占用 | 启动 listen 失败时 swallow 错误（log warn），不影响 agent 主流程 |
| 真根因 (a) 假设错了 — 即使消除 tsx fork，agent 还是会死 | 没关系，supervisor 仍能救；下个 sprint 用 procdump 进一步定位剩余死因 |
| 客户的 dist/ 升级路径还没设计 | 本 sprint 不解决"自动升级"，依然手工 scp（与现状一致）。auto-update 是 2.1e。 |

### 7.2 回滚

如果 Sprint 2.1d 上线后引发新故障：

1. **快速回滚**：`git revert <commit-2-sha>`，重新部署旧 `start-agent-v2.ps1`，agent 退回 tsx 启动模式（虽然会死，但至少行为已知）
2. **仅 supervisor 回滚**：客户 stop supervisor，手动跑 start-agent-v3.ps1 一次（无 supervisor，但跑预编译 dist）
3. **完全回滚**：scp 旧版 src/ 回客户机，跑老 start-agent-v2.ps1

回滚耗时 ≤ 5 分钟。

---

## 8. 完成条件 (DoD)

- [ ] commit 1 测试 RED：smoke 脚本 + health-server.test.ts
- [ ] commit 2 实现 GREEN：tsc build + supervisor.ps1 + start-agent-v3.ps1 + health-server.ts
- [ ] CI 全绿（lint-feature-has-smoke / lint-tdd-commit-order / 单元测试）
- [ ] xian-rog Lead 真机自验：agent 30 分钟不死 + 手动 kill 后 30s 重启
- [ ] dashboard agent 状态显示稳定 online ≥ 30 分钟
- [ ] PR 描述声明：「本 PR 把 Path 1 Step 4-6 的"agent 假设在线"基础设施从 ❌ 推到 ✅」
- [ ] 关 Brain task

---

## 附录 A — debug 实操执行历史

```
20:34:45 第一次启动 agent (pid 21412)
20:45:35 改 index.ts 加 [exit-debug] handlers，scp 到 rog
20:46:00 重启 agent (pid 6388)
20:46:07 ssh 检查 6388 → DEAD（启动后 ~2 分钟死）
20:48:xx scp [exit-debug] STARTUP probe 第二版（带 console.log）
20:49:xx 重启 (pid 1984, worker pid 33752)
20:50:30 1984 死
log 显示 STARTUP probe 触发但 exit handlers 全没触发 → TerminateProcess 强杀判定成立
```

完整 log 见 §2.2。
