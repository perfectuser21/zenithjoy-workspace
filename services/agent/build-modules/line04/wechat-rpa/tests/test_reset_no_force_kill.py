"""
test_reset_no_force_kill.py — 复位第①步「绝不强杀已登录微信主进程」单测。

真机根因(2026-06-25 xian-rog 实测)：复位第①步 taskkill /F /T 强杀微信 4.x(多进程+xwechat)，
留下损坏锁/状态，导致随后重启微信必崩溃(t≈9s 崩，弹 crashpad 错误报告框)。而用户手动登录、
没被强杀过的微信实例稳定运行。

用户决策(方向 a)：xian-rog 是「专用 + 常驻唯一登录测试号」机器，微信本就该一直登录常驻。
复位第①步语义从「杀了重启」改成「确认微信常驻登录干净」：
  - 微信主进程在(已登录) → 绝不 taskkill 主进程，保留它(返回空 kill 列表)。
  - 微信没在跑 → 复位的验登录步会 launch_weixin 起一个(ensure_window_ready)；
    第①步只清可能残留的孤儿渲染子进程(WeChatAppEx)，不动主进程。

本测全 mock，CI 可跑。
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from reset_stage_cli import wechat_close_targets  # noqa: E402


def test_running_keeps_main_no_kill():
    """微信在跑(已登录) → 绝不强杀任何微信进程，保留常驻登录态。"""
    targets = wechat_close_targets(is_running=True)
    assert targets == [], f"微信在跑时复位不该杀任何微信进程，实际要杀 {targets}"


def test_not_running_no_main_to_keep():
    """微信没在跑 → 没有已登录主进程要保留；返回的清理目标里绝不含 Weixin.exe 主进程。"""
    targets = wechat_close_targets(is_running=False)
    assert "Weixin.exe" not in targets, "绝不把已登录主进程 Weixin.exe 列入强杀目标"


def test_never_force_kills_main_process_in_any_state():
    """任何状态下 Weixin.exe(主进程)都不在强杀目标里——这是本次修复的核心不变式。"""
    for running in (True, False):
        targets = wechat_close_targets(is_running=running)
        assert "Weixin.exe" not in targets, (
            f"is_running={running} 时不该强杀 Weixin.exe 主进程，实际 {targets}"
        )
