# -*- coding: utf-8 -*-
"""
TDD — `scan_recent_contacts` 列出近期会话联系人（CRM 好友表行源）单测。

背景（PrepPRD §3.4 / 修正5）：把"客服白名单手填"换成"agent 扫客服机微信近期会话
联系人 → 报中台"。`scan_unread` 只挑有 `[N条]` 未读角标的会话，没有"列出全部近期
会话联系人"的能力。本文件测两件事：

1. `_collect_recent_contacts(item_names, limit)` —— 纯函数（顶层零 pywinauto），把一批
   ListItem 的 element_info.name 列表解析成 distinct 近期联系人（含 last_message），
   不要求未读，套 SKIP_SENDERS / SKIP_GROUP_KEYWORDS 过滤。CI clean 能跑。
2. `scan_recent_contacts(mw, limit)` —— 真机入口（mock mw），复用 _ensure_tray_visible /
   _restore_window_state，遍历 ListItem 调纯函数收集，扫前移窗扫后还原（后台无感知）。

【CI 安全】顶层零 pywinauto import；scan_recent_contacts 的 pywinauto 依赖（ctypes.windll）
  靠 test_tray_scan_fix 同款 stub 注入。
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
    """在 macOS/Linux 上注入 ctypes.windll stub（与 test_tray_scan_fix 同款）。"""
    windll_mock = MagicMock(user32=user32, kernel32=MagicMock(),
                            dwmapi=MagicMock())
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


# ─── 纯函数 _collect_recent_contacts（CI clean 可跑，零 pywinauto）─────────────


def test_collect_basic_private_contacts_no_unread_required():
    """近期会话不要求未读：含/不含 [N条] 角标的私聊都收进来。"""
    names = [
        "于瑾\n[1条] \n您好\n15:26\n",     # 有未读
        "李华\n昨天聊过\n11:09\n",          # 无未读（scan_unread 会漏，这里要收）
        "张三\n在吗\n09:00\n",
    ]
    out = listen_chat._collect_recent_contacts(names, limit=100)
    senders = [c["name"] for c in out]
    assert senders == ["于瑾", "李华", "张三"]
    # last_message 预览带出来
    by_name = {c["name"]: c for c in out}
    assert by_name["李华"]["last_message"] == "昨天聊过"
    assert by_name["于瑾"]["last_message"] == "您好"


def test_collect_filters_official_and_service_accounts():
    """公众号/服务号/文件传输助手等系统账号过滤掉（复用 SKIP_SENDERS）。"""
    names = [
        "公众号\n广告\n11:09\n",
        "服务号\n推送\n09:00\n",
        "文件传输助手\n文件\n08:00\n",
        "微信团队\n通知\n07:00\n",
        "真客户\n你好\n15:00\n",
    ]
    out = listen_chat._collect_recent_contacts(names, limit=100)
    assert [c["name"] for c in out] == ["真客户"]


def test_collect_filters_only_named_groups_not_colon_preview():
    """只按 SKIP_GROUP_KEYWORDS（名字含 群/频道/讨论组/直播间）排真群；
    不再靠"消息预览有冒号前缀"瞎猜群（误删客户小群 + 带冒号私聊的真凶，规则3 已删）。

    规则3 误杀实证（rog 真机 + 用户确认）：
      - 客户小群"客户名、徐先生企业自媒体-Ai助力"（名字无"群"，2-3 人）被群前缀误删 → 业务要它进 CRM。
      - "成员名: 内容"预览也可能是私聊转发/真群——采集端不瞎猜，漏进的群由 CRM 黑名单标记处理。
    """
    names = [
        "老乡交流群\n大家好\n11:09\n",                       # 名字含"群" → 真群，排除（规则1）
        "某频道\n上新了\n09:00\n",                            # 名字含"频道" → 排除（规则1）
        "客户名、徐先生企业自媒体-Ai助力\n小明: 收到\n08:00\n",  # 客户小群名字无"群" → 必须收（规则3 已删）
        "真客户\n在吗\n15:00\n",
    ]
    out = listen_chat._collect_recent_contacts(names, limit=100)
    assert [c["name"] for c in out] == ["客户名、徐先生企业自媒体-Ai助力", "真客户"]


def test_collect_keeps_private_chat_with_colon_message():
    """带冒号开头的私聊消息（"提醒：..."/"链接: ..."/"通知：..."）不得被当群删掉（规则3 真凶）。"""
    names = [
        "张三\n提醒：明天发货\n15:26\n",
        "李四\n链接: http://x.com\n11:09\n",
        "王五\n通知：已到账\n09:00\n",
    ]
    out = listen_chat._collect_recent_contacts(names, limit=100)
    assert [c["name"] for c in out] == ["张三", "李四", "王五"]
    by = {c["name"]: c for c in out}
    assert by["张三"]["last_message"] == "提醒：明天发货"
    assert by["李四"]["last_message"] == "链接: http://x.com"


def test_collect_distinct_dedup_keeps_first():
    """同一 sender 多次出现只保留第一条（distinct，列表顶部 = 最近）。"""
    names = [
        "于瑾\n[2条] \n最新一条\n15:26\n",
        "于瑾\n较早一条\n10:00\n",
    ]
    out = listen_chat._collect_recent_contacts(names, limit=100)
    assert len(out) == 1
    assert out[0]["name"] == "于瑾"
    assert out[0]["last_message"] == "最新一条"


def test_collect_respects_limit():
    """超过 limit 截断，取列表靠前（最近）的 N 个。"""
    names = [f"客户{i}\n消息{i}\n10:0{i}\n" for i in range(5)]
    out = listen_chat._collect_recent_contacts(names, limit=3)
    assert [c["name"] for c in out] == ["客户0", "客户1", "客户2"]


def test_collect_skips_pinned_only_no_real_message():
    """仅"已置顶"无真实消息的会话 → 无 last_message → 仍可作为联系人收进（用占位空预览）。

    与 scan_unread 不同：scan_recent_contacts 目标是"列出联系人"，
    哪怕没消息预览也要列出这个人（只是 last_message 为空）。
    """
    out = listen_chat._collect_recent_contacts(["糊糊\n[1条] \n已置顶\n14:30\n"], limit=100)
    assert len(out) == 1
    assert out[0]["name"] == "糊糊"
    assert out[0]["last_message"] == ""  # 无真实消息 → 空预览，但人要在


def test_collect_skips_empty_and_malformed_names():
    """空字符串 / 单行无内容 → 跳过，不崩。"""
    out = listen_chat._collect_recent_contacts(["", "\n", "只有一行"], limit=100)
    assert out == []


# ─── scan_recent_contacts(mw) 入口（mock mw + windll，验证移窗/还原 + 复用纯函数）────


def _make_mock_mw_with_items(names, hwnd=12345):
    mw = MagicMock()
    mw.element_info.handle = hwnd
    items = []
    for n in names:
        it = MagicMock()
        it.element_info.name = n
        items.append(it)
    mw.descendants.return_value = items
    return mw


def test_scan_recent_contacts_visible_no_window_move(monkeypatch):
    """窗口已可见（_ensure_tray_visible 返回 ''）→ 扫描返回近期联系人，还原被调用。"""
    mw = _make_mock_mw_with_items([
        "于瑾\n您好\n15:26\n",
        "李华\n在吗\n11:09\n",
        "公众号\n广告\n09:00\n",
    ])
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = False
    # GetWindowRect 让窗口已在可视区（left>-2000），但关闭 OFFSCREEN 让它不移窗
    monkeypatch.setattr(listen_chat, "_OFFSCREEN_REPLY", False, raising=False)

    with _mock_windll(user32), patch("time.sleep"):
        out = listen_chat.scan_recent_contacts(mw, limit=100)

    assert [c["name"] for c in out] == ["于瑾", "李华"]


def test_scan_recent_contacts_tray_restores_window(monkeypatch):
    """微信在托盘（IsWindowVisible=False）→ 扫前 _ensure_tray_visible 移出、扫后 _restore_window_state 还原。"""
    mw = _make_mock_mw_with_items(["真客户\n你好\n15:00\n"])
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False  # 托盘
    user32.IsIconic.return_value = False
    monkeypatch.setattr(listen_chat, "_OFFSCREEN_REPLY", False, raising=False)

    with _mock_windll(user32), patch("time.sleep"):
        out = listen_chat.scan_recent_contacts(mw, limit=100)

    # 还原必须把窗口送回托盘 SW_HIDE(0)
    user32.ShowWindow.assert_any_call(mw.element_info.handle, 0)
    assert [c["name"] for c in out] == ["真客户"]
