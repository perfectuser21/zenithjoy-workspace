# wechat-rpa 三修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复微信客服 RPA 三个真机实证根因：主窗口非最大化漏检测（A/P0）、欢迎回来屏无自动点击（B/P1）、回顶导航按钮绝对坐标+无前台点击（C/P1）。

**Architecture:** 全部改动在 `services/agent/wechat-rpa/`（listen_chat.py + find_weixin.py）。每修一律"纯函数（CI 可测）+ 主循环粘合（防御式 try/except，绝不拖垮监听）"。点击必须先 AttachThreadInput 拉前台（复用现有 `_set_foreground_window`），操作完按 `_should_restore_foreground` 还原焦点。

**Tech Stack:** Python + pywinauto（UIA）+ ctypes（Win32）。测试 = pytest，stub 模式照抄 `tests/test_login_state.py` 的 `_stub_heavy_deps()`。

**Spec:** `docs/superpowers/specs/2026-07-08-wechat-rpa-three-fixes-design.md`

## Global Constraints

- 语言：代码注释/日志/commit message 全部简体中文。
- TDD 铁律：每个 Task commit-1 = failing test（红），commit-2 = 实现（绿）。NO PRODUCTION CODE WITHOUT FAILING TEST FIRST。
- 铁律（decisions invariant）：回复循环不准新增滚动/开群逻辑。
- 所有主循环粘合代码必须 try/except 吞掉异常（心跳/自愈不能拖垮监听）。
- 测试运行方式：`cd services/agent/wechat-rpa && python -m pytest tests/<file> -v`（CI job2 跑 `pytest tests/ -q`）。
- 改了 wechat-rpa 非测试文件 → 必须 bump `services/agent/build-modules/line04/manifest.json` version 1.0.113 → 1.0.114（CI 闸 lint-line04-manifest-version-bump 强制）。
- 禁止改 `_scroll_session_list_wheel` / scan_unread 的扫描语义。

---

### Task 1: 修 C — `_find_left_nav_button_point` 窗口相对坐标

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py:1330-1346`（`_find_left_nav_button_point`）
- Test: `services/agent/wechat-rpa/tests/test_nav_button_relative.py`（新建）

**Interfaces:**
- Produces: `_find_left_nav_button_point(buttons, name, left_max=90, win_left=0) -> Optional[tuple]`——新增关键字参数 `win_left`（主窗口 rect.left），判定 `r.left - win_left < left_max`。`win_left=0` 时与旧行为完全一致（向后兼容）。

- [ ] **Step 1: Write the failing test**

创建 `services/agent/wechat-rpa/tests/test_nav_button_relative.py`：

```python
"""回归测试（2026-07-08 真机取证，issue 8e163d87 / skill §2.I）：

真机现象：微信窗口不贴屏幕左边缘（如 rect.left=964）时，_reset_session_list_to_top
永远报"导航按钮不全"，回顶失败 → job3 gate 连续失败 / 视口外会话永远切不到。
根因：_find_left_nav_button_point 的 left_max=90 判的是【屏幕绝对坐标】r.left<90，
只有窗口最大化（left=0）时才碰巧成立。
修法：新增 win_left 参数（主窗口 rect.left），判定改窗口相对坐标 r.left-win_left<left_max。

本文件是永久 regression test，禁止删除。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock


def _stub_heavy_deps():
    for name in ["pywinauto", "pywinauto.application",
                 "pywinauto.controls", "pywinauto.controls.uia_controls"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.Desktop = MagicMock()
            sys.modules[name] = mod
    for name in ["requests"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.get = MagicMock()
            mod.post = MagicMock()
            sys.modules[name] = mod


HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, WECHAT_RPA_DIR)
_stub_heavy_deps()

import listen_chat  # noqa: E402


class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


def test_window_not_at_screen_left_edge_found_with_win_left():
    """真机场景：窗口在 x=964，导航按钮 rect.left=964。传 win_left=964 必须找到。"""
    buttons = [("通讯录", _Rect(964, 673, 1054, 727)), ("微信", _Rect(964, 601, 1054, 655))]
    pt = listen_chat._find_left_nav_button_point(buttons, "通讯录", win_left=964)
    assert pt == ((964 + 1054) // 2, (673 + 727) // 2)


def test_old_absolute_behavior_kept_when_win_left_zero():
    """win_left=0（缺省）= 旧行为：最大化窗口（按钮 left=0）找得到。"""
    buttons = [("通讯录", _Rect(0, 216, 90, 270))]
    pt = listen_chat._find_left_nav_button_point(buttons, "通讯录")
    assert pt == (45, 243)


def test_right_side_same_name_control_not_selected():
    """右侧同名控件（相对 x >= left_max）不选——原有防串规则在相对坐标下保持。"""
    buttons = [("微信", _Rect(1081, 493, 1129, 523))]  # 标题栏"微信"文字按钮，窗口 left=964
    assert listen_chat._find_left_nav_button_point(buttons, "微信", win_left=964) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/administrator/worktrees/zenithjoy/wechat-rpa-three-fixes/services/agent/wechat-rpa && python -m pytest tests/test_nav_button_relative.py -v`
Expected: FAIL —— `test_window_not_at_screen_left_edge_found_with_win_left` 报 `TypeError: _find_left_nav_button_point() got an unexpected keyword argument 'win_left'`

- [ ] **Step 3: Commit failing test**

```bash
cd /Users/administrator/worktrees/zenithjoy/wechat-rpa-three-fixes
git add services/agent/wechat-rpa/tests/test_nav_button_relative.py
git commit -m "test(wechat-rpa): 回顶导航按钮绝对坐标 bug 回归测试（红）——窗口不贴左边缘必失败"
```

- [ ] **Step 4: Write minimal implementation**

修改 `listen_chat.py` 的 `_find_left_nav_button_point`（约 1330 行）为：

```python
def _find_left_nav_button_point(
    buttons: List[tuple], name: str, left_max: int = 90, win_left: int = 0
) -> Optional[tuple]:
    """在最左导航栏（相对窗口左缘 rect.left - win_left < left_max）按 name 找按钮，
    返回其中心屏幕坐标点（纯函数）。

    入参 buttons = [(name, rect), ...]，rect 有 .left/.top/.right/.bottom。
    win_left = 主窗口 rect.left。2026-07-08 真机实锤（issue 8e163d87）：旧版判
    屏幕绝对坐标 r.left < 90，窗口不贴屏幕左边缘（如 left=964）时导航按钮永远
    "不全" → 回顶失败。改窗口相对坐标后与窗口位置无关；win_left=0 兼容旧调用。
    右侧同名控件（相对 x >= left_max）不选。
    """
    for nm, r in buttons:
        if nm != name:
            continue
        try:
            if r.left - win_left < left_max:
                return ((r.left + r.right) // 2, (r.top + r.bottom) // 2)
        except AttributeError:
            continue
    return None
```

- [ ] **Step 5: Run tests to verify pass + 全量回归**

Run: `python -m pytest tests/test_nav_button_relative.py -v` → Expected: 3 PASS
Run: `python -m pytest tests/ -q` → Expected: 全绿（无既有测试破坏）

- [ ] **Step 6: Commit**

```bash
git add services/agent/wechat-rpa/listen_chat.py
git commit -m "fix(wechat-rpa): 回顶导航按钮定位改窗口相对坐标——窗口不贴屏幕左边缘时永远'导航按钮不全'根治（绿）"
```

---

### Task 2: 修 A — `window_needs_maximize` 纯函数 + build_diag 扩展

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py`（`build_diag` 约 3793 行；新纯函数放它上方）
- Test: `services/agent/wechat-rpa/tests/test_window_maximize_heal.py`（新建）

**Interfaces:**
- Produces: `window_needs_maximize(is_zoomed: bool, is_iconic: bool) -> bool`
- Produces: `build_diag(..., window_state=None, welcome_click_fails=0)`——两个新关键字参数（带默认值，旧调用不破坏），diag dict 新增键 `window_state` / `welcome_click_fails`。（`welcome_click_fails` 供 Task 3/4 的欢迎屏自愈上报用。）

- [ ] **Step 1: Write the failing test**

创建 `services/agent/wechat-rpa/tests/test_window_maximize_heal.py`（文件头 `_stub_heavy_deps` + sys.path 段与 Task 1 Step 1 完全相同，此处省略不再重复，实现时原样复制）：

```python
"""回归测试（2026-07-08 真机取证，issue 99741ff9 / skill §2.K）：

真机现象：主窗口 630x622 非最大化时微信进【单栏布局】，会话列表整个不在 UIA 树，
scan_unread 读到的是聊天气泡（sessions=4 假象），新消息 20 分钟无反应且日志"一切正常"。
SW_MAXIMIZE 后 sessions 4→26 立即恢复。微信重启后默认非最大化 → 每次自愈重启都掉坑。
修法：心跳检测 可见+非最大化 → 自动 SW_MAXIMIZE 自愈；iconic（托盘/最小化）是合法
运行态不动（强行弹窗打扰客户机操作者）。

本文件是永久 regression test，禁止删除。
"""
# ...（_stub_heavy_deps + sys.path 段，同 test_nav_button_relative.py）...

import listen_chat  # noqa: E402


def test_visible_not_maximized_needs_heal():
    assert listen_chat.window_needs_maximize(is_zoomed=False, is_iconic=False) is True


def test_already_maximized_no_heal():
    assert listen_chat.window_needs_maximize(is_zoomed=True, is_iconic=False) is False


def test_iconic_tray_state_untouched():
    """最小化/托盘是合法运行态（'微信最小化也能跑'），绝不强行弹最大化窗口。"""
    assert listen_chat.window_needs_maximize(is_zoomed=False, is_iconic=True) is False


def test_build_diag_carries_window_state_and_welcome_fails():
    diag = listen_chat.build_diag(
        main_window_found=True, login_present=False, logged_in=True,
        screen_locked=False, sessions_seen=26, unread_senders=[],
        replied_count=0, last_error=None, skip_snapshot={"delta": {}},
        window_state={"zoomed": True, "iconic": False, "w": 2560, "h": 1528,
                      "maximize_heals": 1},
        welcome_click_fails=0,
    )
    assert diag["window_state"]["zoomed"] is True
    assert diag["window_state"]["maximize_heals"] == 1
    assert diag["welcome_click_fails"] == 0


def test_build_diag_backward_compatible_without_new_args():
    """旧调用（不带新参数）不破坏：新键有安全默认值。"""
    diag = listen_chat.build_diag(
        main_window_found=True, login_present=False, logged_in=True,
        screen_locked=False, sessions_seen=5, unread_senders=[],
        replied_count=0, last_error=None, skip_snapshot={"delta": {}},
    )
    assert diag["window_state"] == {}
    assert diag["welcome_click_fails"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_window_maximize_heal.py -v`
Expected: FAIL —— `AttributeError: module 'listen_chat' has no attribute 'window_needs_maximize'`

- [ ] **Step 3: Commit failing test**

```bash
git add services/agent/wechat-rpa/tests/test_window_maximize_heal.py
git commit -m "test(wechat-rpa): 主窗口非最大化单栏模式漏检测回归测试（红）"
```

- [ ] **Step 4: Write minimal implementation**

在 `listen_chat.py` 的 `build_diag` 上方新增：

```python
# 窗口自愈冷却（issue 99741ff9）：可见非最大化 → SW_MAXIMIZE，300s 冷却防与操作者拉锯
_WINDOW_MAXIMIZE_COOLDOWN = 300


def window_needs_maximize(is_zoomed: bool, is_iconic: bool) -> bool:
    """纯函数(CI可测)：主窗口是否需要最大化自愈（issue 99741ff9，2026-07-08 真机坐实）。

    窗口宽 <~700px 时微信进单栏布局，会话列表整个不在 UIA 树（scan 读到聊天气泡），
    新消息永远检测不到且心跳"一切正常"极隐蔽；微信重启后默认非最大化必掉坑。
    只救【可见+非最大化】；iconic（托盘/最小化）是合法运行态（"微信最小化也能跑"），
    强行弹最大化窗口会打扰客户机操作者，绝不动。
    """
    return (not is_iconic) and (not is_zoomed)
```

`build_diag` 改为：

```python
def build_diag(*, main_window_found, login_present, logged_in, screen_locked,
               sessions_seen, unread_senders, replied_count, last_error,
               skip_snapshot, window_state=None, welcome_click_fails=0) -> dict:
    """组装心跳诊断 dict（纯函数，便于单测）。module_version + skip_reasons 是 Phase 0 新增，
    让中台看板显示版本 + 每条未读为何没回，无需 SSH 进客户机。
    window_state / welcome_click_fails（2026-07-08）：窗口最大化自愈 + 欢迎屏点击自愈观测。"""
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
        "window_state": window_state or {},
        "welcome_click_fails": welcome_click_fails,
    }
```

- [ ] **Step 5: Run tests to verify pass + 全量回归**

Run: `python -m pytest tests/test_window_maximize_heal.py -v` → Expected: 5 PASS
Run: `python -m pytest tests/ -q` → Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add services/agent/wechat-rpa/listen_chat.py
git commit -m "feat(wechat-rpa): window_needs_maximize 纯函数 + 心跳 diag 窗口态/欢迎屏观测字段（绿）"
```

---

### Task 3: 修 B — 欢迎回来屏识别与重试节流纯函数

**Files:**
- Modify: `services/agent/wechat-rpa/find_weixin.py`（`is_privacy_locked` 之后追加）
- Modify: `services/agent/wechat-rpa/listen_chat.py`（`window_needs_maximize` 附近追加）
- Test: `services/agent/wechat-rpa/tests/test_welcome_screen_heal.py`（新建）

**Interfaces:**
- Produces（find_weixin.py）: `classify_login_window(button_names: list) -> str`——返回 `'welcome_screen'`（含"进入微信"）或 `'privacy_lock'`。
- Produces（find_weixin.py）: `find_welcome_enter_button() -> Optional[tuple]`——返回 `(login_hwnd, enter_button_wrapper)` 或 None（UIA 枚举，CI 不测，真机路径）。
- Produces（listen_chat.py）: `should_attempt_welcome_click(attempts: int, last_attempt_at: float, now: float, max_attempts: int = 3, cooldown: float = 120.0) -> bool`。

- [ ] **Step 1: Write the failing test**

创建 `services/agent/wechat-rpa/tests/test_welcome_screen_heal.py`（文件头 stub 段同 Task 1，另需 `import find_weixin`；find_weixin 顶层无 pywinauto import，stub 后可直接 import）：

```python
"""回归测试（2026-07-08 真机取证 + 控制性复现，issue e78d98bc / skill §2.J）：

真机现象：微信重启后 mmui::LoginWindow title='微信' 常是"欢迎回来"确认屏
（Button 进入微信/切换账号/仅传输文件，不需要密码），代码只检测不自愈 →
listener 心跳持续 locked=True sessions=0，生产静默中断直到人工点击。
实证修法：AttachThreadInput 拉前台 + click_input 点"进入微信"（DPI 假设已推翻；
UIA Invoke 和不抢前台的 PostMessage 对 mmui 按钮均无效），点击后主窗口 ~10s 出现。

本文件是永久 regression test，禁止删除。
"""
# ...（_stub_heavy_deps + sys.path 段，同 test_nav_button_relative.py）...

import find_weixin  # noqa: E402
import listen_chat  # noqa: E402


def test_welcome_screen_classified_by_enter_button():
    names = ["进入微信", "切换账号", "仅传输文件", "关闭", "网络代理设置"]
    assert find_weixin.classify_login_window(names) == "welcome_screen"


def test_privacy_lock_when_no_enter_button():
    assert find_weixin.classify_login_window([]) == "privacy_lock"
    assert find_weixin.classify_login_window(["关闭"]) == "privacy_lock"


def test_should_attempt_first_time():
    assert listen_chat.should_attempt_welcome_click(0, 0.0, 1000.0) is True


def test_should_not_attempt_within_cooldown():
    assert listen_chat.should_attempt_welcome_click(1, 1000.0, 1060.0) is False


def test_should_attempt_after_cooldown():
    assert listen_chat.should_attempt_welcome_click(1, 1000.0, 1121.0) is True


def test_should_stop_after_max_attempts():
    """3 次失败后不再点击（转人工告警），绝不无限点击。"""
    assert listen_chat.should_attempt_welcome_click(3, 0.0, 99999.0) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_welcome_screen_heal.py -v`
Expected: FAIL —— `AttributeError: module 'find_weixin' has no attribute 'classify_login_window'`

- [ ] **Step 3: Commit failing test**

```bash
git add services/agent/wechat-rpa/tests/test_welcome_screen_heal.py
git commit -m "test(wechat-rpa): 欢迎回来屏识别+重试节流回归测试（红）"
```

- [ ] **Step 4: Write minimal implementation**

find_weixin.py（`is_privacy_locked` 之后追加）：

```python
def classify_login_window(button_names: list) -> str:
    """纯函数(CI可测)：mmui::LoginWindow title='微信' 的两种真身分类（issue e78d98bc）。

    实测该窗口常是重启后的"欢迎回来"确认屏（Button 进入微信/切换账号/仅传输文件，
    不需要密码，可自动点击自愈），而非真隐私锁（需密码，只能人工）。
    按钮名含"进入微信" → 'welcome_screen'；否则保守判 'privacy_lock'。
    """
    for nm in button_names:
        if "进入微信" in (nm or ""):
            return "welcome_screen"
    return "privacy_lock"


def find_welcome_enter_button():
    """枚举欢迎回来确认屏，返回 (login_hwnd, "进入微信"按钮 wrapper)；找不到返回 None。

    2026-07-08 控制性复现坐实的树结构：mmui::LoginWindow title='微信'，
    Button "进入微信"/"切换账号"/"仅传输文件" UIA name 全暴露。
    枚举失败（UIA 未就绪）保守返回 None，不阻断监听主循环。
    """
    from pywinauto import Desktop

    try:
        for w in Desktop(backend="uia").windows():
            try:
                cls = w.element_info.class_name
                title = w.element_info.name or ""
                if cls != LOGIN_WINDOW_CLASS or title != "微信":
                    continue
                for b in w.descendants(control_type="Button"):
                    if "进入微信" in (b.element_info.name or ""):
                        return (w.element_info.handle, b)
            except Exception:
                continue
    except Exception:
        pass
    return None
```

listen_chat.py（`window_needs_maximize` 附近追加）：

```python
# 欢迎屏自愈节流（issue e78d98bc）：最多 3 次、每次间隔 120s；超限转人工告警绝不无限点击
_WELCOME_CLICK_MAX_ATTEMPTS = 3
_WELCOME_CLICK_COOLDOWN = 120.0


def should_attempt_welcome_click(
    attempts: int, last_attempt_at: float, now: float,
    max_attempts: int = _WELCOME_CLICK_MAX_ATTEMPTS,
    cooldown: float = _WELCOME_CLICK_COOLDOWN,
) -> bool:
    """纯函数(CI可测)：本轮是否允许尝试欢迎屏自动点击（重试上限 + 冷却节流）。"""
    if attempts >= max_attempts:
        return False
    return (now - last_attempt_at) >= cooldown
```

- [ ] **Step 5: Run tests to verify pass + 全量回归**

Run: `python -m pytest tests/test_welcome_screen_heal.py -v` → Expected: 6 PASS
Run: `python -m pytest tests/ -q` → Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add services/agent/wechat-rpa/find_weixin.py services/agent/wechat-rpa/listen_chat.py
git commit -m "feat(wechat-rpa): 欢迎回来屏分类/定位 + 点击重试节流纯函数（绿）"
```

---

### Task 4: 主循环粘合 — 三处自愈接线

> 本 Task 是集成粘合（真机路径，CI 无法直接验证）：逻辑内核已在 Task 1-3 被测试覆盖，
> 粘合代码全部防御式 try/except。完成后跑全量 pytest 回归 + `python -m py_compile` 冒烟。

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py`：
  - `_reset_session_list_to_top`（约 1743 行）——修 C 接线
  - `run_real_listen` 主循环状态变量区（约 4100 行）+ 取主窗口块（约 4165 行）+ 心跳块（约 4190 行）——修 A/B 接线
  - 新增模块级函数 `_attempt_welcome_screen_heal` / `_on_contacts_tab`

**Interfaces:**
- Consumes: Task 1 `_find_left_nav_button_point(..., win_left=)`；Task 2 `window_needs_maximize` / `build_diag(window_state=, welcome_click_fails=)`；Task 3 `find_weixin.find_welcome_enter_button` / `should_attempt_welcome_click`。
- Consumes（既有）: `_get_foreground_window()` / `_set_foreground_window(hwnd)` / `_should_restore_foreground(prev_fg, hwnd)` / `_click_screen_point(mw, pt)` / `_iter_all_controls(mw, "Button")`。

- [ ] **Step 1: 新增 `_on_contacts_tab` + `_attempt_welcome_screen_heal`（放 `_reset_session_list_to_top` 上方）**

```python
def _on_contacts_tab(mw: Any) -> bool:
    """当前是否在通讯录 tab：以"通讯录管理"Button 是否在树里判定。

    ⚠️ 只在【刚切完 tab、列表在顶部】时可靠——该按钮在列表顶部，用户/滚动把列表
    滚下去后会被虚拟列表滚出 UIA 树（2026-07-08 真机踩坑实录，skill §3 铁律）。
    本函数仅供 _reset_session_list_to_top 切换后的即时验证，别用作全局状态判定。
    """
    try:
        for b in mw.descendants(control_type="Button"):
            if "通讯录管理" in (b.element_info.name or ""):
                return True
    except Exception:
        pass
    return False


def _attempt_welcome_screen_heal() -> bool:
    """欢迎回来确认屏自动点击自愈（issue e78d98bc，2026-07-08 控制性复现实证）。

    实证有效路径：AttachThreadInput 拉前台（_set_foreground_window 同款）+ click_input
    真实鼠标注入。UIA Invoke / 不抢前台的 PostMessage 对 mmui 按钮均无效（真机两次
    截图坐实）；DPI 假设已推翻（pywinauto import 即置 per-monitor aware）。
    点击后主窗口 ~10s 才出现 → 轮询最长 20s。任何异常吞掉返回 False。
    """
    try:
        from find_weixin import find_welcome_enter_button, get_main_window
        found = find_welcome_enter_button()
        if not found:
            return False  # 真隐私锁或树未就绪，交回人工提示路径
        login_hwnd, enter_btn = found
        prev_fg = _get_foreground_window()
        _set_foreground_window(login_hwnd)
        time.sleep(0.5)
        try:
            enter_btn.click_input()
        except Exception as exc:
            _log(f"[欢迎屏自愈] click_input 异常: {exc}")
            return False
        deadline = time.time() + 20
        while time.time() < deadline:
            time.sleep(2)
            try:
                if get_main_window() is not None:
                    _log("[欢迎屏自愈] 已自动点『进入微信』，主窗口恢复")
                    if _should_restore_foreground(prev_fg, login_hwnd):
                        _set_foreground_window(prev_fg)
                    return True
            except Exception:
                pass
        _log("[欢迎屏自愈] 点击后 20s 主窗口未出现，本次自愈失败")
        return False
    except Exception as exc:
        _log(f"[欢迎屏自愈] 异常（已吞，不拖垮监听）: {exc}")
        return False
```

- [ ] **Step 2: 改写 `_reset_session_list_to_top`（修 C 接线）**

整函数替换为（保持"原子：先找齐两个按钮"与"绝不留在通讯录"两条既有不变量；新增：
win_left 相对坐标 / 拉前台 / PostMessage→click_input 升级梯 / 焦点归还）：

```python
def _reset_session_list_to_top(mw: Any) -> bool:
    """把会话列表弹回真顶 = 切 tab：点左侧导航「通讯录」→ 再点「微信」。

    2026-07-08 真机实锤两处根治（issue 8e163d87 / skill §2.I §2.J）：
    ① 按钮定位改窗口相对坐标（win_left）——旧绝对坐标窗口不贴屏幕左边缘必"不全"；
    ② 点击前必须拉前台（AttachThreadInput），mmui 按钮对后台 PostMessage 无响应；
       PostMessage 未生效时升级 click_input（真实鼠标注入，实证有效兜底）。
    原子不变量保持：先找齐「通讯录」+「微信」再动手；任一步失败绝不留在通讯录 tab。
    操作完按 _should_restore_foreground 归还焦点。失败吞掉返回 False（不拖垮扫描）。
    """
    try:
        try:
            win_left = mw.rectangle().left
        except Exception:
            win_left = 0
        buttons: List[tuple] = []
        wrappers: dict = {}
        for b in _iter_all_controls(mw, "Button"):
            try:
                nm = (b.element_info.name or "").strip()
                r = b.rectangle()
            except Exception:
                continue
            buttons.append((nm, r))
            if nm in ("通讯录", "微信") and r.left - win_left < 90 and nm not in wrappers:
                wrappers[nm] = b
        pt_contacts = _find_left_nav_button_point(buttons, "通讯录", win_left=win_left)
        pt_wechat = _find_left_nav_button_point(buttons, "微信", win_left=win_left)
        if pt_contacts is None or pt_wechat is None:
            _log(
                f"_reset_session_list_to_top: 导航按钮不全("
                f"通讯录={pt_contacts is not None},微信={pt_wechat is not None})，跳过切tab(不卡死会话列表)"
            )
            return False

        main_hwnd = _safe_hwnd(mw)
        prev_fg = _get_foreground_window()
        _set_foreground_window(main_hwnd)
        time.sleep(0.3)

        def _click_with_ladder(pt: tuple, nm: str, want_contacts: bool) -> bool:
            """PostMessage → 验证 → click_input 升级梯；返回切换是否生效。"""
            _click_screen_point(mw, pt)
            time.sleep(0.5)
            if _on_contacts_tab(mw) == want_contacts:
                return True
            w = wrappers.get(nm)
            if w is not None:
                try:
                    w.click_input()
                except Exception as exc:
                    _log(f"_reset_session_list_to_top: click_input({nm}) 异常: {exc}")
            time.sleep(0.5)
            return _on_contacts_tab(mw) == want_contacts

        ok = False
        try:
            if not _click_with_ladder(pt_contacts, "通讯录", want_contacts=True):
                _log("_reset_session_list_to_top: 切通讯录未生效（升级梯用尽），放弃本轮回顶")
                return False
            time.sleep(0.3)
            ok = _click_with_ladder(pt_wechat, "微信", want_contacts=False)
            if not ok:
                ok = _click_with_ladder(pt_wechat, "微信", want_contacts=False)  # 兜底重试，绝不留在通讯录
            if not ok:
                _log("_reset_session_list_to_top: ⚠️ 切回微信 tab 未确认，会话列表可能不可见（下轮自愈重试）")
        finally:
            if _should_restore_foreground(prev_fg, main_hwnd):
                _set_foreground_window(prev_fg)
        return ok
    except Exception as exc:
        _log(f"_reset_session_list_to_top: 切 tab 回顶异常: {exc}")
        return False
```

- [ ] **Step 3: 主循环状态变量 + 接线（修 A/B）**

`run_real_listen` 状态变量区（`last_readable_scan_at = 0.0` 之后）追加：

```python
    # 窗口最大化自愈（issue 99741ff9）：可见非最大化=单栏布局漏检测 → SW_MAXIMIZE（300s 冷却）
    last_window_maximize = 0.0
    maximize_heals = 0
    window_state: Dict[str, Any] = {}
    # 欢迎屏点击自愈（issue e78d98bc）：3 次上限 + 120s 冷却，超限转人工告警
    welcome_click_attempts = 0
    last_welcome_click_at = 0.0
    welcome_click_fails = 0
```

取主窗口块：在 `if mw is not None: window_lost_since = None` 之后追加修 B 接线：

```python
            # 欢迎回来确认屏自动点击自愈（issue e78d98bc）：locked 常是"欢迎回来"屏而非真隐私锁
            if mw is None and screen_locked:
                if should_attempt_welcome_click(
                    welcome_click_attempts, last_welcome_click_at, now
                ):
                    welcome_click_attempts += 1
                    last_welcome_click_at = now
                    if _attempt_welcome_screen_heal():
                        welcome_click_attempts = 0
                        try:
                            mw = get_main_window()
                            screen_locked = False
                        except Exception:
                            pass
                    else:
                        welcome_click_fails += 1
                        if welcome_click_attempts >= _WELCOME_CLICK_MAX_ATTEMPTS:
                            _log(
                                "⚠️ 告警：欢迎回来屏自动点击已达 3 次上限仍未恢复，"
                                "需人工点击『进入微信』（sessions=0 生产中断中）"
                            )
            elif mw is not None:
                welcome_click_attempts = 0
```

心跳块：在 `sessions_seen/tree_size` 采集之后、`build_diag` 之前追加修 A 接线：

```python
                # 窗口最大化自愈（issue 99741ff9）：可见非最大化=单栏布局，会话列表不在 UIA 树
                window_state = {}
                if mw is not None and platform.system() == "Windows":
                    try:
                        import ctypes as _ctm
                        _mh = _safe_hwnd(mw)
                        _zoomed = bool(_ctm.windll.user32.IsZoomed(_mh))
                        _iconic = bool(_ctm.windll.user32.IsIconic(_mh))
                        try:
                            _wr = mw.rectangle()
                            _w, _h = _wr.right - _wr.left, _wr.bottom - _wr.top
                        except Exception:
                            _w, _h = 0, 0
                        window_state = {"zoomed": _zoomed, "iconic": _iconic,
                                        "w": _w, "h": _h, "maximize_heals": maximize_heals}
                        if (window_needs_maximize(_zoomed, _iconic)
                                and now - last_window_maximize >= _WINDOW_MAXIMIZE_COOLDOWN):
                            _ctm.windll.user32.ShowWindow(_mh, 3)  # SW_MAXIMIZE
                            last_window_maximize = now
                            maximize_heals += 1
                            window_state["maximize_heals"] = maximize_heals
                            _log(f"[窗口自愈] 主窗口非最大化({_w}x{_h}，单栏布局漏检测风险)→已 SW_MAXIMIZE")
                    except Exception as exc:
                        _log(f"[窗口自愈] 检测/最大化异常（已吞）: {exc}")
```

`build_diag(...)` 调用追加两个实参：`window_state=window_state, welcome_click_fails=welcome_click_fails,`。

- [ ] **Step 4: 全量回归 + 语法冒烟**

Run: `python -m py_compile listen_chat.py find_weixin.py` → Expected: 无输出（语法过）
Run: `python -m pytest tests/ -q` → Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add services/agent/wechat-rpa/listen_chat.py
git commit -m "feat(wechat-rpa): 主循环接线三自愈——心跳窗口最大化/欢迎屏自动点击/回顶前台点击升级梯"
```

---

### Task 5: manifest 版本 bump + push

**Files:**
- Modify: `services/agent/build-modules/line04/manifest.json`（version 1.0.113 → 1.0.114）

- [ ] **Step 1: bump 版本**

`services/agent/build-modules/line04/manifest.json` 第 3 行 `"version": "1.0.113"` 改为 `"version": "1.0.114"`。
（`services/agent/modules/line04/manifest.json` 是构建产物，看 CI 闸脚本只查 build-modules；若 `bash .github/workflows/scripts/lint-line04-manifest-version-bump.sh origin/main` 本地跑仍红再同步改它。）

- [ ] **Step 2: 本地跑 CI 闸脚本验证**

Run: `cd /Users/administrator/worktrees/zenithjoy/wechat-rpa-three-fixes && bash .github/workflows/scripts/lint-line04-manifest-version-bump.sh origin/main`
Expected: exit 0（pass）

- [ ] **Step 3: Commit + push**

```bash
git add services/agent/build-modules/line04/manifest.json
git commit -m "chore(line04): bump 1.0.114——窗口最大化自愈+欢迎屏自动点击+回顶相对坐标三修"
git push -u origin cp-07081556-wechat-rpa-three-fixes
```
