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


# ★ 2026-07-16 真机反馈根治：窗口自愈"闪一下最大化触发排版→立刻收回最小化"，
# 不再让微信永久霸占用户屏幕
#
# 用户实测反馈：微信主窗口被自愈逻辑强制全屏，且从不还原——一旦触发就永久霸占屏幕，
# 用户没法正常用自己的电脑。
#
# 真机验证过程（xian-rog，PsExec 真实操作，非 mock）：
#   1. 先测试"直接改成只 SW_MINIMIZE"这个最初想法——把窗口缩到问题尺寸(630x622,
#      单栏布局复现，sessions=5)后直接 SW_MINIMIZE：sessions 仍是 5，**没有修复，
#      只是把坏状态藏起来**（此路不通，已放弃）。
#   2. 对照组：从同样的小窗口状态 SW_MAXIMIZE（已知有效的旧修法）：sessions=32，
#      证实必须真的触发一次最大化的 resize 事件，微信才会把内部布局从单栏重排回
#      多栏，会话列表才重新出现在 UIA 树里。
#   3. 组合验证：SW_MAXIMIZE 触发排版后，紧接着 SW_MINIMIZE 收起来：sessions
#      仍保持 32（不会退回单栏坏态）。
#
# 结论：正确修法 = 先 SW_MAXIMIZE（真触发排版，不能省）→ 短暂停留 → 再 SW_MINIMIZE
# 收回（不占用户屏幕），不是简单把 SW_MAXIMIZE 换成 SW_MINIMIZE。

def test_heartbeat_self_heal_maximizes_then_minimizes():
    """两处窗口自愈调用点（心跳自愈 + 扫描前守卫）**各自**都必须是
    ShowWindow(SW_MAXIMIZE=3) → sleep(_WINDOW_HEAL_SETTLE_SLEEP) → ShowWindow(SW_MINIMIZE=6)
    紧邻序列，缺一不可——不能只改其中一处、留另一处仍是"只 maximize 从不收回"或
    "直接 minimize 不触发排版"（真机实测：跳过 maximize 直接 minimize 无法修复单栏
    布局，只是藏起坏状态；只 maximize 不 minimize 则永久霸占用户屏幕）。

    按源码逐行扫描而非聚合计数——聚合计数会被"只改一处、另一处不变"的部分修复
    骗过（两处调用合并统计时，未改的那处单独就能凑出 3 和 6 各至少一次）。
    """
    src_path = os.path.join(WECHAT_RPA_DIR, "listen_chat.py")
    with open(src_path, encoding="utf-8") as f:
        lines = f.readlines()

    # 找 run_real_listen 函数体范围（简单按下一个顶层 def 或 EOF 截断）
    start = next(i for i, l in enumerate(lines) if l.startswith("def run_real_listen"))
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("def "):
            end = i
            break
    body = lines[start:end]

    sites = 0
    for i, line in enumerate(body):
        if "ShowWindow(" in line and ", 3)" in line:
            # 紧接着几行内必须出现 settle sleep，再出现同一变量的 ShowWindow(..., 6)
            window = body[i + 1:i + 4]
            has_settle = any("_WINDOW_HEAL_SETTLE_SLEEP" in l for l in window)
            has_minimize = any("ShowWindow(" in l and ", 6)" in l for l in window)
            assert has_settle and has_minimize, (
                f"第 {start + i + 1} 行的 SW_MAXIMIZE 调用后 3 行内必须有 "
                f"sleep(_WINDOW_HEAL_SETTLE_SLEEP) 再 ShowWindow(..., 6) 收回，"
                f"实际后续: {window}"
            )
            sites += 1
    assert sites == 2, (
        f"应有 2 处窗口自愈调用点（心跳自愈 + 扫描前守卫）都遵循 "
        f"maximize→settle→minimize 序列，实际找到 {sites} 处"
    )
