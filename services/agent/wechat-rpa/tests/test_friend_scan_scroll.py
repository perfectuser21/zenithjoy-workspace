# -*- coding: utf-8 -*-
"""
TDD（line04 1.0.64 地基 Track A1）— 会话列表「滚动扫全」单测。

背景：旧 scan_recent_contacts 只 mw.descendants 枚举一次 → 只拿到可见 ~6 条会话，
列表里更靠下的活跃客户被漏。本 Track 改为滚动（PageDown/WM_VSCROLL）滚完整个会话
列表，累计 distinct 直到连续若干轮无新增（滚到底），再交纯函数解析。

本文件测两件事（顶层零 pywinauto，CI clean 可跑）：
1. _accumulate_scrolled_names(read_fn, scroll_fn) —— 纯函数：反复读当前可见名字 +
   滚动，累计 distinct（按首行 sender 去重、保序），连续 stable_rounds 轮无新增即停。
2. scan_recent_contacts(mw) —— 真机入口滚动累计：descendants 逐屏给出不同 ListItem，
   scan 必须把多屏全部收齐（不再只拿第一屏）。
"""
from __future__ import annotations

import ctypes
import os
import sys
import types
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

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


@contextmanager
def _mock_windll(user32):
    windll_mock = MagicMock(user32=user32, kernel32=MagicMock(), dwmapi=MagicMock())
    had_windll = hasattr(ctypes, "windll")
    original = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    try:
        yield windll_mock
    finally:
        if had_windll:
            ctypes.windll = original
        else:
            try:
                delattr(ctypes, "windll")
            except AttributeError:
                pass


# ─── 纯函数 _accumulate_scrolled_names ────────────────────────────────────────


def test_accumulate_collects_across_multiple_pages():
    """逐屏读到不同名字 → 累计全部 distinct（保序，按首行 sender 去重）。"""
    pages = [
        ["A\n你好\n10:00\n", "B\n在吗\n10:01\n"],
        ["B\n在吗\n10:01\n", "C\n下午好\n10:02\n"],   # B 重叠
        ["C\n下午好\n10:02\n", "D\n晚上好\n10:03\n"],  # C 重叠
        ["D\n晚上好\n10:03\n"],                        # 无新增（滚到底）
        ["D\n晚上好\n10:03\n"],                        # 再次无新增
    ]
    calls = {"read": 0, "scroll": 0}

    def read_fn():
        idx = min(calls["read"], len(pages) - 1)
        calls["read"] += 1
        return pages[idx]

    def scroll_fn():
        calls["scroll"] += 1

    out = listen_chat._accumulate_scrolled_names(
        read_fn, scroll_fn, max_scrolls=40, stable_rounds=2
    )
    senders = [n.split("\n")[0] for n in out]
    assert senders == ["A", "B", "C", "D"]
    assert calls["scroll"] >= 1  # 真的滚了


def test_accumulate_stops_after_stable_rounds_no_infinite_loop():
    """每屏都一样（一进来就到底）→ 连续 stable_rounds 轮无新增即停，绝不死循环。"""
    same = ["甲\n你好\n10:00\n"]
    scrolls = {"n": 0}

    out = listen_chat._accumulate_scrolled_names(
        lambda: list(same), lambda: scrolls.__setitem__("n", scrolls["n"] + 1),
        max_scrolls=40, stable_rounds=2,
    )
    assert [n.split("\n")[0] for n in out] == ["甲"]
    # 第一屏收 1 人，之后两轮无新增即停；不会滚满 max_scrolls
    assert scrolls["n"] < 40


def test_accumulate_respects_max_scrolls_cap():
    """每屏都有新名字（永远不会自然到底）→ max_scrolls 兜底，绝不无限滚。"""
    counter = {"i": 0}

    def read_fn():
        counter["i"] += 1
        return [f"客户{counter['i']}\n消息\n10:00\n"]

    scrolls = {"n": 0}
    out = listen_chat._accumulate_scrolled_names(
        read_fn, lambda: scrolls.__setitem__("n", scrolls["n"] + 1),
        max_scrolls=5, stable_rounds=2,
    )
    assert scrolls["n"] <= 5
    assert len(out) <= 6  # 最多 max_scrolls+1 屏，每屏 1 人


# ─── scan_recent_contacts 真机入口：必须滚动收齐多屏 ───────────────────────────


def _item(name):
    it = MagicMock()
    it.element_info.name = name
    return it


def test_scan_recent_contacts_scrolls_full_list(monkeypatch):
    """descendants 逐屏给不同 ListItem → scan 把全列表收齐，不再只拿第一屏可见的。"""
    page1 = [_item("于瑾\n您好\n15:26\n"), _item("李华\n在吗\n11:09\n")]
    page2 = [_item("王五\n下午好\n12:00\n"), _item("赵六\n晚上好\n13:00\n")]
    page3 = [_item("钱七\n你好\n14:00\n")]

    seq = [page1, page2, page3, page3, page3, page3, page3]

    def descendants(*a, **k):
        return seq.pop(0) if len(seq) > 1 else seq[0]

    mw = MagicMock()
    mw.element_info.handle = 12345
    mw.descendants.side_effect = descendants

    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = False
    monkeypatch.setattr(listen_chat, "_OFFSCREEN_REPLY", False, raising=False)

    with _mock_windll(user32), patch("time.sleep"):
        out = listen_chat.scan_recent_contacts(mw, limit=100, enrich=False)

    names = [c["name"] for c in out]
    # 三屏全部收齐（旧实现只会拿 page1 两人）
    assert names == ["于瑾", "李华", "王五", "赵六", "钱七"]
