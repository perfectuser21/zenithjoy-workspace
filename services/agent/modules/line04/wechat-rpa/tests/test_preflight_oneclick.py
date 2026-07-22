"""
test_preflight_oneclick.py — Agent 一键安装加固回归测试。

验证 5 个修复点：
  1. check_uia_narrator: dry-run → warn（不触碰系统标志）
  2. check_uia_narrator: 设 SPI 屏幕阅读器标志后无主窗口 → warn（兼容"微信未登录"场景）
  3. check_uia_narrator: 设 SPI 标志成功 + 有主窗口 → ok（且调用 SystemParametersInfoW）
  4. start.bat 包含 install-autostart.ps1 调用
  5. start.bat 不再包含早退的版本守卫块

跨平台纪律：所有 Windows-only 路径用 monkeypatch/mock 模拟。
UIA 激活已从"启动讲述人 Narrator.exe"改为 ctypes 设 SPI_SETSCREENREADER 系统标志。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
INSTALL_PACK_DIR = os.path.abspath(os.path.join(HERE, "../../install-pack"))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import preflight  # noqa: E402
from preflight import check_uia_narrator  # noqa: E402


# ──────────────────────────────────────────────────────────────────────────────
# 测试 1：dry-run → warn（只检测不激活，不触碰系统标志）
# ──────────────────────────────────────────────────────────────────────────────

def test_uia_dry_run_warn():
    result = check_uia_narrator(dry_run=True)
    assert result["status"] == "warn"


# ──────────────────────────────────────────────────────────────────────────────
# 测试 2：设 SPI 标志成功但无主窗口 → warn（微信未登录兼容场景）
# ──────────────────────────────────────────────────────────────────────────────

def test_uia_spi_no_window_warn(monkeypatch):
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    fake_windll = MagicMock()
    monkeypatch.setattr(preflight.ctypes, "windll", fake_windll, raising=False)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: None, raising=False)
    result = check_uia_narrator(dry_run=False)
    assert result["status"] == "warn"
    assert "讲述人" not in result["detail"]


# ──────────────────────────────────────────────────────────────────────────────
# 测试 3：设 SPI 标志成功 + 有主窗口 → ok（且真调用 SystemParametersInfoW）
# ──────────────────────────────────────────────────────────────────────────────

def test_uia_spi_ok(monkeypatch):
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    fake_windll = MagicMock()
    monkeypatch.setattr(preflight.ctypes, "windll", fake_windll, raising=False)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: object(), raising=False)
    result = check_uia_narrator(dry_run=False)
    assert result["status"] == "ok"
    fake_windll.user32.SystemParametersInfoW.assert_called_once()


# ──────────────────────────────────────────────────────────────────────────────
# 测试 4：start.bat 包含 install-autostart.ps1 调用
# ──────────────────────────────────────────────────────────────────────────────

def test_start_bat_contains_autostart_call():
    """start.bat 必须包含对 install-autostart.ps1 的调用（不再需要用户手动跑）。"""
    bat_path = os.path.join(INSTALL_PACK_DIR, "start.bat")
    assert os.path.isfile(bat_path), f"找不到 start.bat：{bat_path}"
    content = Path(bat_path).read_text(encoding="utf-8", errors="ignore")
    assert "install-autostart.ps1" in content, (
        "start.bat 必须包含对 install-autostart.ps1 的调用（开机自启应自动注册）"
    )
    import re
    assert re.search(r"powershell.*install-autostart\.ps1", content, re.IGNORECASE), (
        "start.bat 缺少 `powershell ... install-autostart.ps1` 真实调用行"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 测试 5：start.bat 不再有早退的版本守卫块
# ──────────────────────────────────────────────────────────────────────────────

def test_start_bat_no_early_version_exit():
    """
    start.bat 不应再有"版本不对就 exit /b 1"的早退块。
    preflight.py step 6.9 已有完整版本检测+自修，早退块会阻断自修。
    """
    bat_path = os.path.join(INSTALL_PACK_DIR, "start.bat")
    assert os.path.isfile(bat_path), f"找不到 start.bat：{bat_path}"
    content = Path(bat_path).read_text(encoding="utf-8", errors="ignore")
    import re
    has_early_exit = bool(re.search(r"find_weixin\.py.*--check-version", content))
    assert not has_early_exit, (
        "start.bat 仍包含 find_weixin.py --check-version 早退块，"
        "需删除（preflight step 6.9 已处理版本守卫+自修）"
    )
