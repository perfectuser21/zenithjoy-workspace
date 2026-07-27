# CI × 常驻监听桌面静默握手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真机 CI 只有在取得桌面租约且常驻监听确认已经结束在途 UIA 操作后才进入 PsExec，并让所有交接异常在碰微信前 fail closed。

**Architecture:** DesktopLeaseBroker 为每个当前租约保存与 lease ID 绑定的静默确认；`listen_chat.py` 在主循环安全点对高优先级 CI 租约确认后持续让位；两条真机 workflow 在 acquire 与 PsExec 之间轮询同一租约的确认状态。滚动升级期间，只有尚未返回 `lease_id` 的旧 Broker 才可使用 acquire 后新追加的唯一 `(CI)` loop-top 日志；新协议一旦可见就禁止回落。旧确认不会跨 release、过期或换租继承，监听确认失败仍暂停，CI 确认失败则不操作微信。

**Tech Stack:** TypeScript、Node.js HTTP、Vitest、Python 3、pytest、PowerShell 5.1、GitHub Actions、Bash smoke。

---

## 文件结构与职责

- `services/agent/src/desktop-lease-broker.ts`
  - 当前桌面租约的唯一内存状态。
  - 新增 lease-scoped 静默确认字段、`acknowledgeYield()` 和扩展后的 `status()`。
- `services/agent/src/__tests__/desktop-lease-broker-status.test.ts`
  - 锁死确认只属于当前 lease ID，且 release/换租不继承旧确认。
- `services/agent/src/handlers/wechat-rpa.ts`
  - 把 `/ack-yield` 接到 Broker 本机 IPC。
- `services/agent/src/handlers/__tests__/desktop-lease-broker-wireup.test.ts`
  - 通过真实 `http.Server` 验证 `/ack-yield` 不是只存在于内部函数。
- `services/agent/wechat-rpa/listen_chat.py`
  - canonical 监听运行时；新增确认 IPC，并在 loop-top 安全点调用。
- `services/agent/modules/line04/wechat-rpa/listen_chat.py`
  - 安装模块镜像，必须与 canonical 同步。
- `services/agent/build-modules/line04/wechat-rpa/listen_chat.py`
  - 打包输入镜像，必须与 canonical 同步。
- `services/agent/wechat-rpa/tests/test_listen_chat_lease.py`
  - 确认 IPC 的 payload、URL、成功与异常行为。
- `services/agent/wechat-rpa/tests/test_mainloop_wiring.py`
  - 证明确认发生在扫描前，且确认失败不会穿透让位分支。
- `.github/workflows/wechat-cs-e2e.yml`
  - PR required gate：等待 `line04/listen_chat` 确认后才运行 PsExec；兼容尚未部署新
    Broker 的单次滚动升级。
- `.github/workflows/nightly-real-machine-staging.yml`
  - nightly 真机 gate：采用相同 fail-closed 协议。
- `.github/workflows/scripts/smoke/line04-ci-desktop-mutex-smoke.sh`
  - 静态守卫两条 workflow 的 acquire → ack → PsExec 顺序与 fail-closed 语义。

### Task 1: Broker 保存 lease-scoped 静默确认

**Files:**
- Modify: `services/agent/src/__tests__/desktop-lease-broker-status.test.ts`
- Modify: `services/agent/src/desktop-lease-broker.ts`

- [ ] **Step 1: Write the failing Broker tests**

在 `desktop-lease-broker-status.test.ts` 的“持有中”用例中补充初始状态断言，并新增三个用例：

```ts
expect(s.lease_id).toBe(acq.lease_id);
expect(s.yield_acknowledged).toBe(false);
expect(s.yield_acknowledged_by).toBeUndefined();

it('当前 lease ID 的静默确认成功并由 status 返回', async () => {
  broker = new DesktopLeaseBroker({ watchdogIntervalMs: 60000, ttlMs: 60000 });
  const acq = await broker.acquire({
    clientId: 'ci/bubble-read-gate', priority: 10, ttlMs: 60000,
  });

  expect(broker.acknowledgeYield({
    leaseId: acq.lease_id!, clientId: 'line04/listen_chat',
  })).toEqual({ ok: true });
  expect(broker.status()).toMatchObject({
    held: true,
    lease_id: acq.lease_id,
    yield_acknowledged: true,
    yield_acknowledged_by: 'line04/listen_chat',
  });
  expect(broker.status().yield_acknowledged_at).toEqual(expect.any(Number));
});

it('错误 lease ID 不能确认当前租约', async () => {
  broker = new DesktopLeaseBroker({ watchdogIntervalMs: 60000, ttlMs: 60000 });
  await broker.acquire({
    clientId: 'ci/bubble-read-gate', priority: 10, ttlMs: 60000,
  });

  expect(broker.acknowledgeYield({
    leaseId: 'stale-lease', clientId: 'line04/listen_chat',
  })).toEqual({ ok: false, reason: 'lease_mismatch' });
  expect(broker.status().yield_acknowledged).toBe(false);
});

it('release 后的新租约不继承旧确认', async () => {
  broker = new DesktopLeaseBroker({ watchdogIntervalMs: 60000, ttlMs: 60000 });
  const first = await broker.acquire({
    clientId: 'ci/first', priority: 10, ttlMs: 60000,
  });
  broker.acknowledgeYield({
    leaseId: first.lease_id!, clientId: 'line04/listen_chat',
  });
  await broker.release({ leaseId: first.lease_id!, clientId: 'ci/first' });
  const second = await broker.acquire({
    clientId: 'ci/second', priority: 10, ttlMs: 60000,
  });

  expect(second.lease_id).not.toBe(first.lease_id);
  expect(broker.status()).toMatchObject({
    lease_id: second.lease_id,
    yield_acknowledged: false,
  });
});
```

- [ ] **Step 2: Run the Broker test and verify RED**

Run:

```bash
cd services/agent
npx vitest run src/__tests__/desktop-lease-broker-status.test.ts
```

Expected: FAIL，因为 `lease_id`/`yield_acknowledged` 尚未出现在 `StatusResult`，且
`broker.acknowledgeYield` 尚不存在。

- [ ] **Step 3: Add minimal Broker types and implementation**

在 `desktop-lease-broker.ts` 增加：

```ts
export interface AcknowledgeYieldParams {
  leaseId: string;
  clientId: string;
}

export interface AcknowledgeYieldResult {
  ok: boolean;
  reason?: 'lease_not_found' | 'lease_mismatch';
}
```

扩展 `StatusResult`：

```ts
export interface StatusResult {
  held: boolean;
  lease_id?: string;
  client_id?: string;
  priority?: number;
  expires_at?: number;
  yield_acknowledged?: boolean;
  yield_acknowledged_by?: string;
  yield_acknowledged_at?: number;
}
```

扩展内部 `Lease`：

```ts
interface Lease {
  leaseId: string;
  clientId: string;
  priority: number;
  expiresAt: number;
  yieldAcknowledgedBy?: string;
  yieldAcknowledgedAt?: number;
}
```

在 `release()` 与 `status()` 之间加入：

```ts
acknowledgeYield(params: AcknowledgeYieldParams): AcknowledgeYieldResult {
  const held = this.currentLease;
  if (!held || held.expiresAt < Date.now()) {
    return { ok: false, reason: 'lease_not_found' };
  }
  if (held.leaseId !== params.leaseId) {
    return { ok: false, reason: 'lease_mismatch' };
  }
  held.yieldAcknowledgedBy = params.clientId;
  held.yieldAcknowledgedAt = Date.now();
  return { ok: true };
}
```

将 `status()` 的持有返回值改为：

```ts
return {
  held: true,
  lease_id: held.leaseId,
  client_id: held.clientId,
  priority: held.priority,
  expires_at: held.expiresAt,
  yield_acknowledged: Boolean(held.yieldAcknowledgedBy),
  yield_acknowledged_by: held.yieldAcknowledgedBy,
  yield_acknowledged_at: held.yieldAcknowledgedAt,
};
```

- [ ] **Step 4: Run Broker tests and verify GREEN**

Run:

```bash
cd services/agent
npx vitest run src/__tests__/desktop-lease-broker-status.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit Broker state**

```bash
git add services/agent/src/desktop-lease-broker.ts \
  services/agent/src/__tests__/desktop-lease-broker-status.test.ts
git commit -m "feat(agent): 为桌面租约增加静默确认状态"
```

### Task 2: 把 `/ack-yield` 接入真实本机 HTTP 路由

**Files:**
- Modify: `services/agent/src/handlers/__tests__/desktop-lease-broker-wireup.test.ts`
- Modify: `services/agent/src/handlers/wechat-rpa.ts`

- [ ] **Step 1: Write the failing real-server test**

在 `registerLeaseBrokerRoutes` describe 中新增：

```ts
it('POST /ack-yield 只确认当前 lease ID，并由 status 可见', async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  registerLeaseBrokerRoutes(server);
  await new Promise<void>((r) => server!.listen(PORT, r));

  const acquire = await fetch(
    `http://localhost:${PORT}/api/agent/desktop-lease-broker/acquire`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'ci/bubble-read-gate', priority: 10, ttlMs: 5000,
      }),
    },
  );
  const lease = await acquire.json() as { lease_id: string };
  const ack = await fetch(
    `http://localhost:${PORT}/api/agent/desktop-lease-broker/ack-yield`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaseId: lease.lease_id, clientId: 'line04/listen_chat',
      }),
    },
  );
  const status = await fetch(
    `http://localhost:${PORT}/api/agent/desktop-lease-broker/status`,
  );

  expect(ack.status).toBe(200);
  expect(await ack.json()).toEqual({ ok: true });
  expect(await status.json()).toMatchObject({
    lease_id: lease.lease_id,
    yield_acknowledged: true,
    yield_acknowledged_by: 'line04/listen_chat',
  });
});
```

- [ ] **Step 2: Run the route test and verify RED**

Run:

```bash
cd services/agent
npx vitest run src/handlers/__tests__/desktop-lease-broker-wireup.test.ts
```

Expected: FAIL，`/ack-yield` 返回 404。

- [ ] **Step 3: Add the IPC request type and route**

把 `LeaseBrokerIpcRequest['type']` 扩为：

```ts
type:
  | 'desktop_lease_acquire'
  | 'desktop_lease_renew'
  | 'desktop_lease_release'
  | 'desktop_lease_ack_yield';
```

在 `handleDesktopLeaseIpc` 中新增：

```ts
case 'desktop_lease_ack_yield': {
  return leaseBroker.acknowledgeYield({
    leaseId: String(req.payload.leaseId ?? ''),
    clientId: String(req.payload.clientId ?? ''),
  }) as unknown as Record<string, unknown>;
}
```

在路由 `typeMap` 中新增：

```ts
'/api/agent/desktop-lease-broker/ack-yield': 'desktop_lease_ack_yield',
```

- [ ] **Step 4: Run route and Broker tests**

Run:

```bash
cd services/agent
npx vitest run \
  src/__tests__/desktop-lease-broker-status.test.ts \
  src/handlers/__tests__/desktop-lease-broker-wireup.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit HTTP wire-up**

```bash
git add services/agent/src/handlers/wechat-rpa.ts \
  services/agent/src/handlers/__tests__/desktop-lease-broker-wireup.test.ts
git commit -m "feat(agent): 接入桌面静默确认本机端点"
```

### Task 3: 监听在 loop-top 安全点确认并持续让位

**Files:**
- Modify: `services/agent/wechat-rpa/tests/test_listen_chat_lease.py`
- Modify: `services/agent/wechat-rpa/tests/test_mainloop_wiring.py`
- Modify: `services/agent/wechat-rpa/listen_chat.py`
- Modify: `services/agent/modules/line04/wechat-rpa/listen_chat.py`
- Modify: `services/agent/build-modules/line04/wechat-rpa/listen_chat.py`

- [ ] **Step 1: Write failing IPC tests**

在 `test_listen_chat_lease.py` 增加：

```py
def test_ack_yield_posts_current_lease_and_listener_id(capsys):
    status = {
        "held": True,
        "lease_id": "ci-lease-001",
        "client_id": "ci/bubble-read-gate",
        "priority": 10,
    }
    ctx, captured = _capture_urlopen_url({"ok": True})
    with ctx:
        result = lc.desktop_lease_ack_yield(status)

    assert result is True
    assert captured["url"].endswith(
        "/api/agent/desktop-lease-broker/ack-yield"
    )
    request = captured.get("request")
    payload = json.loads(request.data.decode("utf-8"))
    assert payload == {
        "leaseId": "ci-lease-001",
        "clientId": lc._DESKTOP_LEASE_CLIENT_ID,
    }
    assert "yield acknowledged" in capsys.readouterr().err


def test_ack_yield_missing_lease_id_fails_without_http():
    with patch("urllib.request.urlopen") as mock_open:
        assert lc.desktop_lease_ack_yield({"held": True}) is False
    mock_open.assert_not_called()


def test_ack_yield_http_error_returns_false(capsys):
    with patch("urllib.request.urlopen", side_effect=Exception("timeout")):
        result = lc.desktop_lease_ack_yield({
            "held": True, "lease_id": "ci-lease-err",
        })
    assert result is False
    assert "yield acknowledge error" in capsys.readouterr().err
```

同时把 `_capture_urlopen_url` 的 fake 保存请求对象：

```py
captured["request"] = req
```

- [ ] **Step 2: Write failing loop-top wiring test**

用以下实现替换 `test_desktop_mutex_yield_wired_at_loop_top` 的核心源码断言：

```py
pattern = re.compile(
    r"_desktop_status\s*=\s*desktop_lease_status\(\).*?"
    r"if _should_yield_desktop\(\s*_desktop_status,.*?"
    r"desktop_lease_ack_yield\(_desktop_status\).*?"
    r"time\.sleep\(args\.interval\).*?"
    r"continue",
    re.DOTALL,
)
m = pattern.search(src)
assert m is not None, (
    "监听必须在 loop-top 读取一次 status，对同一 status 确认静默，"
    "并无条件 sleep/continue"
)
yield_idx = m.start()
heartbeat_idx = src.find("_really_collapsed")
scan_idx = src.find("unread = scan_unread(")
assert heartbeat_idx == -1 or yield_idx < heartbeat_idx
assert scan_idx == -1 or yield_idx < scan_idx
```

- [ ] **Step 3: Run Python tests and verify RED**

Run:

```bash
cd services/agent/wechat-rpa
python3 -m pytest \
  tests/test_listen_chat_lease.py \
  tests/test_mainloop_wiring.py -q
```

Expected: FAIL，因为 `desktop_lease_ack_yield` 和新 loop-top 接线尚不存在。

- [ ] **Step 4: Implement `desktop_lease_ack_yield` in canonical listener**

在 `desktop_lease_status()` 之后加入：

```py
def desktop_lease_ack_yield(status: dict) -> bool:
    """确认当前高优先级租约已在主循环安全点获得桌面静默。"""
    lease_id = status.get("lease_id")
    if not lease_id:
        print(
            "[desktop_lease] yield acknowledge skipped reason=missing_lease_id",
            file=sys.stderr,
        )
        return False
    url = _get_local_discovery_base() + \
        "/api/agent/desktop-lease-broker/ack-yield"
    payload = json.dumps({
        "leaseId": lease_id,
        "clientId": _DESKTOP_LEASE_CLIENT_ID,
    }).encode("utf-8")
    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        print(
            f"[desktop_lease] yield acknowledge error={exc}",
            file=sys.stderr,
        )
        return False
    if result.get("ok"):
        print(
            f"[desktop_lease] yield acknowledged lease_id={lease_id}",
            file=sys.stderr,
        )
        return True
    print(
        f"[desktop_lease] yield acknowledge rejected "
        f"lease_id={lease_id} reason={result.get('reason')}",
        file=sys.stderr,
    )
    return False
```

把 loop-top 改为单次读取同一状态：

```py
_desktop_status = desktop_lease_status()
if _should_yield_desktop(
    _desktop_status, _DESKTOP_LEASE_CLIENT_ID, _DESKTOP_LEASE_PRIORITY
):
    desktop_lease_ack_yield(_desktop_status)
    _log(
        "桌面租约被他人(CI)持有，已到安全点并整轮让位"
        "（不扫描/不发送/不动 UIA 标志）"
    )
    time.sleep(args.interval)
    continue
```

- [ ] **Step 5: Apply the same minimal code to both runtime mirrors**

对以下两份文件应用与 canonical 完全相同的函数和 loop-top patch：

```text
services/agent/modules/line04/wechat-rpa/listen_chat.py
services/agent/build-modules/line04/wechat-rpa/listen_chat.py
```

- [ ] **Step 6: Run Python tests and mirror check**

Run:

```bash
cd services/agent/wechat-rpa
python3 -m pytest \
  tests/test_listen_chat_lease.py \
  tests/test_mainloop_wiring.py \
  tests/test_desktop_yield.py -q
cd ../../..
cmp services/agent/wechat-rpa/listen_chat.py \
  services/agent/modules/line04/wechat-rpa/listen_chat.py
cmp services/agent/wechat-rpa/listen_chat.py \
  services/agent/build-modules/line04/wechat-rpa/listen_chat.py
```

Expected: pytest 全部 PASS；两个 `cmp` exit 0。

- [ ] **Step 7: Commit listener safe-point acknowledgement**

```bash
git add services/agent/wechat-rpa/listen_chat.py \
  services/agent/modules/line04/wechat-rpa/listen_chat.py \
  services/agent/build-modules/line04/wechat-rpa/listen_chat.py \
  services/agent/wechat-rpa/tests/test_listen_chat_lease.py \
  services/agent/wechat-rpa/tests/test_mainloop_wiring.py
git commit -m "feat(agent): 监听在桌面安全点确认静默"
```

### Task 4: 两条真机 workflow 等待确认并 fail closed

**Files:**
- Modify: `.github/workflows/scripts/smoke/line04-ci-desktop-mutex-smoke.sh`
- Modify: `.github/workflows/wechat-cs-e2e.yml`
- Modify: `.github/workflows/nightly-real-machine-staging.yml`

- [ ] **Step 1: Strengthen the smoke test first**

把 smoke 的 CI 检查扩展为以下精确守卫：

```bash
echo "[1/6] 两条 workflow 均已删除 acquire fail-open"
for wf in "$WF_CS" "$WF_NIGHTLY"; do
  ! grep -q "proceeding anyway" "$wf" \
    || fail "$wf 仍在租约拒绝/Broker异常后继续碰生产桌面"
  grep -q "desktop-lease acquire failed closed" "$wf" \
    || fail "$wf 缺 acquire fail-closed 锚点"
done

echo "[2/6] 两条 workflow 均等待 listener 对同一 lease ID 确认"
for wf in "$WF_CS" "$WF_NIGHTLY"; do
  grep -q "yield_acknowledged" "$wf" \
    || fail "$wf 缺 yield_acknowledged 检查"
  grep -q "yield_acknowledged_by" "$wf" \
    || fail "$wf 缺 yield_acknowledged_by 检查"
  grep -q "'line04/listen_chat'" "$wf" \
    || fail "$wf 未锁定确认者 line04/listen_chat"
  grep -q "desktop-lease quiescence timeout" "$wf" \
    || fail "$wf 缺静默确认超时 fail-closed 锚点"
done
```

保留 acquire/release、顺序和监听接线检查，并将顺序检查改成：

```bash
ACK_LINE=$(grep -n "desktop-lease quiescence acknowledged" "$wf" \
  | head -1 | cut -d: -f1)
[ "$ACQ_LINE" -lt "$ACK_LINE" ] && [ "$ACK_LINE" -lt "$PSEXEC_LINE" ] \
  || fail "$wf 必须按 acquire → quiescence acknowledged → PsExec 排序"
```

- [ ] **Step 2: Run smoke and verify RED**

Run:

```bash
bash .github/workflows/scripts/smoke/line04-ci-desktop-mutex-smoke.sh
```

Expected: FAIL，指出 workflow 仍含 `proceeding anyway` 或缺静默确认。

- [ ] **Step 3: Replace acquire block in `wechat-cs-e2e.yml`**

在 acquire 前记录 `C:\Users\Public\zj-listener.log` 当前行数。下方现代协议分支用于
`/status` 已返回 `lease_id` 的 Agent；若该字段不存在，只允许在 holder 仍是
`ci/bubble-read-gate` 时读取 acquire 后新增行，并以唯一 ASCII 锚点 `(CI)` 作为旧监听
到达 loop-top 的确认。不得用固定 sleep 或任意新日志替代该锚点。

将 acquire 的 fail-open 逻辑替换为：

```powershell
$leaseId = $null
try {
  $acqBody = @{
    clientId = 'ci/bubble-read-gate'
    priority = 10
    ttlMs = 180000
  } | ConvertTo-Json -Compress
  $acq = Invoke-RestMethod -Uri "$leaseBase/acquire" -Method Post `
    -Body $acqBody -ContentType 'application/json' `
    -TimeoutSec 5 -ErrorAction Stop
  if (-not $acq.granted -or -not $acq.lease_id) {
    throw 'desktop-lease acquire failed closed: not granted'
  }
  $leaseId = [string]$acq.lease_id
  Write-Host "desktop-lease acquired lease_id=$leaseId"

  $acknowledged = $false
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $status = Invoke-RestMethod -Uri "$leaseBase/status" -Method Get `
      -TimeoutSec 5 -ErrorAction Stop
    if (-not $status.held -or [string]$status.lease_id -ne $leaseId) {
      throw 'desktop-lease changed while waiting for quiescence'
    }
    if (
      $status.yield_acknowledged -and
      [string]$status.yield_acknowledged_by -eq 'line04/listen_chat'
    ) {
      $acknowledged = $true
      Write-Host "desktop-lease quiescence acknowledged lease_id=$leaseId"
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $acknowledged) {
    throw 'desktop-lease quiescence timeout'
  }
} catch {
  Write-Error ("desktop-lease acquire failed closed: " + $_)
  throw
}
```

保留后续 PsExec 与 `finally` release。

- [ ] **Step 4: Apply the same protocol to nightly**

在 `nightly-real-machine-staging.yml` 使用相同代码，仅保持原有 client ID：

```powershell
clientId = 'ci/wechat-bubble'
```

其余确认者、lease ID 匹配、30 秒 timeout 与 fail-closed 锚点完全一致。

- [ ] **Step 5: Run workflow smoke and YAML-oriented lint**

Run:

```bash
bash .github/workflows/scripts/smoke/line04-ci-desktop-mutex-smoke.sh
bash .github/workflows/scripts/lint-wechat-rpa-runner.sh
git diff --check
```

Expected: 两个脚本 PASS；`git diff --check` 无输出。

- [ ] **Step 6: Commit workflow safety**

```bash
git add .github/workflows/wechat-cs-e2e.yml \
  .github/workflows/nightly-real-machine-staging.yml \
  .github/workflows/scripts/smoke/line04-ci-desktop-mutex-smoke.sh
git commit -m "fix(ci): 等监听静默确认后再操作真微信"
```

### Task 5: 全量回归、更新 #1469 并真机连续验证

**Files:**
- Modify: `services/agent/package.json`
- Modify: `services/agent/package-lock.json`
- Modify: `services/agent/build-modules/line04/manifest.json`
- Modify: `services/agent/modules/line04/manifest.json`

- [ ] **Step 1: Run focused TypeScript tests**

Run:

```bash
cd services/agent
npx vitest run \
  src/__tests__/desktop-lease-broker-status.test.ts \
  src/handlers/__tests__/desktop-lease-broker-wireup.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 2: Run focused Python tests**

Run:

```bash
cd services/agent/wechat-rpa
python3 -m pytest \
  tests/test_listen_chat_lease.py \
  tests/test_mainloop_wiring.py \
  tests/test_desktop_yield.py \
  tests/test_selfcheck_gate_state.py -q
```

Expected: 全部 PASS。

- [ ] **Step 3: Run Agent regression checks**

Run:

```bash
cd services/agent
npm test
npm run typecheck
```

Expected: Vitest 与 TypeScript 全部 PASS，无新增错误。

- [ ] **Step 4: Run repository smoke checks**

Run:

```bash
cd ../..
bash .github/workflows/scripts/smoke/line04-ci-desktop-mutex-smoke.sh
bash .github/workflows/scripts/lint-wechat-rpa-runner.sh
git diff --check
git status --short
```

Expected: smoke/lint PASS；仅允许计划内提交后的状态文件，不允许未提交代码。

- [ ] **Step 5: Bump deployable core and line04 module versions**

本修复同时改到 `services/agent/src/` 与 `services/agent/wechat-rpa/`，必须把 Agent core
从 `2.0.88` 提升到 `2.0.89`，并把两份 line04 manifest 从 `1.0.151` 提升到
`1.0.152`。运行：

```bash
bash .github/workflows/scripts/lint-agent-version-bump.sh
bash .github/workflows/scripts/lint-line04-manifest-version-bump.sh
```

Expected: 两个版本门禁均 PASS，确保合并后旧机器能实际 OTA 到握手实现。

- [ ] **Step 6: Verify the production TypeScript build**

Run:

```bash
cd services/agent
npm run build
```

Expected: `tsc -p tsconfig.build.json` exit 0。仓库通用 `npm run typecheck` 的既有
`import.meta` 测试配置问题单独记录，但不能代替生产 build 验证。

- [ ] **Step 7: Commit version bumps**

```bash
git add services/agent/package.json services/agent/package-lock.json \
  services/agent/build-modules/line04/manifest.json \
  services/agent/modules/line04/manifest.json \
  docs/superpowers/plans/2026-07-27-line04-desktop-quiescence-handshake.md
git commit -m "chore(agent): 发布桌面静默握手版本"
```

- [ ] **Step 8: Push #1469 branch**

```bash
git push origin cp-0724100714-bubble-gate-reset-retry
```

Expected: remote branch 更新到本地 HEAD。

- [ ] **Step 9: Update PR #1469 description**

在 PR body 中写明：

```markdown
## 根因修正

原有 retry 只重复恢复动作，没有解决 CI 已获租但监听仍在完成本轮 UIA 的竞态。
本 PR 现改为 lease-scoped 两阶段交接：

1. CI acquire；
2. listener 在 loop-top 安全点确认同一 lease ID；
3. CI 收到确认后才运行 PsExec；
4. 所有租约/确认异常 fail closed。

## 真机证据

- [ ] xian-rog run 1 PASS
- [ ] xian-rog run 2 PASS
- [ ] xian-rog run 3 PASS
```

- [ ] **Step 10: Wait for all PR checks**

Run:

```bash
gh pr checks 1469 --watch --interval 20
```

Expected: required checks 全绿。

- [ ] **Step 11: Re-run the real-machine workflow until three consecutive PASS results**

每次使用最新 #1469 head 对应的 `WeChat CS E2E` workflow run；如 GitHub 不自动产生三次，
用 `gh run rerun <run-id>` 触发相同 SHA 的重跑。每次记录 run URL，并确认 job3 日志顺序：

```text
desktop-lease acquired lease_id=<id>
desktop-lease quiescence acknowledged lease_id=<same-id>
bubble gate PASS
desktop-lease released lease_id=<same-id>
```

Expected: 三次连续 PASS。任一次失败则停止合并，按日志回到 systematic-debugging。

### Task 6: 合并 #1469，更新、验证并合并 #1467

**Files:**
- Verify/update existing branch `cp-0723224759-fix-setup-reset-pack-gap`.

- [ ] **Step 1: Merge #1469 after required checks and three real-machine passes**

Run:

```bash
gh pr merge 1469 --squash --delete-branch
```

Expected: PR state `MERGED`。

- [ ] **Step 2: Update local main and #1467 branch**

Run:

```bash
git -C /Users/administrator/perfect21/zenithjoy pull --ff-only origin main
git -C /Users/administrator/perfect21/zenithjoy \
  fetch origin cp-0723224759-fix-setup-reset-pack-gap
```

在 #1467 专用 worktree（若不存在则创建）更新到 `origin/main`，不修改 #1469 worktree。
更新后 push 分支，并确保 PR #1467 不再 `BEHIND`。

- [ ] **Step 3: Verify setup-reset package artifacts**

在 #1467 worktree 运行 PR 自带的聚焦测试和 GP4 smoke，至少确认：

```bash
rg -n "setup-reset.ps1" \
  services/agent/scripts/build-install-pack.sh \
  services/agent/install-pack/start.bat
```

Expected:

- build 脚本把 `setup-reset.ps1` 复制进安装包；
- `start.bat` 首次安装路径调用该脚本；
- #1467 新增的测试与 GP4 smoke 全部 PASS。

- [ ] **Step 4: Wait for #1467 full CI**

Run:

```bash
gh pr checks 1467 --watch --interval 20
```

Expected: required checks 全绿，包括真机 `bubble-read-gate`。

- [ ] **Step 5: Merge #1467**

Run:

```bash
gh pr merge 1467 --squash --delete-branch
```

Expected: PR state `MERGED`。

- [ ] **Step 6: Close the two Cecelia issues with PR evidence**

更新：

```text
b237a4b6-3534-4ebb-9e99-3afb6025f920 → Closed，附 #1469 与三次真机 run
73a75417-e636-407e-b29b-41faf41afde7 → Closed，附 #1467
```

只在两个 PR 都实际合并后执行，避免提前关闭。

## Self-review

- Spec coverage:
  - lease ID 绑定确认：Task 1。
  - 本机 IPC：Task 2。
  - listener 安全点与失败仍让位：Task 3。
  - 两条 workflow fail closed：Task 4。
  - 旧 Agent → 新 Agent 滚动升级：Task 4 的 `lease_id` capability 分支与 `(CI)` 安全点日志。
  - 三次真机验收：Task 5。
  - #1469 → #1467 串行收敛与 issues 回写：Task 6。
- Type consistency:
  - Broker 方法统一为 `acknowledgeYield`。
  - HTTP 路径统一为 `/api/agent/desktop-lease-broker/ack-yield`。
  - 状态字段统一为 `lease_id`、`yield_acknowledged`、
    `yield_acknowledged_by`、`yield_acknowledged_at`。
  - listener client ID 统一为 `line04/listen_chat`。
- Placeholder scan: 无待补实现项；真机 run ID 只能在 GitHub 运行生成后记录。
