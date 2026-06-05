"""
微信版本守卫单测 — `find_weixin._parse_and_check` / `_parse_version` 纯函数。

【背景铁证】微信 Windows 4.1.10.27 起把聊天窗口的无障碍控件树(mmui)砍了，
  UIA/MSAA 两层都读不到聊天控件；4.1.9.57 主窗口也已不透明。
  4.1.8.107 = 已验证可用基线。所以 RPA 必须跑在 <= 4.1.8 的微信上。

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


def test_old_4_0_5_allowed():
    """更老的 4.0.5.20 → 放行，不抛。"""
    assert _parse_and_check("4.0.5.20") is None


def test_4_1_8_edge_allowed():
    """4.1.8（无 build 段）边界 → 放行。"""
    assert _parse_and_check("4.1.8") is None


# ---------- _parse_and_check：阻断 ----------


def test_4_1_9_blocked():
    """4.1.9.57 起无障碍控件树被移除 → 抛 RuntimeError。"""
    with pytest.raises(RuntimeError) as exc:
        _parse_and_check("4.1.9.57")
    assert "4.1.9" in str(exc.value)


def test_4_1_10_blocked():
    """4.1.10.27 = 铁证版本 → 抛 RuntimeError。"""
    with pytest.raises(RuntimeError):
        _parse_and_check("4.1.10.27")


def test_future_5_x_blocked():
    """更高的主版本（如 5.0.0.0）→ 抛。"""
    with pytest.raises(RuntimeError):
        _parse_and_check("5.0.0.0")


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
