# Line04 Phase 0 观测埋点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让中台心跳 diag 显示 line04 模块版本 + 每条未读为什么没回（skip 计数），无需 SSH 进客户机。

**Architecture:** 三个独立单元——(1) TS spawn 时把 manifest 版本经 env `ZENITHJOY_MODULE_VERSION` 传进 listen_chat；(2) Python skip 计数器纯类累加各 reason；(3) Python 纯函数 `build_diag` 把版本+skip 快照组进 diag。不碰任何回复/扫描/切会话判定逻辑，纯增量观测。

**Tech Stack:** TypeScript (vitest) + Python 3.12 (pytest)，listen_chat.py 顶层零 pywinauto（clean CI 可直接 import 纯函数测）。

---

### Task 1: TS — spawn env 注入 ZENITHJOY_MODULE_VERSION

**Files:**
- Modify: `services/agent/modules/line04/handlers/wechat-rpa.ts`（spawnEnv 组装 ~190；新增 `getModuleVersion()`）
- Test: `services/agent/modules/line04/__tests__/listener-module-version-env.test.ts`（新建，照抄 `listener-real-publish-env.test.ts` 的 captureSpawnEnv 型）

- [ ] **Step 1: 写失败测试** — 新建 `__tests__/listener-module-version-env.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _listenerKillFuncs, startWechatListener, getModuleVersion } from '../handlers/wechat-rpa';

describe('startWechatListener — spawn env 注入模块版本', () => {
  let origSpawnFn: typeof _listenerKillFuncs.spawnFn;
  let origPlatform: string;
  let origKill: typeof _listenerKillFuncs.killExistingListeners;

  beforeEach(() => {
    origSpawnFn = _listenerKillFuncs.spawnFn;
    origPlatform = _listenerKillFuncs.platform;
    origKill = _listenerKillFuncs.killExistingListeners;
    _listenerKillFuncs.platform = 'win32';
    _listenerKillFuncs.killExistingListeners = () => {};
  });
  afterEach(() => {
    _listenerKillFuncs.spawnFn = origSpawnFn;
    _listenerKillFuncs.platform = origPlatform;
    _listenerKillFuncs.killExistingListeners = origKill;
  });

  function captureSpawnEnv(): () => Record<string, string | undefined> | undefined {
    let captured: Record<string, string | undefined> | undefined;
    _listenerKillFuncs.spawnFn = vi.fn((_cmd: string, _args: string[], opts: { env?: Record<string, string | undefined> }) => {
      captured = opts?.env;
      return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn() } as unknown as ReturnType<typeof _listenerKillFuncs.spawnFn>;
    }) as unknown as typeof _listenerKillFuncs.spawnFn;
    return () => captured;
  }

  it('getModuleVersion 返回 manifest.json 的版本（非 unknown）', () => {
    expect(getModuleVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('spawn listen_chat 的 env 含 ZENITHJOY_MODULE_VERSION=manifest 版本', () => {
    const getEnv = captureSpawnEnv();
    startWechatListener('http://localhost:3000', 'test-agent');
    const env = getEnv();
    expect(env).toBeDefined();
    expect(env!.ZENITHJOY_MODULE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd services/agent && npx vitest run modules/line04/__tests__/listener-module-version-env.test.ts`
Expected: FAIL —— `getModuleVersion` 未导出。

- [ ] **Step 3: 实现** — 在 `handlers/wechat-rpa.ts` 加导出函数（`getModuleRoot` 附近，~13 行后）：

```typescript
export function getModuleVersion(): string {
  try {
    const p = path.join(getModuleRoot(), 'manifest.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}
```

并在 `spawnEnv` 组装（~190）加一行：

```typescript
  const spawnEnv = {
    ...process.env,
    REAL_PUBLISH: realPublish,
    ZENITHJOY_AGENT_REAL_PUBLISH: realPublish,
    ZENITHJOY_MODULE_VERSION: getModuleVersion(),
  };
```

- [ ] **Step 4: 跑测试确认绿**

Run: `cd services/agent && npx vitest run modules/line04/__tests__/listener-module-version-env.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add services/agent/modules/line04/handlers/wechat-rpa.ts services/agent/modules/line04/__tests__/listener-module-version-env.test.ts
git commit -m "feat(line04): spawn listen_chat 注入 ZENITHJOY_MODULE_VERSION（Phase 0 观测）"
```

---

### Task 2: Python — skip 计数器纯类

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py`（新增 `_SkipCounter` 类，放 `_log` 定义附近 ~2578）
- Test: `services/agent/wechat-rpa/tests/test_phase0_observability.py`（新建）

- [ ] **Step 1: 写失败测试** — 新建 `tests/test_phase0_observability.py`：

```python
# -*- coding: utf-8 -*-
"""Phase 0 观测埋点纯逻辑单测：skip 计数器 + build_diag（不跑微信，顶层零 pywinauto）。"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import listen_chat  # noqa: E402


def test_skip_counter_total_and_delta():
    c = listen_chat._SkipCounter()
    c.record("dup"); c.record("dup"); c.record("group")
    snap = c.snapshot()
    assert snap["total"] == {"dup": 2, "group": 1}
    assert snap["delta"] == {"dup": 2, "group": 1}


def test_skip_counter_delta_resets_after_snapshot():
    c = listen_chat._SkipCounter()
    c.record("cooldown")
    c.snapshot()  # 清 delta
    c.record("no_reply")
    snap = c.snapshot()
    assert snap["total"] == {"cooldown": 1, "no_reply": 1}
    assert snap["delta"] == {"no_reply": 1}  # 只含本周期新增
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd services/agent/wechat-rpa && python -m pytest tests/test_phase0_observability.py -q`
Expected: FAIL —— `_SkipCounter` 不存在。

- [ ] **Step 3: 实现** — 在 `listen_chat.py` `_log` 定义前加：

```python
class _SkipCounter:
    """累计每种 skip reason 计数，供心跳 diag 上报（中台可见，同事无 SSH 也能看每条为何没回）。

    total：进程启动以来累计；delta：自上次 snapshot 以来新增（snapshot 后清零）。
    纯逻辑无副作用，clean CI 可测。
    """
    def __init__(self) -> None:
        self._total: dict[str, int] = {}
        self._delta: dict[str, int] = {}

    def record(self, reason: str) -> None:
        self._total[reason] = self._total.get(reason, 0) + 1
        self._delta[reason] = self._delta.get(reason, 0) + 1

    def snapshot(self) -> dict:
        snap = {"total": dict(self._total), "delta": dict(self._delta)}
        self._delta = {}
        return snap
```

- [ ] **Step 4: 跑测试确认绿**

Run: `cd services/agent/wechat-rpa && python -m pytest tests/test_phase0_observability.py -q`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add services/agent/wechat-rpa/listen_chat.py services/agent/wechat-rpa/tests/test_phase0_observability.py
git commit -m "feat(line04): _SkipCounter 累计 skip reason（Phase 0 观测）"
```

---

### Task 3: Python — build_diag 纯函数（注入 module_version + skip_reasons）

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py`（新增 `build_diag` + 模块级 `_MODULE_VERSION`）
- Test: `services/agent/wechat-rpa/tests/test_phase0_observability.py`（追加）

- [ ] **Step 1: 追加失败测试** —— 在 `test_phase0_observability.py` 末尾加：

```python
def test_build_diag_includes_version_and_skip_reasons(monkeypatch):
    monkeypatch.setattr(listen_chat, "_MODULE_VERSION", "1.0.87")
    c = listen_chat._SkipCounter()
    c.record("dup"); c.record("group")
    diag = listen_chat.build_diag(
        main_window_found=True, login_present=False, logged_in=True,
        screen_locked=False, sessions_seen=5,
        unread_senders=["a", "b"], replied_count=1, last_error=None,
        skip_snapshot=c.snapshot(),
    )
    assert diag["module_version"] == "1.0.87"
    assert diag["skip_reasons"]["total"] == {"dup": 1, "group": 1}
    assert diag["unread_count"] == 2
    assert diag["sessions_seen"] == 5
    assert diag["replied_count"] == 1


def test_build_diag_unread_senders_capped_at_10():
    diag = listen_chat.build_diag(
        main_window_found=True, login_present=False, logged_in=True,
        screen_locked=False, sessions_seen=20,
        unread_senders=[str(i) for i in range(20)], replied_count=0,
        last_error=None, skip_snapshot={"total": {}, "delta": {}},
    )
    assert len(diag["unread_senders"]) == 10
    assert diag["unread_count"] == 20  # 计数是全量，列表截断
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd services/agent/wechat-rpa && python -m pytest tests/test_phase0_observability.py -q`
Expected: FAIL —— `build_diag` / `_MODULE_VERSION` 不存在。

- [ ] **Step 3: 实现** —— 在 `listen_chat.py` `_SkipCounter` 后加：

```python
_MODULE_VERSION = os.environ.get("ZENITHJOY_MODULE_VERSION", "unknown")


def build_diag(*, main_window_found, login_present, logged_in, screen_locked,
               sessions_seen, unread_senders, replied_count, last_error,
               skip_snapshot) -> dict:
    """组装心跳诊断 dict（纯函数，便于单测）。module_version + skip_reasons 是 Phase 0 新增，
    让中台看板显示版本 + 每条未读为何没回，无需 SSH 进客户机。"""
    return {
        "main_window_found": main_window_found,
        "login_present": login_present,
        "logged_in": logged_in,
        "screen_locked": screen_locked,
        "sessions_seen": sessions_seen,
        "unread_count": len(unread_senders),
        "unread_senders": unread_senders[:10],
        "replied_count": replied_count,
        "last_error": last_error,
        "module_version": _MODULE_VERSION,
        "skip_reasons": skip_snapshot,
    }
```

- [ ] **Step 4: 跑测试确认绿**

Run: `cd services/agent/wechat-rpa && python -m pytest tests/test_phase0_observability.py -q`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add services/agent/wechat-rpa/listen_chat.py services/agent/wechat-rpa/tests/test_phase0_observability.py
git commit -m "feat(line04): build_diag 纯函数注入 module_version+skip_reasons（Phase 0 观测）"
```

---

### Task 4: Python — 主循环接线（record_skip 各处 + 用 build_diag + stdout 时间戳）

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py`（主循环 ~2783 建计数器；~3120-3230 各 skip 点加 record；~2905 心跳块改调 build_diag；`_log` ~2580 stdout 加时间戳）

- [ ] **Step 1: 建计数器实例** —— 主循环起始（~2783 `_skip_logged` 声明附近）加：

```python
    _skip_counter = _SkipCounter()
```

- [ ] **Step 2: 各 skip 点加一行 record**（不改任何判定，只在现有 `_log(f"skip(...)")` 旁补记）：
  - `skip(<reason>)` 每客服 gate（~3122 附近）：`_skip_counter.record(_reason)`
  - `skip(dup)`（~3131）：`_skip_counter.record("dup")`
  - `skip(replied)`（~3139）：`_skip_counter.record("replied")`
  - `skip(cooldown Ns)`（~3145）：`_skip_counter.record("cooldown")`
  - rate_limiter 限额（~3152）：`_skip_counter.record("rate_limited")`
  - `skip(no reply)`（~3181）：`_skip_counter.record("no_reply")`
  - `skip(direction=...)`（~3203）：`_skip_counter.record("direction")`
  - 群跳过（reply_in_chat ~1857 在主循环外）：在主循环处理该 sender 返回后记 `_skip_counter.record("group")`（若不易定位，本 reason 可留待 Phase 1，不阻塞）

- [ ] **Step 3: 心跳块改调 build_diag**（~2905，替换手写 dict）：

```python
                diag = build_diag(
                    main_window_found=mw is not None,
                    login_present=login,
                    logged_in=logged_in,
                    screen_locked=screen_locked,
                    sessions_seen=sessions_seen,
                    unread_senders=last_unread_senders,
                    replied_count=len(replied),
                    last_error=last_error,
                    skip_snapshot=_skip_counter.snapshot(),
                )
```

并把心跳 `_log` 行补上版本 + skip：

```python
                _log(
                    f"心跳 v={diag['module_version']} found_window={diag['main_window_found']} "
                    f"login={logged_in} locked={screen_locked} sessions={sessions_seen} "
                    f"unread={diag['unread_count']}{diag['unread_senders']} replied={diag['replied_count']} "
                    f"skip={diag['skip_reasons']['delta']} err={last_error}{lock_suffix}"
                )
```

- [ ] **Step 4: `_log` stdout 加时间戳**（~2580）：

```python
def _log(msg: str) -> None:
    """同时打印 + 追加到公共日志文件。"""
    ts = time.strftime('%H:%M:%S')
    print(f"[{ts}][listen_chat] " + str(msg), flush=True)
    try:
        with open(_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except Exception:
        pass
```

- [ ] **Step 5: 跑现有回归测试确认没破**（接线不改判定，reply_loop_purity/scan_unread 必须仍绿）

Run: `cd services/agent/wechat-rpa && python -m pytest tests/test_phase0_observability.py tests/test_reply_loop_purity.py tests/test_scan_unread.py -q`
Expected: PASS（全绿）

- [ ] **Step 6: 提交**

```bash
git add services/agent/wechat-rpa/listen_chat.py
git commit -m "feat(line04): 主循环接线 skip 计数+build_diag+stdout 时间戳（Phase 0 观测）"
```

---

### Task 5: 版本 bump 三面 + 同步 build-modules + CI 点名新 test

**Files:**
- Modify: `services/agent/modules/line04/manifest.json`（version 1.0.86 → 1.0.87）
- Modify: `services/agent/build-modules/line04/manifest.json`（version 1.0.86 → 1.0.87）
- Modify: `apps/api/src/services/walking-skeleton.service.ts:74`（required_version 1.0.86 → 1.0.87）
- Sync: rsync `services/agent/wechat-rpa/` → `services/agent/build-modules/line04/wechat-rpa/`
- Modify: `.github/workflows/ci-l4-runtime.yml`（点名列表加 test_phase0_observability.py）

- [ ] **Step 1: bump 三面版本**（三处必须相等，否则「三个版本面一致」CI 守卫红）：

```bash
cd /Users/administrator/worktrees/zenithjoy/line04-phase0-obs
sed -i '' 's/"version": "1.0.86"/"version": "1.0.87"/' services/agent/modules/line04/manifest.json
sed -i '' 's/"version": "1.0.86"/"version": "1.0.87"/' services/agent/build-modules/line04/manifest.json
sed -i '' "s/required_version: '1.0.86'/required_version: '1.0.87'/" apps/api/src/services/walking-skeleton.service.ts
```

- [ ] **Step 2: rsync 同步 build-modules**（否则「build-modules in sync with source」CI 守卫红）：

```bash
rsync -av --delete --exclude='__pycache__' --exclude='*.pyc' \
  services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/
```

- [ ] **Step 3: CI 点名新 pytest**（改 ci-l4-runtime.yml「wechat-rpa 纯函数单测」job 的点名列表，末尾加 `tests/test_phase0_observability.py`）：

```yaml
          python -m pytest tests/test_scan_recent_contacts.py \
                           tests/test_friend_scan_ingest.py \
                           tests/test_friend_scan_pending.py \
                           tests/test_cs_config_gate.py \
                           tests/test_scan_unread.py \
                           tests/test_reply_loop_purity.py \
                           tests/test_phase0_observability.py -q
```

- [ ] **Step 4: 本地验三版本面一致 + build-modules 同步**：

```bash
cd /Users/administrator/worktrees/zenithjoy/line04-phase0-obs
V_MOD=$(node -e "process.stdout.write(require('./services/agent/modules/line04/manifest.json').version)")
V_BUILD=$(node -e "process.stdout.write(require('./services/agent/build-modules/line04/manifest.json').version)")
echo "mod=$V_MOD build=$V_BUILD"
diff -r services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/ --exclude='*.pyc' --exclude='__pycache__' && echo "build-modules in sync"
```

Expected: `mod=1.0.87 build=1.0.87` + `build-modules in sync`

- [ ] **Step 5: 提交**（含 [CONFIG] 标题，因为改了 .yml —— memory feedback_smoke_must_wire_into_ci）：

```bash
git add services/agent/modules/line04/manifest.json services/agent/build-modules/line04/ \
        apps/api/src/services/walking-skeleton.service.ts .github/workflows/ci-l4-runtime.yml
git commit -m "[CONFIG] feat(line04): bump 1.0.87 三面同步 + CI 点名 phase0 观测测试"
```

---

## 验收
- [ ] Task 1 vitest 绿：spawn env 含 ZENITHJOY_MODULE_VERSION
- [ ] Task 2-3 pytest 绿：_SkipCounter + build_diag（4 passed）
- [ ] Task 4：现有回归测试不破 + 主循环接线
- [ ] Task 5：三版本面一致 + build-modules 同步 + CI 点名
- [ ] push 后 CI 全绿
- [ ] 真机验（Phase 2 统一做）：rog 清干净后看中台「监听健康」显示 module_version=1.0.87 + skip 计数
