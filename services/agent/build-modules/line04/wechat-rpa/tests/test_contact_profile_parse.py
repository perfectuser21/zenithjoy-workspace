# -*- coding: utf-8 -*-
"""
TDD（line04 1.0.64 地基 Track A2）— 读对方「微信号」+「加微信时间」解析单测。

背景：CRM 好友表只有昵称不够，要识别同名/沉淀客户身份，需要：
  - 对方微信号（资料页「微信号：xxx」），稳定主键。
  - 加微信时间（≈ 聊天滚到顶后最早一条消息日期），客户沉淀时长。
扩展上报 payload：contacts[].wechat_id + contacts[].add_friend_time。

本文件测纯解析 + 纯编排（顶层零 pywinauto，CI clean 可跑）：
1. _parse_wechat_id_from_texts(texts)        —— 从资料页 Text 列表解析微信号。
2. _parse_earliest_date_from_texts(texts)    —— 从聊天时间戳解析最早日期（YYYY-MM-DD）。
3. _enrich_contacts(contacts, wid_fn, t_fn)  —— 注入读取器给每个联系人补两字段。
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


_stub_heavy_deps()

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


# ─── _parse_wechat_id_from_texts ──────────────────────────────────────────────


def test_parse_wechat_id_label_inline_colon():
    """同一段文本「微信号：wxid_abc123」→ 取冒号后的值（中英文冒号都吃）。"""
    assert listen_chat._parse_wechat_id_from_texts(["微信号：wxid_abc123"]) == "wxid_abc123"
    assert listen_chat._parse_wechat_id_from_texts(["微信号: cecelia-666"]) == "cecelia-666"


def test_parse_wechat_id_label_then_value_in_next_text():
    """标签与值拆成两个相邻 Text（"微信号" / "Zhang_Wei88"）→ 取下一段为值。"""
    texts = ["备注", "微信号", "Zhang_Wei88", "地区", "广东 深圳"]
    assert listen_chat._parse_wechat_id_from_texts(texts) == "Zhang_Wei88"


def test_parse_wechat_id_rejects_chinese_and_returns_none_when_absent():
    """没有微信号字段 → None；值是中文（昵称误命中）→ 不当成微信号。"""
    assert listen_chat._parse_wechat_id_from_texts(["地区", "广东 深圳", "标签"]) is None
    assert listen_chat._parse_wechat_id_from_texts(["微信号", "张伟"]) is None


# ─── _parse_earliest_date_from_texts ──────────────────────────────────────────


def test_parse_earliest_full_date_with_year():
    """含年份的时间戳「2025年3月14日 上午9:23」→ 归一化 2025-03-14。"""
    texts = ["2025年3月14日 上午9:23", "你好", "在吗", "2025年6月1日 下午2:00"]
    assert listen_chat._parse_earliest_date_from_texts(texts) == "2025-03-14"


def test_parse_earliest_returns_minimum_not_just_first():
    """多个日期取最早（最小），不是取第一个出现的。"""
    texts = ["2026年1月5日", "正文", "2025年12月20日 10:00"]
    assert listen_chat._parse_earliest_date_from_texts(texts) == "2025-12-20"


def test_parse_earliest_year_less_uses_default_year():
    """只有「3月14日 12:30」没年份 → 用 default_year 补年。"""
    assert listen_chat._parse_earliest_date_from_texts(
        ["3月14日 12:30", "你好"], default_year=2026
    ) == "2026-03-14"


def test_parse_earliest_none_when_no_dates():
    """没有任何可解析日期（纯消息/相对词）→ None，不崩。"""
    assert listen_chat._parse_earliest_date_from_texts(["你好", "在吗", "昨天"]) is None
    assert listen_chat._parse_earliest_date_from_texts([]) is None


# ─── _enrich_contacts ─────────────────────────────────────────────────────────


def test_enrich_adds_fields_only_when_present():
    """读到 wechat_id/date 才写键（payload 保持瘦）；读不到的字段不写。"""
    contacts = [{"name": "于瑾", "last_message": "您好"},
                {"name": "李华", "last_message": "在吗"}]
    wid_map = {"于瑾": "wxid_yujin", "李华": None}
    t_map = {"于瑾": "2025-03-14", "李华": None}

    out = listen_chat._enrich_contacts(
        contacts, lambda n: wid_map.get(n), lambda n: t_map.get(n)
    )
    by = {c["name"]: c for c in out}
    assert by["于瑾"]["wechat_id"] == "wxid_yujin"
    assert by["于瑾"]["add_friend_time"] == "2025-03-14"
    assert "wechat_id" not in by["李华"]
    assert "add_friend_time" not in by["李华"]


def test_enrich_swallows_reader_exceptions_per_field():
    """读取器抛异常 → 吞掉跳过该字段，绝不拖垮整批扫描。"""
    contacts = [{"name": "甲", "last_message": ""}]

    def boom(_):
        raise RuntimeError("UIA 读爆了")

    out = listen_chat._enrich_contacts(contacts, boom, lambda n: "2025-01-01")
    assert out[0].get("add_friend_time") == "2025-01-01"
    assert "wechat_id" not in out[0]
