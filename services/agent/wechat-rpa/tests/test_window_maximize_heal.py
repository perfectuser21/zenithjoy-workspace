"""回归测试（2026-07-08 真机取证，issue 99741ff9 / skill §2.K；v1.0.120 扫描前守卫）：

真机现象：主窗口 630x622 非最大化时微信进【单栏布局】，会话列表整个不在 UIA 树，
scan_unread 读到的是聊天气泡（sessions=4 假象），新消息 20 分钟无反应且日志"一切正常"。
SW_MAXIMIZE 后 sessions 4→26 立即恢复。微信重启后默认非最大化 → 每次自愈重启都掉坑。
修法1 (bc7ce517)：心跳检测 可见+非最大化 → 自动 SW_MAXIMIZE 自愈。
修法2 (v1.0.120)：扫描前守卫——心跳 maximize 后同轮立即扫描仍读旧单栏树的竞态根治；
    可见+非最大化时 SW_MAXIMIZE 并跳过本轮 scan_unread，等下轮 UIA 树重建后再扫。

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


def test_visible_not_maximized_needs_heal():
    assert listen_chat.window_needs_maximize(is_zoomed=False, is_iconic=False) is True


def test_already_maximized_no_heal():
    assert listen_chat.window_needs_maximize(is_zoomed=True, is_iconic=False) is False


def test_iconic_tray_state_untouched():
    """最小化/托盘是合法运行态（'微信最小化也能跑'），绝不强行弹最大化窗口。"""
    assert listen_chat.window_needs_maximize(is_zoomed=False, is_iconic=True) is False


def test_build_diag_carries_window_state_and_welcome_fails():
    diag = listen_chat.build_diag(
        main_window_found=True, login_present=False, logged_in=True,
        screen_locked=False, sessions_seen=26, unread_senders=[],
        replied_count=0, last_error=None, skip_snapshot={"delta": {}},
        window_state={"zoomed": True, "iconic": False, "w": 2560, "h": 1528,
                      "maximize_heals": 1},
        welcome_click_fails=0,
    )
    assert diag["window_state"]["zoomed"] is True
    assert diag["window_state"]["maximize_heals"] == 1
    assert diag["welcome_click_fails"] == 0


def test_build_diag_backward_compatible_without_new_args():
    """旧调用（不带新参数）不破坏：新键有安全默认值。"""
    diag = listen_chat.build_diag(
        main_window_found=True, login_present=False, logged_in=True,
        screen_locked=False, sessions_seen=5, unread_senders=[],
        replied_count=0, last_error=None, skip_snapshot={"delta": {}},
    )
    assert diag["window_state"] == {}
    assert diag["welcome_click_fails"] == 0


def test_pre_scan_guard_logic_visible_not_maximized():
    """v1.0.120 扫描前守卫逻辑（CI等价断言）：可见+非最大化 → window_needs_maximize 返 True
    → 守卫触发 SW_MAXIMIZE 并 continue 跳过 scan_unread（真机段：下轮 UIA 树重建后才扫）。
    本测验证纯函数判定正确，守卫的 ctypes 调用在 Windows 真机运行（真机段 TODO）。
    """
    assert listen_chat.window_needs_maximize(is_zoomed=False, is_iconic=False) is True, \
        "visible+non-maximized 必须触发扫描前守卫"


def test_pre_scan_guard_no_skip_after_maximize():
    """最大化完成后（is_zoomed=True）守卫不再跳过，scan_unread 正常运行。"""
    assert listen_chat.window_needs_maximize(is_zoomed=True, is_iconic=False) is False, \
        "已最大化状态守卫不应触发（避免无限 skip 循环）"


def test_pre_scan_guard_iconic_passthrough():
    """托盘/最小化（iconic=True）守卫放行——微信最小化合法运行态，不弹窗不阻扫。"""
    assert listen_chat.window_needs_maximize(is_zoomed=False, is_iconic=True) is False, \
        "iconic 状态守卫不应触发（强行弹最大化会打扰操作者）"


# ★ 2026-07-16 真机反馈根治：窗口自愈从 SW_MAXIMIZE 改 SW_MINIMIZE，不再抢用户屏幕
#
# 用户实测反馈：微信主窗口被自愈逻辑强制全屏，且从不还原——一旦触发就永久霸占屏幕，
# 用户没法正常用自己的电脑。根因：两处 ShowWindow 调用（心跳自愈 + 扫描前守卫）都用
# SW_MAXIMIZE(3)，且没有配套"还原"逻辑。
#
# 但本文件自己的 test_iconic_tray_state_untouched 早已证明：iconic（托盘/最小化）是
# 已被验证过的合法运行态（"微信最小化也能跑"），_ensure_tray_visible/_uia_send 等既有
# 代码全程假设微信常态是最小化、需要操作时临时 restore 再收回。既然可见+非最大化的
# 单栏布局问题只需要"脱离这个坏态"，落到 iconic（已知安全、不打扰用户）比落到
# maximize（抢占整个屏幕）更合理——同样解决单栏布局问题，代价小得多。

def test_heartbeat_self_heal_uses_minimize_not_maximize():
    """心跳自愈调用点：ShowWindow 必须传 SW_MINIMIZE(6)，不能再是 SW_MAXIMIZE(3)。"""
    import ast

    src_path = os.path.join(WECHAT_RPA_DIR, "listen_chat.py")
    with open(src_path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    showwindow_args = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "run_real_listen":
            for n in ast.walk(node):
                if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                        and n.func.attr == "ShowWindow" and len(n.args) >= 2
                        and isinstance(n.args[1], ast.Constant)):
                    showwindow_args.append(n.args[1].value)
            break
    assert showwindow_args, "run_real_listen 里没找到任何 ShowWindow 调用"
    assert 3 not in showwindow_args, (
        f"窗口自愈仍在用 SW_MAXIMIZE(3) 强制全屏——应改用 SW_MINIMIZE(6)。"
        f"实际所有 ShowWindow 调用的第二参数: {showwindow_args}"
    )
    assert 6 in showwindow_args, (
        f"窗口自愈必须用 SW_MINIMIZE(6) 替代强制全屏；实际值: {showwindow_args}"
    )
