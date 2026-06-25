# -*- coding: utf-8 -*-
"""
TDD — 联系人补字段（wechat_id + add_friend_time）进上报 payload（Track A · A2）。

背景（handoff）：每个联系人除 name/last_message 外，还要带：
  - wechat_id        对方微信号（开资料页读）
  - add_friend_time  ≈ 加微信时间（滚聊天记录到最顶读最早消息日期）

真机读资料页/滚聊天记录那段不可 CI 测，但「把读到的细节合并进 contact dict、缺失时不污染
payload」这层纯逻辑必须可测。本文件测纯函数 `_merge_contact_detail`：
  - 有值 → contact 多带 wechat_id / add_friend_time 两个 key
  - 缺值（资料页读不到 / 没有更早消息）→ 不塞 None key，保持 payload 干净（后端按缺省处理）
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


def test_merge_detail_adds_wechat_id_and_add_friend_time():
    """资料页读到微信号 + 最早消息日期 → contact 带上两字段（不动原 name/last_message）。"""
    contact = {"name": "于瑾", "last_message": "您好"}
    out = listen_chat._merge_contact_detail(
        contact, wechat_id="yujin_888", add_friend_time="2026-03-12"
    )
    assert out["name"] == "于瑾"
    assert out["last_message"] == "您好"
    assert out["wechat_id"] == "yujin_888"
    assert out["add_friend_time"] == "2026-03-12"


def test_merge_detail_skips_missing_fields_keeps_payload_clean():
    """资料页读不到微信号 / 没有更早消息 → 不塞 None key，payload 不含这两个 key。"""
    contact = {"name": "李华", "last_message": "在吗"}
    out = listen_chat._merge_contact_detail(contact, wechat_id=None, add_friend_time=None)
    assert out["name"] == "李华"
    assert "wechat_id" not in out
    assert "add_friend_time" not in out


def test_merge_detail_partial_only_wechat_id():
    """只读到微信号、读不到加好友时间 → 只带 wechat_id。"""
    contact = {"name": "张三", "last_message": ""}
    out = listen_chat._merge_contact_detail(contact, wechat_id="zhangsan", add_friend_time="")
    assert out["wechat_id"] == "zhangsan"
    assert "add_friend_time" not in out  # 空串视为缺失


def test_merge_detail_does_not_mutate_input():
    """纯函数语义：不就地修改入参 dict。"""
    contact = {"name": "甲", "last_message": "x"}
    listen_chat._merge_contact_detail(contact, wechat_id="w", add_friend_time="2026-01-01")
    assert "wechat_id" not in contact  # 原 dict 未被污染
