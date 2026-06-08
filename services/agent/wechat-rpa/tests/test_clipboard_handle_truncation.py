"""
回归测试 — 防止前台键盘/剪贴板路径被重新引入 listen_chat.py。

【背景】
v1.1.108 删除了 _force_foreground / _set_clipboard_text / _abs_click 三个前台函数：
- keybd_event / mouse_event 是全局事件，后台会话下会发到错误窗口，导致消息发错地方
- 唯一正确路径：UIA SetValue + PostMessageW，不需要前台焦点

这些测试确保上述函数不会被意外重新引入。
"""
from __future__ import annotations

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
LISTEN_CHAT_PATH = os.path.join(WECHAT_RPA_DIR, "listen_chat.py")


def test_foreground_functions_absent():
    """防回归：_force_foreground / _set_clipboard_text / _abs_click 不得出现在 listen_chat.py 中。"""
    with open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        src = f.read()

    for fn_name in ("_force_foreground", "_set_clipboard_text", "_abs_click"):
        assert not re.search(rf"^def {fn_name}\(", src, re.MULTILINE), (
            f"{fn_name} 被重新引入 listen_chat.py。"
            "前台键盘/剪贴板路径已被删除（v1.1.108），理由：keybd_event 是全局事件，"
            "后台会话下会发到错误窗口。请改用 UIA SetValue + PostMessageW 路径。"
        )


def test_keybd_event_absent():
    """防回归：keybd_event 不得出现在 listen_chat.py 生产代码中。"""
    with open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        src = f.read()

    # 允许出现在注释中，但不允许作为调用
    calls = re.findall(r"(?<!#.*?)keybd_event\s*\(", src)
    assert not calls, (
        "keybd_event 不允许在 listen_chat.py 中调用（全局键盘事件，后台发送必失败）。"
        "请用 PostMessageW(WM_KEYDOWN/WM_KEYUP) 代替。"
    )
