"""
TDD — reply_in_chat 两路纯 UIA 发送逻辑单测（纯逻辑，无 pywinauto/win32 依赖）。

设计：两路纯 UIA（无物理点击降级）
  路径1 — 面板已开：直接 _find_chat_input → SetValue + AttachThreadInput+Enter 发送
  路径2 — Invoke 激活会话：item.iface_invoke.Invoke() → 等 UIA 暴露 → SetValue + Enter
  两路均失败 → 返回 False，下一轮询重试（不物理点击，不抢焦点）

发送机制（v1.1.97+）：SetValue 写入后用 AttachThreadInput+PostMessage(VK_RETURN) 静默发送，
不再依赖 send_button.iface_invoke.Invoke()（Invoke 无键盘焦点时不触发发送）。
发送按钮 Invoke 保留为 fallback（Enter 后 get_value() 非空时兜底）。

【CI 安全】顶层零 pywinauto/win32 import；用 Fake 对象注入，纯逻辑跨平台跑。
"""
from __future__ import annotations

import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat  # noqa: E402


class _FakeElementInfo:
    def __init__(self, automation_id: str = "", name: str = ""):
        self.automation_id = automation_id
        self.name = name
        self.handle = 12345


class _FakeInvokePattern:
    def __init__(self):
        self.invoke_called = False

    def Invoke(self):  # noqa: N802
        self.invoke_called = True


class _FakeValuePattern:
    def __init__(self):
        self.set_value_called_with = None
        self.CurrentValue = ""  # noqa: N815

    def SetValue(self, value):  # noqa: N802
        self.set_value_called_with = value
        self.CurrentValue = ""


class _FakeEdit:
    def __init__(self):
        self.element_info = _FakeElementInfo(automation_id="chat_input_field")
        self.iface_value = _FakeValuePattern()

    def get_value(self) -> str:
        # SetValue 后输入框被清空（= 发送成功）
        return ""


class _FakeButton:
    def __init__(self):
        self.element_info = _FakeElementInfo(name="发送")
        self.iface_invoke = _FakeInvokePattern()


class _FakeItem:
    def __init__(self):
        self.element_info = _FakeElementInfo()
        self.iface_invoke = _FakeInvokePattern()

    def rectangle(self):
        class R:
            left = top = 0
            right = bottom = 100
        return R()


class _FakeMainWindow:
    def __init__(self, edit, button):
        self._edit = edit
        self._button = button
        self.element_info = _FakeElementInfo()

    def descendants(self, control_type=None):
        if control_type == "Edit":
            return [self._edit]
        if control_type == "Button":
            return [self._button]
        return []

    def children(self):
        return []


class _EmptyMW:
    def __init__(self):
        self.element_info = _FakeElementInfo()

    def descendants(self, control_type=None):
        return []

    def children(self):
        return []


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(listen_chat.time, "sleep", lambda *a, **k: None)


def test_path1_panel_already_open():
    """路径1：面板已开，SetValue + AttachThreadInput+Enter 发送，不需要 item.Invoke()。"""
    edit = _FakeEdit()
    button = _FakeButton()
    item = _FakeItem()
    mw = _FakeMainWindow(edit, button)

    ok = listen_chat.reply_in_chat(mw, item, "您好，在的")

    assert edit.iface_value.set_value_called_with == "您好，在的"
    assert item.iface_invoke.invoke_called is False, "路径1 不应调 item.Invoke()"
    assert ok is True


def test_path2_invoke_then_find_panel(monkeypatch):
    """路径2：初始无输入框 → item.Invoke() 后出现 → SetValue + 发送。"""
    edit = _FakeEdit()
    button = _FakeButton()
    item = _FakeItem()
    call_count = [0]

    class _LazyMW:
        def __init__(self):
            self.element_info = _FakeElementInfo()

        def descendants(self, control_type=None):
            call_count[0] += 1
            # 前两次调用返回空（Path1 + Path2 第一次轮询），之后返回控件
            if call_count[0] <= 2:
                return []
            if control_type == "Edit":
                return [edit]
            if control_type == "Button":
                return [button]
            return []

        def children(self):
            return []

    mw = _LazyMW()
    ok = listen_chat.reply_in_chat(mw, item, "测试消息")

    assert item.iface_invoke.invoke_called is True, "路径2 必须调 item.iface_invoke.Invoke()"
    assert edit.iface_value.set_value_called_with == "测试消息"
    assert ok is True


def test_missing_input_returns_false():
    """全程找不到 chat_input_field → 返回 False。"""
    item = _FakeItem()
    ok = listen_chat.reply_in_chat(_EmptyMW(), item, "你好")
    assert ok is False


# ── _get_edit_hwnd HWND 路由单测 ─────────────────────────────────────────────

class _FakeEditWithHandle:
    """模拟有 native HWND 的输入框控件。"""
    class element_info:
        handle = 99999


class _FakeEditNoHandle:
    """模拟 UIA-only 控件（无 native HWND，handle=0）。"""
    class element_info:
        handle = 0


def test_get_edit_hwnd_uses_edit_hwnd_when_available():
    """输入框有有效 HWND 时，应返回输入框 HWND 而非主窗口 HWND。"""
    result = listen_chat._get_edit_hwnd(_FakeEditWithHandle(), 12345)
    assert result == 99999, "有 edit HWND 时不应 fallback 到主窗口"


def test_get_edit_hwnd_falls_back_to_main_hwnd_when_zero():
    """输入框 handle=0（UIA-only 控件）时，应 fallback 主窗口 HWND。"""
    result = listen_chat._get_edit_hwnd(_FakeEditNoHandle(), 12345)
    assert result == 12345, "handle=0 时应 fallback 主窗口 HWND"


def test_enter_key_send_no_button_succeeds():
    """AttachThreadInput+Enter 机制不依赖 send_button：无发送按钮也能成功发送。"""
    edit = _FakeEdit()

    class _EditOnlyMW:
        def __init__(self):
            self.element_info = _FakeElementInfo()

        def descendants(self, control_type=None):
            return [edit] if control_type == "Edit" else []

        def children(self):
            return []

    item = _FakeItem()
    ok = listen_chat.reply_in_chat(_EditOnlyMW(), item, "你好")
    # Enter 发送后 get_value()="" → 判定成功，不需要 button.Invoke()
    assert ok is True
