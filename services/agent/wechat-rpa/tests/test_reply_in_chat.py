"""
TDD — `reply_in_chat` 必须用 `click_input()` 而非 `select()` 切换会话。

【根因】微信 4.0 上 ListItem.select()（SelectionItem 模式）不真正打开会话，
导致后续 set_text/发送作用在「当前会话」而非目标客户会话上 → 回复发错对象。
2026-06-03 xian-pc 微信 4.0 真机验证：必须 item.click_input() 点列表项才切换会话。

【RED】实现仍调 item.select() 时本测试失败（click_input 未被调用）。
【GREEN】改为 item.click_input() 后通过。

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


class _FakeEdit:
    def __init__(self):
        self.element_info = _FakeElementInfo(automation_id="chat_input_field")
        self._value = ""
        self.set_text_called_with = None

    def set_text(self, txt):
        self.set_text_called_with = txt
        self._value = ""  # 微信发送后输入框清空（模拟发送成功）

    def get_value(self):
        return self._value


class _FakeButton:
    def __init__(self):
        self.element_info = _FakeElementInfo(name="发送")
        self.click_input_called = False

    def click_input(self):
        self.click_input_called = True


class _FakeItem:
    def __init__(self):
        self.select_called = False
        self.click_input_called = False

    def select(self):
        self.select_called = True

    def click_input(self):
        self.click_input_called = True


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


def test_reply_in_chat_uses_click_input_not_select():
    """微信4.0：必须 click_input() 切换会话，不能用 select()（不切换 → 发错对象）。"""
    edit = _FakeEdit()
    button = _FakeButton()
    item = _FakeItem()
    mw = _FakeMainWindow(edit, button)

    ok = listen_chat.reply_in_chat(mw, item, "您好，在的")

    assert item.click_input_called is True, "必须 click_input() 打开会话（微信4.0 select 不切换）"
    assert item.select_called is False, "不应再调用 select()"
    assert edit.set_text_called_with == "您好，在的"
    assert button.click_input_called is True
    assert ok is True
