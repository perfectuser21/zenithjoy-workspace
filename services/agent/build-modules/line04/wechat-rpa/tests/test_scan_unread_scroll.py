# -*- coding: utf-8 -*-
"""
TDD — scan_unread 滚动找【视口外未读】的累计/去重/到底纯逻辑单测。

真机铁证（rog 2026-07-01 dump）：微信会话列表 Qt 虚拟滚动一次只渲染可见 ~5-6 条 ListItem。
频繁自检狂发「文件传输助手」把它顶满视口，客户"默忆"的未读会话被挤到视口下面没渲染 →
旧 scan_unread 只读可见 ListItem 的 [N条] 红点 → 返回 unread=0 → 客户发消息永远不回。

修法：让 scan_unread 复用已有滚动机制滚整个列表，只读收集所有 [N条] 未读会话（不开会话/不开群），
滚完归位。本文件锁死「多屏会话名 → 收集所有未读、去重、到底停」的纯逻辑（顶层零 pywinauto，CI 可跑）。

测的纯函数：
1. `_UnreadScrollAccumulator` —— 只挑 [N条] 未读的累计器（区别于 _ScrollAccumulator 列全部联系人）：
   多屏（相邻屏有重叠）喂入 → 保序 distinct → 复用 _parse_item_name(require_unread=True) 只收未读 +
   parse_unread_count 取 N。跨屏把视口外未读也收进来（不止可见 6 条）。
2. `_bottom_reached_by_last_item` —— 已有的鲁棒到底判定（末项连续不变 → 停），scan_unread 滚动复用。
"""
from __future__ import annotations

import os
import sys
import types
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


def _page(*names):
    """一屏可见 ListItem 名字（每个会话一行 element_info.name）。"""
    return list(names)


# ─── _UnreadScrollAccumulator：只收 [N条] 未读，保序 distinct 累计 ──────────────────


def test_unread_acc_single_page_only_collects_unread():
    """单屏：只收带 [N条] 红点的会话，无角标的会话不进。"""
    acc = listen_chat._UnreadScrollAccumulator()
    new = acc.feed(_page(
        "默忆\n[1条] \n你们产品多少钱\n刚刚\n",     # 未读 → 收
        "于瑾(旧)\n好的收到\n昨天\n",               # 无角标 → 不收
        "李华\n[2条] \n在吗\n11:09\n",             # 未读 → 收
    ))
    assert new == 2
    out = acc.unread()
    assert [u["sender"] for u in out] == ["默忆", "李华"]
    assert out[0]["content"] == "你们产品多少钱"
    assert out[1]["count"] == 2


def test_unread_acc_overlapping_pages_finds_offscreen_unread():
    """虚拟滚动：相邻屏重叠，客户未读被自检消息顶到视口外 → 多屏滚动后仍能收到。

    page1 = 文件传输助手自检刷屏占满可见区（无客户未读）；
    page2/3 滚下去才露出客户未读「默忆/糊糊」。复现 rog 真机「可见区全是自检、客户未读在下面」。
    """
    acc = listen_chat._UnreadScrollAccumulator()
    page1 = _page(
        "文件传输助手\n[3条] \n[preflight-selfcheck]\n刚刚\n",  # 系统号(刷屏) → 不收
        "于瑾(旧)\n好的\n昨天\n",                              # 无角标
        "群通知\n大家好\n前天\n",                              # 无角标
    )
    page2 = _page(
        "群通知\n大家好\n前天\n",                              # 与 page1 重叠
        "默忆\n[1条] \n你们产品多少钱\n刚刚\n",                # ★视口外未读，滚到才露出
        "陈工\n[1条] \n报个价\n10:00\n",
    )
    page3 = _page(
        "陈工\n[1条] \n报个价\n10:00\n",                       # 与 page2 重叠
        "糊糊\n[5条] \n在吗在吗\n09:00\n",                     # ★更下面的未读
    )
    assert acc.feed(page1) == 0    # 可见区全是自检/无角标会话 → 0 未读（旧 bug 就停在这）
    assert acc.feed(page2) == 2    # 滚出 默忆 + 陈工
    assert acc.feed(page3) == 1    # 陈工重叠，只新增 糊糊
    senders = [u["sender"] for u in acc.unread()]
    assert senders == ["默忆", "陈工", "糊糊"]    # 三个视口外未读全收到，去重保序


def test_unread_acc_distinct_across_pages():
    """跨屏同名未读只留首次（去重）。"""
    acc = listen_chat._UnreadScrollAccumulator()
    p = _page("默忆\n[1条] \n你好\n刚刚\n")
    assert acc.feed(p) == 1
    assert acc.feed(p) == 0     # 同一屏再喂 → 0 新增（滚到底反复渲染同屏）
    assert len(acc.unread()) == 1


def test_unread_acc_skips_system_accounts():
    """系统号（文件传输助手 / 公众号）即便带角标也不收（与 _parse_item_name 同口径）。"""
    acc = listen_chat._UnreadScrollAccumulator()
    new = acc.feed(_page(
        "文件传输助手\n[9条] \n[selfcheck]\n刚刚\n",   # 系统号 → 不收
        "公众号\n[1条] \n广告\n11:09\n",              # 系统号 → 不收
        "真客户\n[1条] \n你好\n15:00\n",
    ))
    assert new == 1
    assert [u["sender"] for u in acc.unread()] == ["真客户"]


def test_unread_acc_preserves_count_for_n_gt_1():
    """N>1 的未读数原样保留（供 bug② N>1 合并全部消息上下文）。"""
    acc = listen_chat._UnreadScrollAccumulator()
    acc.feed(_page("张三\n[3条] \n连发三条\n09:00\n"))
    out = acc.unread()
    assert out[0]["count"] == 3


def test_unread_acc_respects_limit():
    """累计到 limit 后不再增长。"""
    acc = listen_chat._UnreadScrollAccumulator(limit=2)
    new = acc.feed(_page(*[f"客户{i}\n[1条] \n消息{i}\n10:0{i}\n" for i in range(5)]))
    assert new == 2
    assert len(acc.unread()) == 2
    assert acc.feed(_page("zz\n[1条] \n新\n11:00\n")) == 0


# ─── 到底判定复用（与 CRM 滚动同一鲁棒终止，防半路停漏底部）───────────────────────


def test_bottom_reached_robust_threshold():
    """末项连续不变达阈值才到底（鲁棒，扛滚动偶发 stall）；少于阈值不停（绝不少滚漏底）。"""
    assert listen_chat._bottom_reached_by_last_item(10, 10) is True
    assert listen_chat._bottom_reached_by_last_item(2, 10) is False


# ─── scan_unread 端到端行为：滚动找视口外未读，滚完归位（patch 掉真机 UIA） ──────────


def _mk_pair(name):
    """造一个 (name, item_ref) 对，item_ref 是 MagicMock（reply 用）。"""
    it = MagicMock()
    it.element_info.name = name
    return (name, it)


def test_scan_unread_scrolls_to_find_offscreen_unread_and_returns_to_top():
    """大账号（首屏满）：客户未读被自检刷屏顶到视口外 → 滚动多屏后仍收到，且滚完归位回顶。

    模拟 rog 真机：首屏全是「文件传输助手」自检 + 几个无角标会话（无客户未读，旧 bug 停这里），
    滚下去 page2/page3 才露出客户未读「默忆/糊糊」。断言三点：
      1. 三个视口外未读全部收到（不再 unread=0）；
      2. 滚完调 _reset_session_list_to_top 归位回顶（满足「滚完滚回顶部」死约束）；
      3. 全程没开会话/开群（只读收集，N=1 不触发 _open_chat）。
    """
    page1 = [_mk_pair(n) for n in [
        "文件传输助手\n[3条] \n[preflight-selfcheck]\n刚刚\n",  # 系统号刷屏
        "于瑾(旧)\n好的\n昨天\n",
        "群通知\n大家好\n前天\n",
        "老王\n收到\n前天\n",
        "小李\n嗯嗯\n前天\n",                                   # 首屏 5 项=满屏 → 触发滚动
    ]]
    page2 = page1[2:] + [_mk_pair("默忆\n[1条] \n你们产品多少钱\n刚刚\n"),
                         _mk_pair("陈工\n[1条] \n报个价\n10:00\n")]
    page3 = page2[2:] + [_mk_pair("糊糊\n[1条] \n在吗\n09:00\n")]

    pages = [page1, page2, page3]

    def fake_pairs(mw):
        # 前 3 次返回 page1/2/3，之后恒返回 page3（末项不变 → 触发到底）
        idx = min(fake_pairs.calls, len(pages) - 1)
        fake_pairs.calls += 1
        return list(pages[idx])
    fake_pairs.calls = 0

    mw = MagicMock()
    mw.descendants.return_value = []  # 归位后再读 visible ref 时返回空（用 scroll 期捕获的 ref）

    with patch.object(listen_chat, "_ensure_tray_visible", return_value=""), \
         patch.object(listen_chat, "_restore_window_state"), \
         patch.object(listen_chat, "_read_visible_item_pairs", side_effect=fake_pairs), \
         patch.object(listen_chat, "_scroll_session_list_wheel") as mock_scroll, \
         patch.object(listen_chat, "_reset_session_list_to_top", return_value=True) as mock_reset, \
         patch.object(listen_chat, "_open_chat") as mock_open, \
         patch("time.sleep"):
        out = listen_chat.scan_unread(mw, last_content={})

    senders = [m["sender"] for m in out]
    assert "默忆" in senders, f"视口外未读「默忆」必须被滚动找到，实际: {senders}"
    assert "糊糊" in senders and "陈工" in senders, f"所有视口外未读都要找到，实际: {senders}"
    assert mock_scroll.called, "大账号首屏满 → 必须滚动找视口外未读"
    assert mock_reset.called, "滚完必须 _reset_session_list_to_top 归位回顶（死约束1）"
    mock_open.assert_not_called()    # 只读收集，N=1 不开会话/开群（死约束1）
    assert all(m.get("_item") is not None for m in out if m["sender"] in ("默忆", "陈工", "糊糊"))


def test_scan_unread_small_account_no_scroll_no_tab_switch():
    """小账号（首屏未满）：所有会话一屏可见 → 不滚动、不切 tab（保留旧轻量路径，零回归）。

    死约束/回归（#962/#965）：scan_unread 绝不每轮切 tab 回顶（rog 上切 tab 偶发失败→卡通讯录→
    回一次就不理）。只有大账号真有视口外未读才滚 + 归位；小账号走原直读路径。
    """
    page = [_mk_pair("默忆\n[2条] \n你们产品多少钱\n刚刚\n"),
            _mk_pair("于瑾\n好的\n昨天\n")]   # 首屏仅 2 项 < 满屏阈值 → 不滚

    with patch.object(listen_chat, "_ensure_tray_visible", return_value=""), \
         patch.object(listen_chat, "_restore_window_state"), \
         patch.object(listen_chat, "_read_visible_item_pairs", return_value=page), \
         patch.object(listen_chat, "_scroll_session_list_wheel") as mock_scroll, \
         patch.object(listen_chat, "_reset_session_list_to_top") as mock_reset, \
         patch.object(listen_chat, "_open_chat", return_value=True), \
         patch.object(listen_chat, "read_chat_panel_messages", return_value=["你们产品多少钱", "在吗"]), \
         patch("time.sleep"):
        out = listen_chat.scan_unread(mw=MagicMock(), last_content={})

    assert any(m["sender"] == "默忆" for m in out)
    mock_scroll.assert_not_called()   # 小账号绝不滚
    mock_reset.assert_not_called()    # 小账号绝不切 tab（零回归）
