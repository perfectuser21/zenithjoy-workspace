# -*- coding: utf-8 -*-
"""
TDD — 群/私聊判定改用唯一可靠信号：打开会话后右上角标题是否带 (人数)。

业务规则（用户拍板）：群聊不进 CRM，客户 = 纯一对一私聊。
唯一可靠信号（用户实证 + rog 真机 100% 准）：会话左列名字分不出群/私聊，
打开会话后右上角标题——私聊=名字无括号；群=名字带 "(N)"。
  私聊：`中瑞家具 冯涛18192241985` / `Lancelot 。`
  群：  `华涛数码、徐先生企业自媒体-Ai助力(3)` / `徐先生企业自媒体-Ai助力(2)`

真机 UIA 读标题不可单测，但「标题文本数组 → 是否群 + 人数」纯函数可测。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


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


_stub_heavy_deps()

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


def test_group_header_half_width_parens():
    """半角括号 "名字(3)" → 群，返回人数 3。"""
    texts = ["华涛数码、徐先生企业自媒体-Ai助力(3)", "华涛数码、徐先生企业自媒体-Ai助力", "(3)"]
    assert listen_chat._is_group_by_header(texts) == 3


def test_group_header_two_member_group():
    assert listen_chat._is_group_by_header(["徐先生企业自媒体-Ai助力(2)"]) == 2


def test_group_header_full_width_parens():
    """全角括号 "名字（5）" → 群，返回人数 5。"""
    assert listen_chat._is_group_by_header(["某客户群（5）"]) == 5


def test_private_chat_no_parens_returns_none():
    """私聊标题无括号 → 不是群，返回 None。"""
    assert listen_chat._is_group_by_header(["中瑞家具 冯涛18192241985"]) is None
    assert listen_chat._is_group_by_header(["Lancelot 。"]) is None


def test_private_chat_name_with_unrelated_parens_text_not_misjudged():
    """私聊名字里普通括号但不是"(纯数字)"人数格式 → 不当群（如英文备注括号）。"""
    # "(abc)" 非数字 → 不算人数
    assert listen_chat._is_group_by_header(["客户A(VIP)"]) is None


def test_empty_or_none_texts_safe():
    assert listen_chat._is_group_by_header([]) is None
    assert listen_chat._is_group_by_header(["", None]) is None
