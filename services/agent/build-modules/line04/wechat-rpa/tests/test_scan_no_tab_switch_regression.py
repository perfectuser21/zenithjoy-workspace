"""
回归测试：scan_unread 不得每轮"切 tab 回顶"，且 _reset_session_list_to_top 切 tab 必须原子
（绝不"切去通讯录又回不到微信"把会话列表卡死）。

根因（xian-rog 真机坐实 2026-06-29）：#955 给 scan_unread 每轮扫描前加了 _reset_session_list_to_top
（点「通讯录」→ 点「微信」回顶）。74654efd（能连续回复的基线）没有这行。rog 上这个切 tab 会失败
（日志 `找不到「微信」按钮`），一旦切去通讯录、回不到微信 → 微信卡在通讯录 tab → 无会话列表 →
sessions=0 → 之后全收不到 → 用户体感「回一次就不理」。

修法：
  1) scan_unread 去掉每轮 _reset_session_list_to_top（回到 74654efd「直接读列表」）。
  2) _reset_session_list_to_top 改原子：找不齐「通讯录」+「微信」两个按钮就不切（绝不卡死），
     切了务必收尾在微信 tab。
  3) 回顶只在 scan_recent_contacts（CRM 真滚了列表）收尾做一次。

本文件是永久 regression test，禁止删除。
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

import listen_chat  # noqa: E402


def _fake_mw_with_items(names):
    """造一个 fake mw：descendants(ListItem) 返回带 element_info.name 的假项。"""
    items = []
    for n in names:
        it = MagicMock()
        it.element_info.name = n
        items.append(it)
    mw = MagicMock()
    mw.descendants.return_value = items
    return mw


class TestScanUnreadNoTabSwitch:
    def test_scan_unread_does_not_reset_session_list(self):
        """scan_unread 绝不调用 _reset_session_list_to_top（切 tab）——这是把连续回复搞坏的回归根因。"""
        mw = _fake_mw_with_items(["默忆\n[1条] \n你好\n刚刚\n"])
        with patch.object(listen_chat, "_ensure_tray_visible", return_value=""), \
             patch.object(listen_chat, "_restore_window_state"), \
             patch.object(listen_chat, "_reset_session_list_to_top") as mock_reset:
            listen_chat.scan_unread(mw, {})
        mock_reset.assert_not_called()

    def test_scan_unread_still_reads_unread(self):
        """去掉切 tab 后，scan_unread 仍能正常读出未读（直接读列表，对齐 74654efd）。"""
        mw = _fake_mw_with_items(["默忆\n[2条] \n你们产品多少钱\n刚刚\n"])
        with patch.object(listen_chat, "_ensure_tray_visible", return_value=""), \
             patch.object(listen_chat, "_restore_window_state"), \
             patch.object(listen_chat, "_reset_session_list_to_top"):
            out = listen_chat.scan_unread(mw, {})
        assert any(m["sender"] == "默忆" for m in out)


class TestResetAtomic:
    def test_reset_skips_when_wechat_button_missing(self):
        """找不到「微信」按钮 → 绝不点「通讯录」（不切去通讯录卡死），返回 False。"""
        mw = MagicMock()
        def fake_find(buttons, tab, left_max=90, win_left=0):
            return (10, 20) if tab == "通讯录" else None   # 微信按钮找不到
        with patch.object(listen_chat, "_iter_all_controls", return_value=[]), \
             patch.object(listen_chat, "_find_left_nav_button_point", side_effect=fake_find), \
             patch.object(listen_chat, "_click_screen_point") as mock_click:
            result = listen_chat._reset_session_list_to_top(mw)
        assert result is False
        mock_click.assert_not_called()   # 关键：没点任何按钮，绝不把微信留在通讯录

    def test_reset_switches_when_both_found(self):
        """两个按钮都找到 → 点「通讯录」再点「微信」，收尾在微信 tab。"""
        mw = MagicMock()
        def fake_find(buttons, tab, left_max=90, win_left=0):
            return (10, 20) if tab == "通讯录" else (10, 50)
        clicked = []
        with patch.object(listen_chat, "_iter_all_controls", return_value=[]), \
             patch.object(listen_chat, "_find_left_nav_button_point", side_effect=fake_find), \
             patch.object(listen_chat, "_click_screen_point", side_effect=lambda mw, pt: clicked.append(pt) or True), \
             patch("time.sleep"):
            result = listen_chat._reset_session_list_to_top(mw)
        assert result is True
        assert clicked[0] == (10, 20)   # 先通讯录
        assert clicked[-1] == (10, 50)  # 收尾在微信
