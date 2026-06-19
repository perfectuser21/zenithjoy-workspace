"""
test_offscreen.py — 验证 OFFSCREEN_X 从虚拟屏几何推导（不写死）+ 可见性判定纯逻辑。

接缝说明：真机静默自检（窗口全程不碰可见区）走 listen_chat.py --verify-silent，
需真微信窗口，不进 CI。本文件只测「几何推导」「可见判定」「machine.config.json 覆盖」
三段纯逻辑（环境无关，CI 验得了）。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config


def _make_fake_gsm(metrics: dict):
    """构造假的 GetSystemMetrics：按 SM_* 索引返回 metrics 里的值。"""
    def _fake(index):
        return metrics[index]
    return _fake


def test_compute_offscreen_x_derives_left_of_virtual_screen(monkeypatch):
    """单屏 vleft=0 vw=2560 → OFFSCREEN_X = 0 - 1200 - 200 = -1400（移到虚拟屏左界之外）。"""
    fake = _make_fake_gsm({76: 0, 77: 0, 78: 2560, 79: 1600})
    monkeypatch.setattr(config, "_get_system_metrics", lambda: fake)
    assert config.compute_offscreen_x(1200) == 0 - 1200 - 200 == -1400


def test_compute_offscreen_x_left_monitor(monkeypatch):
    """左侧还有一块显示器时 vleft 为负（如 -1920），推导值必须比 -1920 还更左（更负）。"""
    fake = _make_fake_gsm({76: -1920, 77: 0, 78: 4480, 79: 1600})
    monkeypatch.setattr(config, "_get_system_metrics", lambda: fake)
    derived = config.compute_offscreen_x(1200)
    assert derived == -1920 - 1200 - 200 == -3320
    assert derived < -1920, "推导值必须落在左屏更左（虚拟屏左界之外）"


def test_compute_offscreen_x_clamps_nonpositive_width(monkeypatch):
    """win_width 传负值/0（非法）→ 钳到保守宽度 1200，不算出错误（落可见区）的离屏值。"""
    fake = _make_fake_gsm({76: 0, 77: 0, 78: 2560, 79: 1600})
    monkeypatch.setattr(config, "_get_system_metrics", lambda: fake)
    assert config.compute_offscreen_x(0) == 0 - 1200 - 200 == -1400
    assert config.compute_offscreen_x(-500) == 0 - 1200 - 200 == -1400


def test_compute_offscreen_x_fallback_when_unavailable(monkeypatch):
    """非 Windows / GetSystemMetrics 不可用 → 回退兜底 -2600，绝不抛。"""
    monkeypatch.setattr(config, "_get_system_metrics", lambda: None)
    assert config.compute_offscreen_x(1200) == -2600


def test_visible_intersection():
    """visible(rc) 对屏外/屏内/压边界三类矩形的判定。虚拟屏 = [0,2560) × [0,1600)。"""
    vleft, vtop, vw, vh = 0, 0, 2560, 1600

    class _Rc:
        def __init__(self, left, top, right, bottom):
            self.left, self.top, self.right, self.bottom = left, top, right, bottom

    # 完全在屏内 → 可见
    assert config.rect_visible(_Rc(100, 100, 900, 700), vleft, vtop, vw, vh) is True
    # 完全在虚拟屏左界之外（right <= vleft）→ 不可见
    assert config.rect_visible(_Rc(-1400, 60, -200, 900), vleft, vtop, vw, vh) is False
    # 左界外但右边压进可见区一像素（right > vleft）→ 可见
    assert config.rect_visible(_Rc(-1400, 60, 1, 900), vleft, vtop, vw, vh) is True
    # 贴右界外（left >= vleft+vw）→ 不可见
    assert config.rect_visible(_Rc(2560, 60, 3760, 900), vleft, vtop, vw, vh) is False
    # 完全在虚拟屏上界之外（bottom <= vtop）→ 不可见
    assert config.rect_visible(_Rc(100, -900, 900, 0), vleft, vtop, vw, vh) is False


def test_offscreen_x_default_is_derived_or_fallback():
    """模块默认 OFFSCREEN_X 必须 <= -1400（推导值）或回退 -2600，总之足够负。"""
    assert isinstance(config.OFFSCREEN_X, int)
    assert config.OFFSCREEN_X <= -1400


def test_machine_config_overrides_derived(tmp_path, monkeypatch):
    """machine.config.json 显式写 OFFSCREEN_X 时，必须覆盖几何推导值（显式 > 推导）。"""
    import importlib

    cfgdir = tmp_path / "core"
    cfgdir.mkdir()
    (cfgdir / "machine.config.json").write_text(
        '{"OFFSCREEN_X": -9000}', encoding="utf-8"
    )
    monkeypatch.setenv("ZENITHJOY_CORE_DIR", str(cfgdir))
    importlib.reload(config)
    try:
        assert config.OFFSCREEN_X == -9000, "machine.config.json 显式值必须覆盖推导值"
    finally:
        # 还原模块全局态，避免污染其它测试
        monkeypatch.delenv("ZENITHJOY_CORE_DIR", raising=False)
        importlib.reload(config)


# ── --verify-silent --no-send 只读模式（开机自检接缝）──────────────────────────
# 真机静默行为（移屏外+采样）需真窗口，proven-to-fire 在 xian-rog 跑，不进 CI。
# 这里只回归保护「只读模式参数被接受」+「非 Windows 守卫返回 1，绝不发消息」。


def test_verify_silent_no_send_args_accepted(monkeypatch):
    """--verify-silent --no-send --silent-sample-seconds N 被接受（开机自检只读模式）。"""
    import sys
    import listen_chat
    monkeypatch.setattr(
        sys, "argv",
        ["listen_chat.py", "--verify-silent", "--no-send", "--silent-sample-seconds", "3"],
    )
    args = listen_chat.parse_args()
    assert args.verify_silent is True
    assert args.no_send is True
    assert args.silent_sample_seconds == 3


def test_verify_silent_no_send_non_windows_guard_no_send(monkeypatch):
    """非 Windows 上 run_verify_silent 直接守卫返回 1，绝不进入发送/采样路径。"""
    import platform
    import listen_chat
    monkeypatch.setattr(platform, "system", lambda: "Darwin")
    ns = type("NS", (), {"no_send": True, "target": None, "message": "x", "silent_sample_seconds": 2})()
    assert listen_chat.run_verify_silent(ns) == 1
