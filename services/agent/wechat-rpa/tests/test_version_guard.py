"""
微信版本守卫单测 — `find_weixin._parse_and_check` / `_parse_version` 纯函数。

【2026-06-24 政策更新】6-21 真机验证（memory wechat_qt_uia_works_dont_downgrade）：
  微信升 4.1.10+ Qt 窗口（Qt51514QWindowIcon）后 UIA 照样能发，版本锁不住也不需要降。
  旧死闸"只认 4.1.8.x，>=4.1.9 一律 fail"导致新机（4.1.10+）preflight 第一关就 fail、
  line04 模块永不激活。现放开上界：**>= 4.1.8 一律放行**（含 4.1.9 / 4.1.10+ / 未来版本）。
  仅保留下界：< 4.1.8（3.x / 4.0.x / 4.1.0~4.1.7）仍阻断——这些版本无 mmui::MainWindow /
  控件配方不一致，6-21 结论只向上验证（Qt 新版可用），未覆盖这些老版本。

【关键约束】版本比较走纯函数（_parse_version / _parse_and_check），
  不碰 ctypes/windll —— 可在 mac（无 windll）下用 pytest 直接跑通。
"""
from __future__ import annotations

import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

from find_weixin import _parse_and_check, _parse_version  # noqa: E402


# ---------- _parse_version ----------


def test_parse_version_basic():
    assert _parse_version("4.1.8.107") == (4, 1, 8, 107)
    assert _parse_version("4.1.9.57") == (4, 1, 9, 57)
    assert _parse_version("4.0.5.20") == (4, 0, 5, 20)
    assert _parse_version(" 4.1.10.27 ") == (4, 1, 10, 27)


def test_parse_version_invalid_returns_none():
    assert _parse_version(None) is None
    assert _parse_version("") is None
    assert _parse_version("   ") is None
    assert _parse_version("abc") is None
    assert _parse_version("4.x.8") is None


# ---------- _parse_and_check：放行 ----------


def test_baseline_4_1_8_allowed():
    """4.1.8.107 = 已验证可用基线 → 放行，不抛。"""
    assert _parse_and_check("4.1.8.107") is None


def test_old_4_0_5_blocked():
    """更老的 4.0.5.20 → 现在阻断（守卫只认 4.1.8.x，< 4.1.8 控件配方不一致）。"""
    with pytest.raises(RuntimeError):
        _parse_and_check("4.0.5.20")


def test_4_1_8_edge_allowed():
    """4.1.8（无 build 段）边界 → 放行。"""
    assert _parse_and_check("4.1.8") is None


# ---------- _parse_and_check：3.x 阻断（过低版本，mmui::MainWindow 不存在）----------


def test_3_x_version_blocked():
    """3.9.12.51（WeChat 3.x）→ 抛 RuntimeError（无 mmui::MainWindow）。"""
    with pytest.raises(RuntimeError) as exc:
        _parse_and_check("3.9.12.51")
    assert "3.9" in str(exc.value)


def test_3_0_version_blocked():
    """3.0.0.0 → 抛 RuntimeError。"""
    with pytest.raises(RuntimeError):
        _parse_and_check("3.0.0.0")


# ---------- _parse_and_check：放行（高版本，6-21 政策放开上界）----------


def test_4_1_9_allowed():
    """4.1.9.57 → 现放行（Qt 窗口 UIA 照样能用，不再因上界 fail）。"""
    assert _parse_and_check("4.1.9.57") is None


def test_4_1_10_allowed():
    """4.1.10.27 = 死闸误判的核心版本 → 现必须放行（这是本次修复要证的）。"""
    assert _parse_and_check("4.1.10.27") is None


def test_future_5_x_allowed():
    """更高的主版本（如 5.0.0.0）→ 放行（>= 4.1.8 一律过）。"""
    assert _parse_and_check("5.0.0.0") is None


# ---------- _parse_and_check：读不到版本不硬阻断 ----------


def test_none_does_not_raise():
    """版本读不到（None）→ 不抛（避免误杀），返回 None。"""
    assert _parse_and_check(None) is None


def test_empty_does_not_raise():
    """空串 → 不抛，返回 None。"""
    assert _parse_and_check("") is None


def test_garbage_does_not_raise():
    """非法版本串 → 不抛，返回 None。"""
    assert _parse_and_check("not-a-version") is None


# ---------- assert_supported_version ----------


def test_assert_supported_version_exists():
    """assert_supported_version 函数必须存在。"""
    from find_weixin import assert_supported_version
    assert callable(assert_supported_version)


def test_assert_supported_version_non_windows_skips():
    """非 Windows → assert_supported_version 不抛异常（无 windll，直接 None）。"""
    from unittest import mock
    import importlib
    import find_weixin as fw
    importlib.reload(fw)

    # get_weixin_version 在非 Windows 下返回 None（检测到 os.name != nt → return None）
    # _parse_and_check(None) → None（不抛）
    # 所以 assert_supported_version() 在 mac 下一定返回 None
    result = fw.assert_supported_version()
    assert result is None


def test_assert_supported_version_allows_4110():
    """用 mock 验证：get_weixin_version 返回 4.1.10.27 时 assert_supported_version 不抛（放开上界）。"""
    from unittest import mock
    import importlib
    import find_weixin as fw
    importlib.reload(fw)

    with mock.patch("find_weixin.get_weixin_version", return_value="4.1.10.27"):
        result = fw.assert_supported_version()
        assert result is None


def test_assert_supported_version_blocks_below_418():
    """用 mock 验证：4.1.7.25（< 4.1.8 下界）仍抛 RuntimeError（控件配方不一致）。"""
    from unittest import mock
    import importlib
    import find_weixin as fw
    importlib.reload(fw)

    with mock.patch("find_weixin.get_weixin_version", return_value="4.1.7.25"):
        try:
            fw.assert_supported_version()
            raise AssertionError("Expected RuntimeError for 4.1.7.25")
        except RuntimeError as e:
            assert "4.1.7" in str(e)


def test_assert_supported_version_passes_418():
    """用 mock 验证：get_weixin_version 返回 4.1.8.107 时 assert_supported_version 不抛。"""
    from unittest import mock
    import importlib
    import find_weixin as fw
    importlib.reload(fw)

    with mock.patch("find_weixin.get_weixin_version", return_value="4.1.8.107"):
        result = fw.assert_supported_version()
        assert result is None
