# 拆分扫描态/回复态窗口可见性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `_ensure_tray_visible`/`_restore_window_state` 加 `for_reply: bool = False` 参数，让扫描态（新默认）在 `minimized`/`visible` 分支即使 `OFFSCREEN_REPLY=False` 也做 DWM cloak（不挪坐标），回复态（`reply_in_chat` 显式 `for_reply=True`）行为完全不变。

**Architecture:** 单文件改动（`services/agent/wechat-rpa/listen_chat.py`），在 `minimized`/`visible` 两个分支各加一条 `elif not for_reply:` 独立触发 cloak-only 逻辑，优先级低于既有 `if _OFFSCREEN_REPLY:` 分支（两者互斥，不会重复触发）；`tray` 分支已经无条件 cloak，不用改。`_restore_window_state` 的 uncloak 判断条件加 `or not for_reply` 覆盖新场景。坐标搬移/UIA 读取/送达确认逻辑一概不动。

**Tech Stack:** Python，pytest，`ctypes.windll` mock（沿用 `tests/test_tray_scan_fix.py`/`test_visible_bg_fix.py` 既有 mock 模式）。

---

## 文件清单

- Modify: `services/agent/wechat-rpa/listen_chat.py`（`_ensure_tray_visible` L490-589、`_restore_window_state` L592-647、`reply_in_chat` L2976/L3046）
- Modify: `services/agent/wechat-rpa/tests/test_tray_scan_fix.py`（更新一条与新默认行为矛盾的旧测试，新增 for_reply 对照组测试）
- Modify: `services/agent/build-modules/line04/wechat-rpa/listen_chat.py`（与源文件保持镜像同步，构建产物）
- Modify: `services/agent/build-modules/line04/manifest.json`、`services/agent/modules/line04/manifest.json`、`apps/api/src/services/walking-skeleton.service.ts`、`apps/api/src/services/walking-skeleton.service.test.ts`、`apps/api/tests/routes/heartbeat-modules.test.ts`（版本号 1.0.131 → 1.0.132，5 处）
- Modify: `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`（新增 Step 3g）

---

### Task 1：`_ensure_tray_visible` 加 `for_reply` 参数，minimized 分支解耦 cloak

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py:490-568`
- Test: `services/agent/wechat-rpa/tests/test_tray_scan_fix.py`

- [ ] **Step 1: 写失败测试**——扫描态（默认 `for_reply=False`）下最小化窗口即使 `OFFSCREEN_REPLY=False` 也必须 cloak

在 `tests/test_tray_scan_fix.py` 末尾追加：

```python
def test_ensure_tray_visible_minimized_scan_state_cloaks_when_offscreen_off():
    """扫描态(for_reply=False,默认)：最小化窗口即使 OFFSCREEN_REPLY=False 也必须 DWM cloak，
    防止纯扫描把窗口真实弹出可见（真机反馈闪烁根因，for_reply 参数引入）。"""
    mw = _make_mock_mw(hwnd=131)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 1

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = False
        windll_mock = MagicMock(user32=user32, kernel32=MagicMock(), dwmapi=MagicMock())
        had_windll = hasattr(ctypes, "windll")
        original_windll = getattr(ctypes, "windll", None)
        ctypes.windll = windll_mock
        try:
            with patch("time.sleep"):
                listen_chat._ensure_tray_visible(mw)
        finally:
            if had_windll:
                ctypes.windll = original_windll
            else:
                delattr(ctypes, "windll")
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    windll_mock.dwmapi.DwmSetWindowAttribute.assert_called()


def test_ensure_tray_visible_minimized_reply_state_no_cloak_when_offscreen_off():
    """回复态(for_reply=True)：最小化窗口 OFFSCREEN_REPLY=False 时不 cloak——保持 6 月 B 方案
    可见+送达确认+焦点安全行为不变（对照组）。"""
    mw = _make_mock_mw(hwnd=132)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 1

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = False
        windll_mock = MagicMock(user32=user32, kernel32=MagicMock(), dwmapi=MagicMock())
        had_windll = hasattr(ctypes, "windll")
        original_windll = getattr(ctypes, "windll", None)
        ctypes.windll = windll_mock
        try:
            with patch("time.sleep"):
                listen_chat._ensure_tray_visible(mw, for_reply=True)
        finally:
            if had_windll:
                ctypes.windll = original_windll
            else:
                delattr(ctypes, "windll")
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    windll_mock.dwmapi.DwmSetWindowAttribute.assert_not_called()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_tray_scan_fix.py -k "minimized_scan_state_cloaks or minimized_reply_state_no_cloak" -v`
Expected: `test_ensure_tray_visible_minimized_scan_state_cloaks_when_offscreen_off` FAIL（`for_reply` 参数不存在 → TypeError），`test_ensure_tray_visible_minimized_reply_state_no_cloak_when_offscreen_off` 同样 FAIL（TypeError，因为函数还不接受 `for_reply` 关键字）。

- [ ] **Step 3: 实现——函数签名加参数，minimized 分支加 elif**

修改 `listen_chat.py:490`：

```python
def _ensure_tray_visible(mw: Any, for_reply: bool = False) -> str:
```

修改 `listen_chat.py:536-568`（`elif _is_iconic:` 分支，在现有 `if _OFFSCREEN_REPLY:` 块后加 `elif not for_reply:`）：

```python
        elif _is_iconic:
            # 最小化：v1.0.33 先 DWM cloak（防 WeChat 自身 activate 时移回可视区域被用户看到）
            # v1.0.29 SetWindowPlacement 预改 rcNormalPosition → ShowWindow(4) 直接恢复到屏外
            # （v1.0.28 遗留 bug：ShowWindow(4) 先在原始坐标出现 ~50ms 再 SetWindowPos 移走，用户看到弹跳）
            if _OFFSCREEN_REPLY:
                try:
                    _cv = _ct.c_int(1)
                    _ct.windll.dwmapi.DwmSetWindowAttribute(_hwnd, 13, _ct.byref(_cv), 4)
                except Exception:
                    pass
                try:
                    class _WP(_ct.Structure):
                        _fields_ = [
                            ("length", _ct.c_uint), ("flags", _ct.c_uint), ("showCmd", _ct.c_uint),
                            ("ptMinX", _ct.c_long), ("ptMinY", _ct.c_long),
                            ("ptMaxX", _ct.c_long), ("ptMaxY", _ct.c_long),
                            ("rcLeft", _ct.c_long), ("rcTop", _ct.c_long),
                            ("rcRight", _ct.c_long), ("rcBottom", _ct.c_long),
                        ]
                    _wp = _WP()
                    _wp.length = _ct.sizeof(_WP)
                    if _ct.windll.user32.GetWindowPlacement(_hwnd, _ct.byref(_wp)):
                        _w = max(_wp.rcRight - _wp.rcLeft, 400)
                        _h = max(_wp.rcBottom - _wp.rcTop, 300)
                        _saved_normal_pos[_hwnd] = (_wp.rcLeft, _wp.rcTop, _wp.rcRight, _wp.rcBottom)
                        _wp.rcLeft, _wp.rcTop = _OFFSCREEN_X, _OFFSCREEN_Y
                        _wp.rcRight, _wp.rcBottom = _OFFSCREEN_X + _w, _OFFSCREEN_Y + _h
                        _ct.windll.user32.SetWindowPlacement(_hwnd, _ct.byref(_wp))
                except Exception:
                    pass
            elif not for_reply:
                # 扫描态（for_reply=False，新默认）：即使 OFFSCREEN_REPLY=False 也要 cloak，
                # 只隐身不挪坐标——纯扫描不该让用户看到窗口弹出（真机反馈闪烁根因，2026-07-17）
                try:
                    _cv = _ct.c_int(1)
                    _ct.windll.dwmapi.DwmSetWindowAttribute(_hwnd, 13, _ct.byref(_cv), 4)
                except Exception:
                    pass
            _ct.windll.user32.ShowWindow(_hwnd, 4)  # SW_SHOWNOACTIVATE = 4：恢复到 rcNormalPosition（已改为离屏）
            time.sleep(_MINIMIZED_RESTORE_SLEEP)  # 最小化恢复比托盘需要更长 UIA 树重建时间
            return 'minimized'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_tray_scan_fix.py -k "minimized_scan_state_cloaks or minimized_reply_state_no_cloak" -v`
Expected: 两条都 PASS

- [ ] **Step 5: 跑本文件全量测试确认无回归**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_tray_scan_fix.py -v`
Expected: 全部 PASS（含之前已有的最小化相关测试）

- [ ] **Step 6: Commit**

```bash
git add services/agent/wechat-rpa/listen_chat.py services/agent/wechat-rpa/tests/test_tray_scan_fix.py
git commit -m "test: 扫描态最小化窗口须cloak的失败测试+实现for_reply参数解耦"
```

---

### Task 2：`_ensure_tray_visible` 的 `visible` 分支同样解耦 cloak

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py:569-589`
- Test: `services/agent/wechat-rpa/tests/test_tray_scan_fix.py`

- [ ] **Step 1: 写失败测试 + 更新一条与新默认行为矛盾的旧测试**

`tests/test_tray_scan_fix.py` 里已有 `test_ensure_tray_visible_visible_no_call`（断言 `OFFSCREEN_REPLY=False` 时可见非最小化窗口 `_ensure_tray_visible(mw)` 返回 `''` 且完全不动）——这条测试的默认调用（`for_reply` 缺省 `False`）在本次改动后行为**必须**变成"cloak 但不挪坐标"，返回值变成 `'visible'`。把它替换为：

```python
def test_ensure_tray_visible_visible_scan_state_cloaks_but_no_move():
    """扫描态(for_reply=False,默认)：可见非最小化窗口，OFFSCREEN_REPLY=False 时必须 cloak
    但不挪坐标——真机反馈闪烁修复(for_reply 参数引入，2026-07-17)。取代旧版
    test_ensure_tray_visible_visible_no_call（旧版断言完全不动，是本次要修的 bug 本身）。"""
    mw = _make_mock_mw(hwnd=99)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 0  # 非最小化

    with _mock_windll(user32) as windll_mock, patch("time.sleep"):
        result = listen_chat._ensure_tray_visible(mw)

    assert result == 'visible', f"扫描态可见非最小化窗口必须返回 'visible'(cloak发生过)，实际 {result!r}"
    user32.ShowWindow.assert_not_called()
    user32.SetWindowPos.assert_not_called()
    windll_mock.dwmapi.DwmSetWindowAttribute.assert_called()


def test_ensure_tray_visible_visible_reply_state_untouched_when_offscreen_off():
    """回复态(for_reply=True)：可见非最小化窗口 OFFSCREEN_REPLY=False 时保持今天的完全不动
    行为（不 cloak、不挪坐标）——6 月 B 方案的送达确认+焦点安全场景，对照组。"""
    mw = _make_mock_mw(hwnd=100)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 0

    with _mock_windll(user32) as windll_mock, patch("time.sleep"):
        result = listen_chat._ensure_tray_visible(mw, for_reply=True)

    assert result == '', f"回复态 OFFSCREEN_REPLY=False 必须返回 ''，实际 {result!r}"
    user32.ShowWindow.assert_not_called()
    user32.SetWindowPos.assert_not_called()
    windll_mock.dwmapi.DwmSetWindowAttribute.assert_not_called()
```

删掉旧的 `test_ensure_tray_visible_visible_no_call`（找到该函数定义，整段删除——它断言的行为就是本次要修的 bug）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_tray_scan_fix.py -k "visible_scan_state_cloaks or visible_reply_state_untouched" -v`
Expected: `test_ensure_tray_visible_visible_scan_state_cloaks_but_no_move` FAIL（`result == ''`，还没实现 cloak-only 分支）；`test_ensure_tray_visible_visible_reply_state_untouched_when_offscreen_off` 因 `for_reply` 参数不存在 FAIL（TypeError，Task 1 已加了参数所以这条其实会因返回值不对而非 TypeError——若 Task 1 已完成，这条应该已经 PASS，确认一下）。

- [ ] **Step 3: 实现——visible 分支加 elif**

修改 `listen_chat.py:569-589`：

```python
        else:
            # 可见非最小化（SPI 激活后常见后台状态）：v1.0.33 cloak 仅在确认需要移动时才执行
            # （避免 already-offscreen 时 cloak 无配对 uncloak）
            if _OFFSCREEN_REPLY:
                _rc = _wt.RECT()
                _ct.windll.user32.GetWindowRect(_hwnd, _ct.byref(_rc))
                if _rc.left > -2000:
                    try:
                        _cv = _ct.c_int(1)
                        _ct.windll.dwmapi.DwmSetWindowAttribute(_hwnd, 13, _ct.byref(_cv), 4)
                    except Exception:
                        pass
                    _SWP = 0x0001 | 0x0004 | 0x0010  # NOSIZE | NOZORDER | NOACTIVATE
                    with _saved_normal_pos_lock:
                        _saved_visible_pos[_hwnd] = (_rc.left, _rc.top)
                    _ct.windll.user32.SetWindowPos(_hwnd, 0, _OFFSCREEN_X, _OFFSCREEN_Y, 0, 0, _SWP)
                    time.sleep(_VISIBLE_MOVE_SLEEP)
                    return 'visible'
            elif not for_reply:
                # 扫描态（for_reply=False，新默认）：不挪坐标，只 cloak 让用户看不见（真机反馈
                # 闪烁根因——B 方案默认 OFFSCREEN_REPLY=False 后这个分支之前整体跳过，
                # 纯扫描真实可见弹出，2026-07-17）
                try:
                    _cv = _ct.c_int(1)
                    _ct.windll.dwmapi.DwmSetWindowAttribute(_hwnd, 13, _ct.byref(_cv), 4)
                except Exception:
                    pass
                return 'visible'
    except Exception:
        pass
    return ''
```

（注意：`except Exception: pass` 和末尾 `return ''` 是函数原有的收尾代码，缩进层级不变，只是在 `if _OFFSCREEN_REPLY:` 块后新增 `elif not for_reply:` 块。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_tray_scan_fix.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent/wechat-rpa/listen_chat.py services/agent/wechat-rpa/tests/test_tray_scan_fix.py
git commit -m "feat: visible分支扫描态cloak解耦，删除与新行为矛盾的旧测试"
```

---

### Task 3：`_restore_window_state` 加 `for_reply` 参数，uncloak 条件覆盖新场景

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py:592-647`
- Test: `services/agent/wechat-rpa/tests/test_tray_scan_fix.py`

- [ ] **Step 1: 写失败测试**——扫描态 cloak 过的 `minimized`/`visible` 状态必须被 uncloak，且不触发坐标还原

```python
def test_restore_window_state_scan_state_uncloaks_minimized_no_coord_restore():
    """扫描态(for_reply=False,默认)cloak 过的 minimized 状态，_restore_window_state 必须
    uncloak，且不触碰 SetWindowPlacement（没挪过坐标，没什么好还原的）。"""
    mw = _make_mock_mw(hwnd=141)
    user32 = MagicMock()

    windll_mock = MagicMock(user32=user32, kernel32=MagicMock(), dwmapi=MagicMock())
    had_windll = hasattr(ctypes, "windll")
    original_windll = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    try:
        listen_chat._restore_window_state(mw, 'minimized')
    finally:
        if had_windll:
            ctypes.windll = original_windll
        else:
            delattr(ctypes, "windll")

    windll_mock.dwmapi.DwmSetWindowAttribute.assert_called()
    uncloak_call = windll_mock.dwmapi.DwmSetWindowAttribute.call_args_list[-1][0]
    assert uncloak_call[1] == 13 and uncloak_call[2]._obj.value == 0, "最后一次调用必须是 uncloak(cv=0)"


def test_restore_window_state_reply_state_no_uncloak_when_offscreen_off():
    """回复态(for_reply=True)且 OFFSCREEN_REPLY=False 时，_restore_window_state('minimized')
    不应触发 uncloak（因为 ensure 阶段本来就没 cloak 过，对照组）。"""
    mw = _make_mock_mw(hwnd=142)
    user32 = MagicMock()

    windll_mock = MagicMock(user32=user32, kernel32=MagicMock(), dwmapi=MagicMock())
    had_windll = hasattr(ctypes, "windll")
    original_windll = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = False
        listen_chat._restore_window_state(mw, 'minimized', for_reply=True)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen
        if had_windll:
            ctypes.windll = original_windll
        else:
            delattr(ctypes, "windll")

    windll_mock.dwmapi.DwmSetWindowAttribute.assert_not_called()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_tray_scan_fix.py -k "restore_window_state_scan_state or restore_window_state_reply_state" -v`
Expected: `test_restore_window_state_scan_state_uncloaks_minimized_no_coord_restore` FAIL（现状条件 `_OFFSCREEN_REPLY` 为 False 时不 uncloak）；第二条因 `for_reply` 关键字不存在 FAIL（TypeError）。

- [ ] **Step 3: 实现——函数签名加参数，uncloak 条件加 `or not for_reply`**

修改 `listen_chat.py:592`：

```python
def _restore_window_state(mw: Any, original_state: str, for_reply: bool = False) -> None:
```

修改 `listen_chat.py:640`（uncloak 判断）：

```python
        # DWM uncloak（与 _ensure_tray_visible 中的 cloak 配对，v1.0.93；for_reply 解耦 2026-07-17）
        # tray 分支无论 OFFSCREEN_REPLY 都 cloak；minimized/visible 分支：OFFSCREEN_REPLY=True
        # 时走legacy挪坐标+cloak路径，for_reply=False（扫描态）时走新的cloak-only路径——
        # 两条路径任一发生过 cloak，这里都要 uncloak
        if original_state == 'tray' or (original_state and (_OFFSCREEN_REPLY or not for_reply)):
            try:
                _cv = _ct.c_int(0)
                _ct.windll.dwmapi.DwmSetWindowAttribute(_hwnd, 13, _ct.byref(_cv), 4)
            except Exception:
                pass
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_tray_scan_fix.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent/wechat-rpa/listen_chat.py services/agent/wechat-rpa/tests/test_tray_scan_fix.py
git commit -m "feat: _restore_window_state加for_reply参数,uncloak条件覆盖扫描态cloak"
```

---

### Task 4：`reply_in_chat` 显式传 `for_reply=True`（回归锚点）

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py:2976,3046`
- Test: `services/agent/wechat-rpa/tests/test_tray_scan_fix.py`

- [ ] **Step 1: 写失败测试**——源码静态断言 `reply_in_chat` 显式传了 `for_reply=True`

```python
def test_reply_in_chat_source_passes_for_reply_true():
    """回归锚点：reply_in_chat 对 _ensure_tray_visible/_restore_window_state 的调用必须
    显式传 for_reply=True，防止以后被误改回默认值（扫描态的 cloak-only 行为混进回复态
    会导致回复时窗口被隐身，UIA 坐标失效/送达确认读不到）。"""
    import inspect
    src = inspect.getsource(listen_chat.reply_in_chat)
    assert '_ensure_tray_visible(mw, for_reply=True)' in src, \
        "reply_in_chat 必须显式 _ensure_tray_visible(mw, for_reply=True)"
    assert '_restore_window_state(mw, orig_state, for_reply=True)' in src, \
        "reply_in_chat 必须显式 _restore_window_state(mw, orig_state, for_reply=True)"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_tray_scan_fix.py -k "reply_in_chat_source_passes_for_reply_true" -v`
Expected: FAIL（源码里还是 `_ensure_tray_visible(mw)` / `_restore_window_state(mw, orig_state)`，没有 `for_reply=True`）

- [ ] **Step 3: 实现——改调用点**

修改 `listen_chat.py:2976`：

```python
    orig_state = _ensure_tray_visible(mw, for_reply=True)
```

修改 `listen_chat.py:3046`：

```python
        _restore_window_state(mw, orig_state, for_reply=True)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_tray_scan_fix.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent/wechat-rpa/listen_chat.py services/agent/wechat-rpa/tests/test_tray_scan_fix.py
git commit -m "feat: reply_in_chat显式传for_reply=True,保留6月B方案行为不变"
```

---

### Task 5：全量回归 + 变异测试证明

**Files:**
- Test: `services/agent/wechat-rpa/tests/`（全量）

- [ ] **Step 1: 跑 wechat-rpa 全量测试套件**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/ -v 2>&1 | tail -80`
Expected: 全部 PASS（除本 session 已知的 pre-existing flaky 外）。若有非本次改动引入的失败，先核对是否 pre-existing（`git stash` 后重跑对比）。

- [ ] **Step 2: 变异测试——证明新测试真的能报红**

临时把 `listen_chat.py` 里 Task 2 新加的 `elif not for_reply:`（visible 分支）改成 `elif False and not for_reply:`（永假，模拟"改错/被误删"），重跑：

```bash
cd services/agent/wechat-rpa
python3 -c "
import re
with open('listen_chat.py') as f:
    content = f.read()
mutated = content.replace(
    '            elif not for_reply:\n                # 扫描态（for_reply=False，新默认）：不挪坐标',
    '            elif False and not for_reply:\n                # 扫描态（for_reply=False，新默认）：不挪坐标',
    1
)
assert mutated != content, '未命中替换目标，检查锚点文本'
with open('listen_chat.py', 'w') as f:
    f.write(mutated)
"
python3 -m pytest tests/test_tray_scan_fix.py -k "visible_scan_state_cloaks" -v
```

Expected: `test_ensure_tray_visible_visible_scan_state_cloaks_but_no_move` **FAIL**（证明测试真的在盯着这条逻辑）。

- [ ] **Step 3: 还原变异**

```bash
git checkout -- services/agent/wechat-rpa/listen_chat.py
python3 -m pytest tests/test_tray_scan_fix.py -v
```

Expected: 全部 PASS（确认还原干净）

（本 Task 不产生新 commit，纯验证步骤）

---

### Task 6：build-modules 镜像同步 + manifest version bump

**Files:**
- Modify: `services/agent/build-modules/line04/wechat-rpa/listen_chat.py`
- Modify: `services/agent/build-modules/line04/manifest.json`
- Modify: `services/agent/modules/line04/manifest.json`
- Modify: `apps/api/src/services/walking-skeleton.service.ts:77`
- Modify: `apps/api/src/services/walking-skeleton.service.test.ts:160,162`
- Modify: `apps/api/tests/routes/heartbeat-modules.test.ts:78`

- [ ] **Step 1: 同步 build-modules 镜像文件**

```bash
cp services/agent/wechat-rpa/listen_chat.py services/agent/build-modules/line04/wechat-rpa/listen_chat.py
diff services/agent/wechat-rpa/listen_chat.py services/agent/build-modules/line04/wechat-rpa/listen_chat.py
```

Expected: diff 无输出（完全一致）

- [ ] **Step 2: bump 5 处版本号 1.0.131 → 1.0.132**

```bash
sed -i '' 's/"version": "1.0.131"/"version": "1.0.132"/' services/agent/build-modules/line04/manifest.json
sed -i '' 's/"version": "1.0.131"/"version": "1.0.132"/' services/agent/modules/line04/manifest.json
sed -i '' "s/required_version: '1.0.131'/required_version: '1.0.132'/" apps/api/src/services/walking-skeleton.service.ts
sed -i '' "s/'1.0.131'/'1.0.132'/g" apps/api/src/services/walking-skeleton.service.test.ts
sed -i '' "s/'1.0.131'/'1.0.132'/" apps/api/tests/routes/heartbeat-modules.test.ts
grep -rn "1\.0\.132" services/agent/build-modules/line04/manifest.json services/agent/modules/line04/manifest.json apps/api/src/services/walking-skeleton.service.ts apps/api/src/services/walking-skeleton.service.test.ts apps/api/tests/routes/heartbeat-modules.test.ts
```

Expected: 5 个文件都能 grep 到 `1.0.132`

- [ ] **Step 3: 跑相关 TS 测试确认版本号一致性测试通过**

Run: `cd apps/api && npx vitest run src/services/walking-skeleton.service.test.ts tests/routes/heartbeat-modules.test.ts 2>&1 | tail -40`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/agent/build-modules/line04/wechat-rpa/listen_chat.py \
        services/agent/build-modules/line04/manifest.json \
        services/agent/modules/line04/manifest.json \
        apps/api/src/services/walking-skeleton.service.ts \
        apps/api/src/services/walking-skeleton.service.test.ts \
        apps/api/tests/routes/heartbeat-modules.test.ts
git commit -m "chore: 同步build-modules镜像+版本号bump 1.0.131→1.0.132"
```

---

### Task 7：golden-path-4-smoke.sh 新增 Step 3g

**Files:**
- Modify: `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`

- [ ] **Step 1: 在现有 Step 3f 之后、收尾 echo 之前插入 Step 3g**

在文件里找到 Step 3f 的结尾（`|| fail "Step 3f 扫描前守卫 cooldown 回归——真机可能又会反复 maximize/minimize" 3`）之后、`echo "━━━...` 收尾块之前插入：

```bash
# Step 3g：扫描态/回复态窗口可见性拆分——纯扫描 cloak 静默，回复态保留可见+送达确认
# （2026-07-17 用户真机反馈：微信窗口每隔十几秒弹出来又缩回去，根因=scan_unread每轮
# 都真实弹窗；修法=_ensure_tray_visible/_restore_window_state 加 for_reply 参数）
# 真机段 TODO：xian-rog 验证窗口不再每隔十几秒弹出/缩回，同时确认真有消息时依然可见+能正常回复送达
python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat, inspect
ensure_src = inspect.getsource(listen_chat._ensure_tray_visible)
restore_src = inspect.getsource(listen_chat._restore_window_state)
reply_src = inspect.getsource(listen_chat.reply_in_chat)
assert 'for_reply: bool = False' in ensure_src, '_ensure_tray_visible 缺 for_reply 参数'
assert 'for_reply: bool = False' in restore_src, '_restore_window_state 缺 for_reply 参数'
assert '_ensure_tray_visible(mw, for_reply=True)' in reply_src, 'reply_in_chat 未显式传 for_reply=True'
assert '_restore_window_state(mw, orig_state, for_reply=True)' in reply_src, 'reply_in_chat 还原调用未显式传 for_reply=True'
print('PASS')
" 2>/dev/null && ok "Step 3g ✅ 扫描态/回复态窗口可见性已拆分（for_reply参数+3处调用点正确传参）" \
             || fail "Step 3g 扫描态/回复态可见性拆分回归——真机可能又会每隔几秒弹出/缩回" 3
```

- [ ] **Step 2: 本地跑一次这段 python 断言确认 PASS**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat, inspect
ensure_src = inspect.getsource(listen_chat._ensure_tray_visible)
restore_src = inspect.getsource(listen_chat._restore_window_state)
reply_src = inspect.getsource(listen_chat.reply_in_chat)
assert 'for_reply: bool = False' in ensure_src
assert 'for_reply: bool = False' in restore_src
assert '_ensure_tray_visible(mw, for_reply=True)' in reply_src
assert '_restore_window_state(mw, orig_state, for_reply=True)' in reply_src
print('PASS')
"
```
Expected: 输出 `PASS`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/scripts/smoke/golden-path-4-smoke.sh
git commit -m "test: golden-path-4-smoke新增Step3g扫描态回复态可见性拆分断言"
```

---

## 完成后

全部 7 个 Task 完成后：
- `services/agent/wechat-rpa/` 全量测试绿
- `apps/api` 相关版本号测试绿
- `golden-path-4-smoke.sh` 本地跑一遍全部 Step 应 PASS（含新 Step 3g）
- 交给 `engine-ship` → `engine-pr-watchdog` 走完 push+PR+CI+merge 流程
