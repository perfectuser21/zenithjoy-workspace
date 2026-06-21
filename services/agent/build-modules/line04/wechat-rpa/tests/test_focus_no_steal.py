"""
TDD — 窗口可见模式下「不抢前台焦点」的判定逻辑（B 方案核心，替代旧「藏窗口」框架）。

方向反转（PrepPRD §0 / memory wechat_qt_uia_works_dont_downgrade）：
  旧「静默」= 窗口不碰可见区（藏屏外）；新「静默」= 窗口可见但前台焦点不被微信抢走。
  Qt 上切会话只能 Select()，会短暂抢前台 ~2s → 用「操作后把焦点还给操作前的前台窗口」抵消。
  verify-silent 自检据此重定义：采样 GetForegroundWindow，判操作后焦点是否归还。

两个纯判定函数（顶层零-pywinauto，纯逻辑跨平台可测）：
  _should_restore_foreground(prev_fg, wechat_hwnd) — 操作后要不要还焦点
  _focus_steal_verdict(...)                         — 焦点是否最终归还 = silent
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat  # noqa: E402


# ─── _should_restore_foreground ────────────────────────────────────────────────


def test_restore_when_prev_foreground_was_other_window():
    """操作前前台是别的窗口（用户正在用的）→ 操作后应把焦点还回去。"""
    assert listen_chat._should_restore_foreground(prev_fg=100, wechat_hwnd=200) is True


def test_no_restore_when_prev_foreground_was_wechat_itself():
    """操作前前台本来就是微信 → 无需抢回别处，不还（避免把焦点推给微信自己）。"""
    assert listen_chat._should_restore_foreground(prev_fg=200, wechat_hwnd=200) is False


def test_no_restore_when_prev_foreground_unknown():
    """拿不到操作前前台（GetForegroundWindow 返回 0）→ 没有目标可还，不动。"""
    assert listen_chat._should_restore_foreground(prev_fg=0, wechat_hwnd=200) is False


# ─── _focus_steal_verdict ──────────────────────────────────────────────────────


def test_silent_when_focus_restored_to_original():
    """操作后前台 == 操作前前台 → 焦点已归还 → SILENT（不抢焦点）。"""
    v = listen_chat._focus_steal_verdict(fg_before=100, fg_after=100, steal_samples=30, total_samples=400)
    assert v["silent"] is True
    assert v["restored"] is True
    assert v["steal_samples"] == 30  # 露头次数仍量化记录供诊断（切会话瞬间会短暂抢）


def test_not_silent_when_focus_left_on_wechat():
    """操作后前台仍停在别处（≠操作前）→ 焦点没还回 → NOT SILENT。"""
    v = listen_chat._focus_steal_verdict(fg_before=100, fg_after=200, steal_samples=400, total_samples=400)
    assert v["silent"] is False
    assert v["restored"] is False


def test_silent_when_no_prior_foreground_and_focus_not_held():
    """操作前前台未知（0），操作后有个非零前台（焦点没被微信卡住）→ 容忍判 SILENT。"""
    v = listen_chat._focus_steal_verdict(fg_before=0, fg_after=300, steal_samples=0, total_samples=200)
    assert v["silent"] is True


# ─── reply_in_chat 集成：操作完把前台焦点还给操作前的窗口 ──────────────────────


class _PreviewListItem:
    def __init__(self, name: str):
        class _EI:
            pass
        self.element_info = _EI()
        self.element_info.name = name
        self.element_info.handle = 999  # 微信主窗口 hwnd（≠ 操作前前台）


class _PreviewMW:
    def __init__(self, items):
        self._items = items
        class _EI:
            pass
        self.element_info = _EI()
        self.element_info.handle = 999  # 微信主窗口 hwnd

    def descendants(self, control_type=None):
        return self._items if control_type == "ListItem" else []


def _patch_send_pipeline(monkeypatch):
    monkeypatch.setattr(listen_chat.time, "sleep", lambda *a, **k: None)
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda *a, **k: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda *a, **k: None)
    monkeypatch.setattr(listen_chat, "_open_chat", lambda *a, **k: True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda *a, **k: None)
    monkeypatch.setattr(listen_chat, "_find_chat_input", lambda m: object())
    monkeypatch.setattr(listen_chat, "_uia_send", lambda *a, **k: True)
    monkeypatch.setattr(listen_chat, "_navigate_away", lambda *a, **k: None)


def test_reply_restores_foreground_to_prewindow(monkeypatch):
    """回复完把前台焦点还给操作前那个窗口（hwnd=100，≠微信 999）→ 不抢用户焦点。"""
    _patch_send_pipeline(monkeypatch)
    monkeypatch.setattr(listen_chat, "_get_foreground_window", lambda: 100)
    restored = []
    monkeypatch.setattr(listen_chat, "_set_foreground_window", lambda h: restored.append(h))

    mw = _PreviewMW([_PreviewListItem("默忆\nTest 1234 verify\n12:45")])
    ok = listen_chat.reply_in_chat(mw, object(), "Test 1234 verify", sender="默忆")

    assert ok is True
    assert restored == [100], "回复后必须把前台焦点还给操作前的窗口（hwnd=100）"


def test_reply_no_focus_restore_when_prev_was_wechat(monkeypatch):
    """操作前前台本来就是微信（hwnd=999）→ 不还焦点（不把焦点推给微信自己）。"""
    _patch_send_pipeline(monkeypatch)
    monkeypatch.setattr(listen_chat, "_get_foreground_window", lambda: 999)  # == 微信 hwnd
    restored = []
    monkeypatch.setattr(listen_chat, "_set_foreground_window", lambda h: restored.append(h))

    mw = _PreviewMW([_PreviewListItem("默忆\nTest 1234 verify\n12:45")])
    listen_chat.reply_in_chat(mw, object(), "Test 1234 verify", sender="默忆")

    assert restored == [], "操作前前台就是微信时不应还焦点"


# ─── 方向锁：默认窗口可见（不藏屏外）─────────────────────────────────────────────


def test_offscreen_reply_defaults_to_visible():
    """方向锁（PrepPRD §0.3）：config 默认 OFFSCREEN_REPLY=False —— 窗口可见、不藏屏外。

    旧「藏窗口（屏外 -2600 + DWM cloak）」是错方向：用户看不了、没法验证送达、还卡死。
    新方向 = 窗口可见 + 不抢焦点 + 真送达读回。任何把默认改回 True 的回退让本测试变红。
    """
    import config

    assert config.OFFSCREEN_REPLY is False, "默认必须是窗口可见模式（OFFSCREEN_REPLY=False）"


# ─── 还焦点必须用 AttachThreadInput 绕 Windows SetForegroundWindow 限制 ──────────


def test_set_foreground_uses_attachthreadinput(monkeypatch):
    """真机 bug（2026-06-21 xian-pc 实测 NOT SILENT）：裸 SetForegroundWindow 受 Windows 限制，
    非前台进程切不动别的窗口 → 切会话后微信占前台，焦点没还回。必须用 AttachThreadInput
    把当前线程附到当前前台窗口线程后再 SetForegroundWindow，焦点归还才真生效。

    任何把还焦点退回裸 SetForegroundWindow 的回退让本测试变红。
    """
    import ctypes

    calls = []

    class _U32:
        def GetForegroundWindow(self):
            return 999  # 当前前台（切会话后是微信）

        def GetWindowThreadProcessId(self, h, p):
            return 5  # 当前前台窗口的线程 id

        def AttachThreadInput(self, a, b, f):
            calls.append(("Attach", bool(f)))
            return 1

        def SetForegroundWindow(self, h):
            calls.append(("SetFg", h))
            return 1

    class _K32:
        def GetCurrentThreadId(self):
            return 7

    class _WD:
        user32 = _U32()
        kernel32 = _K32()

    monkeypatch.setattr(ctypes, "windll", _WD(), raising=False)
    listen_chat._set_foreground_window(100)

    assert ("SetFg", 100) in calls, "必须把焦点设给目标窗口 hwnd=100"
    assert ("Attach", True) in calls and ("Attach", False) in calls, \
        "必须 AttachThreadInput 配对(True 后 False)绕过 Windows 前台限制"


# ─── verify-silent 独立跑必须自激活 SPI（哨兵/开机自检才能找到微信窗口）────────────


def test_verify_silent_activates_uia_before_finding_window():
    """真机 gap（2026-06-21 xian-pc NO_WINDOW）：微信 4.x 需先激活 SPI_SETSCREENREADER 才暴露
    UIA 控件树。真模式 main loop 会激活，但 run_verify_silent 独立跑（哨兵/开机自检）若不自激活，
    get_main_window 找不到窗口 → NO_WINDOW。run_verify_silent 必须在 get_main_window 前调
    _activate_uia()。任何去掉的回退让本测试变红。
    """
    import inspect

    src = inspect.getsource(listen_chat.run_verify_silent)
    assert "_activate_uia()" in src, "verify-silent 必须自激活 SPI（独立跑/哨兵自检才找得到窗口）"
    # 锚点用 import 语句（唯一，不被注释里的字样干扰）
    assert src.index("_activate_uia()") < src.index("from find_weixin import get_main_window"), \
        "_activate_uia 必须在 get_main_window 导入/调用之前"
