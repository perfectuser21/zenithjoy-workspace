# -*- coding: utf-8 -*-
"""
TDD — 滚动扫全活跃会话的累计/去重/终止纯逻辑单测（Track A · A1）。

背景（CRM 第一步地基 / handoff）：微信会话列表是 Qt 虚拟滚动，一次 descendants 只渲染
可见 ~6 条 ListItem。`scan_recent_contacts` 旧实现只枚举一次 → 漏掉绝大多数。要边滚边累计：
每滚一屏拿到一批 ListItem 名字（与前一屏有重叠），并入一个 distinct 集合，滚到「连续若干
次无新增」为止。

本文件测两个纯函数（顶层零 pywinauto，CI clean 可跑）：

1. `_ScrollAccumulator` —— 维护已见 distinct 联系人（保序），喂一屏 ListItem 名字进去，
   返回本屏「新增了几个」。多屏喂完能从重叠的多页里去重出全部 distinct 联系人（不止 6）。
2. `_should_stop_scroll(no_new_streak, max_streak)` —— 终止判定：连续 max_streak 屏无新增 → 停。

真机 UIA 滚动那段（PageDown / WM_VSCROLL）不可 CI 测，但累计/去重/终止逻辑必须纯函数可测。
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


def _page(*names):
    """一屏可见 ListItem 名字（每个联系人一行 element_info.name）。"""
    return list(names)


# ─── _ScrollAccumulator：保序 distinct 累计，返回每屏新增数 ─────────────────────


def test_accumulate_single_page_dedup_within_page():
    """单屏内同名重复只算一个。"""
    acc = listen_chat._ScrollAccumulator(limit=100)
    new = acc.feed(_page(
        "于瑾\n您好\n15:26\n",
        "于瑾\n您好\n15:26\n",   # 同屏重复
        "李华\n在吗\n11:09\n",
    ))
    assert new == 2
    assert [c["name"] for c in acc.contacts()] == ["于瑾", "李华"]


def test_accumulate_overlapping_pages_distinct_more_than_six():
    """虚拟滚动：相邻屏有重叠，多屏喂完去重出 >6 个 distinct 联系人。"""
    acc = listen_chat._ScrollAccumulator(limit=100)
    # 模拟每屏渲染 ~6 条，相邻屏重叠 3 条（Qt 虚拟列表典型行为）
    page1 = _page(*[f"客户{i}\n消息{i}\n10:0{i}\n" for i in range(0, 6)])
    page2 = _page(*[f"客户{i}\n消息{i}\n10:0{i}\n" for i in range(3, 9)])
    page3 = _page(*[f"客户{i}\n消息{i}\n10:0{i}\n" for i in range(6, 12)])
    assert acc.feed(page1) == 6
    assert acc.feed(page2) == 3   # 3,4,5 重叠，只新增 6,7,8
    assert acc.feed(page3) == 3   # 6,7,8 重叠，只新增 9,10,11
    names = [c["name"] for c in acc.contacts()]
    assert len(names) == 12       # 远超一屏 6 条
    assert names == [f"客户{i}" for i in range(12)]


def test_accumulate_no_new_when_page_fully_seen():
    """整屏都见过（滚到底反复渲染同一屏）→ 新增 0。"""
    acc = listen_chat._ScrollAccumulator(limit=100)
    page = _page("甲\n你好\n09:00\n", "乙\n在吗\n08:00\n")
    assert acc.feed(page) == 2
    assert acc.feed(page) == 0    # 同一屏再喂 → 0 新增
    assert acc.feed(page) == 0


def test_accumulate_respects_limit_stops_growing():
    """累计到 limit 后不再增长，新增数也封顶。"""
    acc = listen_chat._ScrollAccumulator(limit=3)
    assert acc.feed(_page(*[f"c{i}\nm{i}\n10:0{i}\n" for i in range(5)])) == 3
    assert len(acc.contacts()) == 3
    # 再喂新名字也不增（已满）
    assert acc.feed(_page("zz\n新\n11:00\n")) == 0


def test_accumulate_filters_official_keeps_named_group_for_header_judgment():
    """累计复用 _collect_recent_contacts：只去精确系统号（公众号）；名字含"群"不再在此层删
    （规则1 已删，群/私聊由 enrich 读标题 "(人数)" 判），所以群名也累计进来等后续判定。"""
    acc = listen_chat._ScrollAccumulator(limit=100)
    new = acc.feed(_page(
        "公众号\n广告\n11:09\n",          # 系统号 → 去掉（规则2）
        "老乡交流群\n大家好\n10:00\n",     # 名字含"群" → 保留（采集端不按名字猜，enrich 读标题判）
        "真客户\n你好\n15:00\n",
    ))
    assert new == 2
    assert [c["name"] for c in acc.contacts()] == ["老乡交流群", "真客户"]


# ─── _should_stop_scroll：连续无新增达阈值 → 停 ─────────────────────────────────


def test_should_stop_after_consecutive_empty_streak():
    assert listen_chat._should_stop_scroll(no_new_streak=2, max_streak=2) is True
    assert listen_chat._should_stop_scroll(no_new_streak=3, max_streak=2) is True


def test_should_not_stop_before_streak_reached():
    assert listen_chat._should_stop_scroll(no_new_streak=0, max_streak=2) is False
    assert listen_chat._should_stop_scroll(no_new_streak=1, max_streak=2) is False
