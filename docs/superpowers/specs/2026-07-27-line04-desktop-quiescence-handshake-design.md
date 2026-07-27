# Design: CI × 常驻监听桌面静默握手

## 背景

PR #1467 与 #1469 的 `bubble-read-gate` 都在 xian-rog 真微信上失败：

- #1467：CI 获得 `ci/bubble-read-gate` 高优先级桌面租约后，单次
  `_reset_session_list_to_top` 仍找不到“文件传输助手”。
- #1469：同一路径加入三次有界重试后，三次恢复全部执行、全部失败。

现有 DesktopLeaseBroker 只记录“谁持有租约”。CI `acquire` 成功后立即通过 PsExec
进入 session 1 操作微信；常驻 `listen_chat.py` 只在下一轮主循环顶部读取 `/status`
并让位。监听若已经进入本轮扫描、窗口自愈或回复操作，仍可能在 CI 获租后继续切换、
显示、隐藏、最大化或最小化微信窗口。

因此当前不变量实际是：

> `acquire.granted == true` 只代表 Broker 已把租约记给 CI，不代表监听已经停止碰桌面。

工作流还有第二个安全缺口：租约被拒绝或 Broker 不可达时会
`proceeding anyway`，仍继续操作生产微信桌面。

## 目标

建立可验证的两阶段交接：

1. CI 取得高优先级租约；
2. 常驻监听到达主循环安全点，确认上一轮 UIA 操作已经结束，并对该租约回写静默确认；
3. CI 只有看到当前租约的有效确认后才允许启动 PsExec 气泡检查。

任何租约拒绝、Broker 不可达、租约变化或静默确认超时都必须 fail closed：本次 gate
失败且不操作微信。

## 不变量

- **INV-1：授权不等于静默。** CI 必须同时持有当前租约并收到该租约的静默确认。
- **INV-2：确认绑定 lease ID。** 旧租约或其他租约的确认不能放行当前 CI。
- **INV-3：安全点确认。** 监听只能在主循环顶部、上一轮同步 UIA 操作全部返回后确认。
- **INV-4：确认失败仍让位。** 监听只要看到更高优先级租约，就继续暂停；确认 API
  失败不能使监听恢复碰桌面。
- **INV-5：CI fail closed。** acquire 未授权、Broker 异常、确认超时、确认者不符时，
  在 PsExec 之前失败。
- **INV-6：释放后清状态。** 租约释放、过期或被新租约替换后，旧确认不可继承。

## 方案

### 1. Broker：给当前租约增加静默确认状态

`Lease` 增加：

```ts
yieldAcknowledgedBy?: string
yieldAcknowledgedAt?: number
```

`status()` 在原字段基础上返回：

```json
{
  "held": true,
  "lease_id": "...",
  "client_id": "ci/bubble-read-gate",
  "priority": 10,
  "expires_at": 0,
  "yield_acknowledged": true,
  "yield_acknowledged_by": "line04/listen_chat",
  "yield_acknowledged_at": 0
}
```

新增幂等方法：

```ts
acknowledgeYield({
  leaseId,
  clientId
}): {
  ok: boolean
  reason?: 'lease_not_found' | 'lease_mismatch'
}
```

只有 `leaseId` 与当前未过期租约完全匹配时才记录确认。新租约天然从未确认状态开始；
release、watchdog 过期和抢占换租都通过替换/清空 `currentLease` 清掉旧确认。

### 2. 本机 IPC：新增 `POST /ack-yield`

请求：

```json
{
  "leaseId": "<status.lease_id>",
  "clientId": "line04/listen_chat"
}
```

响应：

```json
{ "ok": true }
```

端点继续只挂在 `127.0.0.1` 的 Agent 本机路由，不新增公网入口。

### 3. 监听：在主循环安全点确认后持续让位

新增：

```py
desktop_lease_ack_yield(status: dict) -> bool
```

主循环顶部变为：

```py
status = desktop_lease_status()
if _should_yield_desktop(status, ...):
    desktop_lease_ack_yield(status)  # best effort；失败只记日志
    sleep(interval)
    continue
```

到达这里意味着上一轮同步执行的扫描、窗口自愈、回复和状态还原均已结束。确认调用无论
成功还是失败，监听都执行 `continue`，不会因为确认链路异常重新进入 UIA 路径。

实现同步更新以下三份运行时镜像：

- `services/agent/wechat-rpa/listen_chat.py`
- `services/agent/modules/line04/wechat-rpa/listen_chat.py`
- `services/agent/build-modules/line04/wechat-rpa/listen_chat.py`

### 4. CI：等待确认，所有异常 fail closed

`wechat-cs-e2e.yml` 与 `nightly-real-machine-staging.yml` 使用相同协议：

1. 调用 `/acquire`；未获得租约立即抛错。
2. 最多等待 30 秒，每 500ms 读取 `/status`。
3. 只有同时满足以下条件才进入 PsExec：
   - `held == true`
   - `lease_id == acquire.lease_id`
   - `client_id == ci/bubble-read-gate`
   - `yield_acknowledged == true`
   - `yield_acknowledged_by == line04/listen_chat`
4. Broker 请求异常、租约变化或 30 秒内未确认，立即失败。
5. 已取得的租约仍在 `finally` 中尽力释放。

30 秒覆盖监听正常的 1–3 秒轮询以及正在结束的同步 UIA 操作；超时不继续猜测，因为这
说明监听可能卡在桌面事务内，正是 CI 不应并发介入的场景。

## 数据流

```text
CI                         Broker                      listen_chat
│ POST /acquire             │                              │
├──────────────────────────>│ currentLease = CI            │
│<──────────────────────────┤ granted + lease_id           │
│                           │                              │
│ GET /status               │              完成本轮 UIA ───┤
├──────────────────────────>│<──────── GET /status ────────┤
│<──────────────────────────┤              higher priority │
│                           │<──── POST /ack-yield ─────────┤
│                           │ acknowledged_by=listener      │
│ GET /status               │                              │ sleep/continue
├──────────────────────────>│                              │
│<──────────────────────────┤ acknowledged=true            │
│ PsExec bubble gate        │                              │ 持续让位
│ POST /release             │                              │
├──────────────────────────>│ currentLease = null           │
```

## 错误处理

- **Broker 不可达：** CI 在 PsExec 前失败；监听按既有兼容策略运行，但不会收到 CI
  已授权的假信号。
- **监听未运行或卡死：** 无静默确认，CI 30 秒超时失败，不触碰微信。
- **确认请求丢失：** 监听每轮让位都会幂等重发，下一次可恢复。
- **租约在等待时过期/变化：** lease ID 不匹配，CI 失败。
- **CI 中途退出：** `finally` 尝试释放；最坏由 TTL/watchdog 清理。
- **监听确认后 Broker 重启：** 状态丢失，CI 后续轮询不再满足条件并失败。

## 测试策略

### TypeScript / Broker

1. 新租约状态包含 `lease_id` 且未确认。
2. 当前 lease ID 的确认成功并出现在 `/status`。
3. 旧/错误 lease ID 的确认失败且不能污染当前租约。
4. release、过期、换租后旧确认被清除。
5. `/ack-yield` 路由真实接线并返回结构化结果。

### Python / 监听

1. `desktop_lease_ack_yield` 使用本机 IPC、当前 lease ID 和固定 listener client ID。
2. Broker 异常返回 `False`，不抛出。
3. 主循环让位路径先尝试确认，然后无条件 sleep/continue。
4. 三份 `listen_chat.py` 镜像保持一致。

### Workflow / 静态 smoke

1. 两条真机 workflow 均不再含 `proceeding anyway`。
2. 两条 workflow 均在 PsExec 前验证当前 lease ID 与 listener 静默确认。
3. 现有 `line04-ci-desktop-mutex-smoke.sh` 扩展为 fail-closed 与握手守卫。

### 真机验收

1. #1469 所有本地单测、Agent CI 和 workflow smoke 通过。
2. xian-rog `bubble-read-gate` 连续三次通过；日志必须显示：
   - CI 获得 lease ID；
   - 等到 `line04/listen_chat` 对同一 lease ID 的静默确认；
   - 之后才启动气泡检查；
   - 最终释放同一 lease ID。
3. 合并 #1469 后，将 #1467 更新到最新 `main`，完整 CI 通过。
4. #1467 额外验证安装产物包含 `setup-reset.ps1`，并验证 `start.bat` 首次安装接线测试。

## 收敛顺序

1. 在 #1469 原分支用 TDD 把“重试缓解”升级为真正的静默握手修复。
2. 真机连续验证后合并 #1469。
3. 更新 #1467 分支到新 `main`，重新跑全量 CI 和安装包验证。
4. 合并 #1467，并回写 Cecelia 中对应 P1 issues。

## 不做的事

- 不继续增加 `_reset_session_list_to_top` 重试次数。
- 不降低或跳过真机气泡 required gate。
- 不在本次引入独立微信测试机；硬件隔离可作为后续增强。
- 不让 Harness Kernel 新建第三条 PR；本次直接收敛两个已有 PR。
