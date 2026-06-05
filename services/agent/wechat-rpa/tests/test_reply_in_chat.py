"""
TDD — `reply_in_chat` 必须用 **纯 UIA 控件操作** 打开会话/写值/发送，禁止任何物理输入。

【根因升级（2026-06-05 xian-pc 微信 4.1.8.107 真机验证）】
旧配方用 item.click_input() + edit.set_text() + btn.click_input()：
  - 微信 4.1.8 上 click_input 不仅打不开会话，还会 SetCursorPos 抢前台/抢光标，
    跟 Agent 其他自动化打架，且跨会话被拒（access denied）。
新配方全部走 UIAPattern，不碰鼠标/键盘/光标（微信最小化也能跑）：
  - 会话项 item.iface_invoke.Invoke()  打开目标会话（InvokePattern）
  - 输入框 edit.iface_value.SetValue(reply)  写值（ValuePattern）
  - 发送按钮 btn.iface_invoke.Invoke()  触发发送（InvokePattern）

【RED】实现仍调 click_input/set_text 时本测试失败（Fake 不再暴露这些方法）。
【GREEN】改为 iface_invoke.Invoke() + iface_value.SetValue() 后通过。

【CI 安全】顶层零 pywinauto import；用 Fake 对象注入 reply_in_chat，纯逻辑可跨平台跑。
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


class _FakeInvokePattern:
    """模拟 pywinauto UIAWrapper.iface_invoke（IUIAutomationInvokePattern）。"""

    def __init__(self):
        self.invoke_called = False

    def Invoke(self):  # noqa: N802 — 对齐 COM 接口大写命名
        self.invoke_called = True


class _FakeValuePattern:
    """模拟 pywinauto UIAWrapper.iface_value（IUIAutomationValuePattern）。"""

    def __init__(self):
        self.set_value_called_with = None
        self.CurrentValue = ""  # noqa: N815 — 对齐 COM 属性命名

    def SetValue(self, value):  # noqa: N802 — 对齐 COM 接口大写命名
        self.set_value_called_with = value
        self.CurrentValue = ""  # 微信发送后输入框清空（模拟发送成功）


class _FakeEdit:
    def __init__(self):
        self.element_info = _FakeElementInfo(automation_id="chat_input_field")
        self.iface_value = _FakeValuePattern()


class _FakeButton:
    def __init__(self):
        self.element_info = _FakeElementInfo(name="发送")
        self.iface_invoke = _FakeInvokePattern()


class _FakeItem:
    def __init__(self):
        self.iface_invoke = _FakeInvokePattern()


class _FakeMainWindow:
    def __init__(self, edit, button):
        self._edit = edit
        self._button = button

    def descendants(self, control_type=None):
        if control_type == "Edit":
            return [self._edit]
        if control_type == "Button":
            return [self._button]
        return []


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    # reply_in_chat 内多处 time.sleep，测试里抹掉避免拖慢
    monkeypatch.setattr(listen_chat.time, "sleep", lambda *a, **k: None)


def test_reply_in_chat_uses_uia_pattern_not_physical_input():
    """微信4.1.8：必须 iface_invoke.Invoke() 开会话 + iface_value.SetValue() 写值，不碰鼠标键盘。"""
    edit = _FakeEdit()
    button = _FakeButton()
    item = _FakeItem()
    mw = _FakeMainWindow(edit, button)

    ok = listen_chat.reply_in_chat(mw, item, "您好，在的")

    assert item.iface_invoke.invoke_called is True, "必须 iface_invoke.Invoke() 打开会话（UIA InvokePattern）"
    assert edit.iface_value.set_value_called_with == "您好，在的", "必须 iface_value.SetValue() 写输入框"
    assert button.iface_invoke.invoke_called is True, "必须 iface_invoke.Invoke() 点发送"
    assert ok is True


def test_reply_in_chat_missing_input_returns_false():
    """找不到 chat_input_field → 返回 False（不静默吞掉）。"""

    class _EmptyMW:
        def descendants(self, control_type=None):
            return []

    item = _FakeItem()
    ok = listen_chat.reply_in_chat(_EmptyMW(), item, "你好")
    assert ok is False


def test_reply_in_chat_missing_send_button_returns_false():
    """找到输入框但找不到'发送'按钮 → 返回 False。"""
    edit = _FakeEdit()

    class _EditOnlyMW:
        def descendants(self, control_type=None):
            return [edit] if control_type == "Edit" else []

    item = _FakeItem()
    ok = listen_chat.reply_in_chat(_EditOnlyMW(), item, "你好")
    assert ok is False
