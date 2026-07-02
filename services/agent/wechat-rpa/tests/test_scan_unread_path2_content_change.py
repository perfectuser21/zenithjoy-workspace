# -*- coding: utf-8 -*-
"""
回归守卫：scan_unread 的 path-2（内容变化检测）——不靠角标也能发现新消息，绝不漏读。

根因（git 实证 2026-07-02）：稳定基线 74654efd 的 scan_unread 是双路检测：
  path-1 = [N条] 未读角标；path-2 = 无角标但内容 != last_content → 也算未读要回。
#984（commit 62c5b38f，1.0.81）为"减延迟"删掉了 path-2，只留角标路径。删除后：一条消息被读到/
打开会话时角标被清零 → 只剩角标一条信号 → 角标一清就再也发现不了 → 夹在别的回复冷却窗口里的
消息永久漏读（用户实测发5条漏"什么价格"，服务端零记录）。

修法：恢复 path-2。无角标 ListItem 用 _parse_item_name(require_unread=False) 拿预览，
若 last_content[sender] 存在且内容变了 → 入队；首次见到只记录不触发；结尾更新 last_content。

守卫契约（proven-to-fire）：把 path-2 删掉（回到只认角标），test_path2_content_change_detected 必红
（复现"什么价格"漏读）。

顶层零 pywinauto（stub），纯逻辑断言。
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


@contextmanager
def _mock_windll(user32):
    windll_mock = MagicMock(user32=user32, kernel32=MagicMock())
    had = hasattr(ctypes, "windll")
    original = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    try:
        yield windll_mock
    finally:
        if had:
            ctypes.windll = original
        else:
            try:
                delattr(ctypes, "windll")
            except AttributeError:
                pass


if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]
import listen_chat  # noqa: E402


def _make_item(name: str):
    it = MagicMock()
    it.element_info.name = name
    return it


def _make_mw(items):
    mw = MagicMock()
    mw.element_info.handle = 55

    def _desc(control_type=None):
        return items  # ListItem 查询 + 裸 descendants(树大小) 都返回这批

    mw.descendants.side_effect = _desc
    return mw


def _visible_user32():
    u = MagicMock()
    u.IsWindowVisible.return_value = True   # 可见 → 不走托盘 ShowWindow
    u.IsIconic.return_value = 0             # 非最小化
    return u


def _senders(out):
    return [m["sender"] for m in out]


def test_path2_content_change_detected():
    """无角标 + 内容变化（vs last_content）→ path-2 命中，返回该会话（绝不漏读）。

    ★ proven-to-fire：删掉 path-2 回到只认角标，此断言必红（复现"什么价格"漏读）。
    """
    # 无 [N条] 角标（角标已被清），预览是新内容"什么价格"
    item = _make_item("默忆\n什么价格\n13:22\n")
    mw = _make_mw([item])
    last_content = {"默忆": "在吗"}  # 上次见到的是"在吗"，现在变了

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        out = listen_chat.scan_unread(mw, last_content)

    assert "默忆" in _senders(out), "无角标但内容变了必须被 path-2 检出，不能漏读"
    assert any(m.get("content") == "什么价格" for m in out)


def test_path2_first_seen_records_no_trigger():
    """首次见到的会话（last_content 无该 sender）→ 不触发回复、只记录内容。"""
    item = _make_item("新客户\n你好\n13:22\n")
    mw = _make_mw([item])
    last_content = {}  # 没见过"新客户"

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        out = listen_chat.scan_unread(mw, last_content)

    assert "新客户" not in _senders(out), "首次见到只记录不触发（防把历史消息当新消息回）"
    assert last_content.get("新客户") == "你好", "首次见到必须记录内容供下轮比较"


def test_path1_badge_still_works():
    """有 [N条] 角标 → 照常命中（path-1 不回归）。"""
    item = _make_item("张三\n[1条] \n在吗\n09:00\n")
    mw = _make_mw([item])

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        out = listen_chat.scan_unread(mw, {})

    assert "张三" in _senders(out)


def test_path2_no_change_not_triggered():
    """无角标且内容与上次相同 → 不触发（避免重复回同一条）。"""
    item = _make_item("默忆\n在吗\n13:22\n")
    mw = _make_mw([item])
    last_content = {"默忆": "在吗"}  # 内容没变

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        out = listen_chat.scan_unread(mw, last_content)

    assert "默忆" not in _senders(out), "内容没变不该触发"


def test_updates_last_content_after_scan():
    """扫完后 last_content 反映当前预览，供下轮比较。"""
    item = _make_item("默忆\n什么价格\n13:22\n")
    mw = _make_mw([item])
    last_content = {"默忆": "在吗"}

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        listen_chat.scan_unread(mw, last_content)

    assert last_content.get("默忆") == "什么价格", "扫完必须更新 last_content 供下轮比较"
