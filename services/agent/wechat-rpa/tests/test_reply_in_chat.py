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
        return ""

    def set_focus(self) -> None:
        pass


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


def test_always_invokes_item_before_send():
    """reply_in_chat 始终先 item.Invoke() 激活正确会话再发送（防发错聊天窗口）。"""
    edit = _FakeEdit()
    button = _FakeButton()
    item = _FakeItem()
    mw = _FakeMainWindow(edit, button)

    ok = listen_chat.reply_in_chat(mw, item, "您好，在的")

    assert item.iface_invoke.invoke_called is True, "必须调 item.Invoke() 激活正确会话"
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


def test_uia_send_uses_element_info_class_name_for_wechat_detection(monkeypatch):
    """regression: _uia_send 必须用 mw.element_info.class_name 检测微信窗口，不能用 Win32 GetClassNameW。

    修复前（GetClassNameW）：GetClassNameW(fake_hwnd) 返回 Win32 类名（不是 "mmui::MainWindow"），
                            剪贴板路径永远不触发，_set_clipboard_text 不会被调用。
    修复后（element_info.class_name）：mw.element_info.class_name == "mmui::MainWindow" 直接匹配，
                                       _set_clipboard_text 被调用。
    """
    clipboard_calls: list = []
    monkeypatch.setattr(listen_chat, "_set_clipboard_text", lambda text: clipboard_calls.append(text) or True)

    class _WeChatEI:
        handle = 12345
        class_name = "mmui::MainWindow"

    class _WeChatMW:
        element_info = _WeChatEI()

        def descendants(self, control_type=None):
            if control_type == "Edit":
                return [_FakeEdit()]
            if control_type == "Button":
                return [_FakeButton()]
            return []

        def children(self):
            return []

    item = _FakeItem()
    listen_chat.reply_in_chat(_WeChatMW(), item, "你好，在的")

    assert len(clipboard_calls) > 0, (
        "_uia_send 未调用 _set_clipboard_text —— 说明仍在用 GetClassNameW 判断微信窗口"
    )


def test_two_senders_each_invokes_own_session(monkeypatch):
    """回归 Bug（回复发错人）：两条不同发送人的未读，逐条回复时——

    1. 每一条都先调用 *自己* item 的 iface_invoke.Invoke()（切到该发送人会话），
       而不是直接复用当前屏幕上打开的输入框。
    2. 第二条绝不重用第一条的窗口/输入框，也不会再次 Invoke 第一条的 item。

    用 monkeypatch 把 _uia_send 换成记录器，聚焦验证"发给了谁"而非 Windows 发送细节，
    保证跨平台确定可跑（旧路径1 直接复用已打开输入框会让所有回复跑到同一个人）。
    """
    sent: list = []  # 记录每次 _uia_send 收到的 (edit, text)

    def _fake_uia_send(uia_edit, mw, reply_text):
        sent.append((uia_edit, reply_text))
        return True

    monkeypatch.setattr(listen_chat, "_uia_send", _fake_uia_send)
    monkeypatch.setattr(listen_chat, "_navigate_away", lambda *a, **k: None)

    # 发送人 A：item_a + 它专属会话的输入框 edit_a
    item_a = _FakeItem()
    edit_a = _FakeEdit()
    mw_a = _FakeMainWindow(edit_a, _FakeButton())

    # 发送人 B：item_b + 它专属会话的输入框 edit_b
    item_b = _FakeItem()
    edit_b = _FakeEdit()
    mw_b = _FakeMainWindow(edit_b, _FakeButton())

    # 第一条：回 A
    ok_a = listen_chat.reply_in_chat(mw_a, item_a, "回给A")
    assert ok_a is True
    assert item_a.iface_invoke.invoke_called is True, "第一条必须先 Invoke item_a 自己的会话"
    assert sent[-1] == (edit_a, "回给A"), "第一条必须发到 A 的输入框"

    # 第二条：回 B —— 不得重用 A 的窗口，必须 Invoke item_b 自己
    ok_b = listen_chat.reply_in_chat(mw_b, item_b, "回给B")
    assert ok_b is True
    assert item_b.iface_invoke.invoke_called is True, "第二条必须先 Invoke item_b 自己的会话"
    assert sent[-1] == (edit_b, "回给B"), "第二条必须发到 B 的输入框，绝不重用 A 的窗口"

    # 两条各发各的，顺序与内容正确
    assert [s[1] for s in sent] == ["回给A", "回给B"]
