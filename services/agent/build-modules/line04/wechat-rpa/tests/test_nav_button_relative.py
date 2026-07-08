"""回归测试（2026-07-08 真机取证，issue 8e163d87 / skill §2.I）：

真机现象：微信窗口不贴屏幕左边缘（如 rect.left=964）时，_reset_session_list_to_top
永远报"导航按钮不全"，回顶失败 → job3 gate 连续失败 / 视口外会话永远切不到。
根因：_find_left_nav_button_point 的 left_max=90 判的是【屏幕绝对坐标】r.left<90，
只有窗口最大化（left=0）时才碰巧成立。
修法：新增 win_left 参数（主窗口 rect.left），判定改窗口相对坐标 r.left-win_left<left_max。

本文件是永久 regression test，禁止删除。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock


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


HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, WECHAT_RPA_DIR)
_stub_heavy_deps()

import listen_chat  # noqa: E402


class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


def test_window_not_at_screen_left_edge_found_with_win_left():
    """真机场景：窗口在 x=964，导航按钮 rect.left=964。传 win_left=964 必须找到。"""
    buttons = [("通讯录", _Rect(964, 673, 1054, 727)), ("微信", _Rect(964, 601, 1054, 655))]
    pt = listen_chat._find_left_nav_button_point(buttons, "通讯录", win_left=964)
    assert pt == ((964 + 1054) // 2, (673 + 727) // 2)


def test_old_absolute_behavior_kept_when_win_left_zero():
    """win_left=0（缺省）= 旧行为：最大化窗口（按钮 left=0）找得到。"""
    buttons = [("通讯录", _Rect(0, 216, 90, 270))]
    pt = listen_chat._find_left_nav_button_point(buttons, "通讯录")
    assert pt == (45, 243)


def test_right_side_same_name_control_not_selected():
    """右侧同名控件（相对 x >= left_max）不选——原有防串规则在相对坐标下保持。"""
    buttons = [("微信", _Rect(1081, 493, 1129, 523))]  # 标题栏"微信"文字按钮，窗口 left=964
    assert listen_chat._find_left_nav_button_point(buttons, "微信", win_left=964) is None
