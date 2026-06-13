"""
test_preflight_oneclick.py — Agent 一键安装加固回归测试。

验证 4 个修复点：
  1. check_uia_narrator: Narrator.exe 不存在 → failed（非 dry_run 且 is_windows 时）
  2. check_uia_narrator: subprocess 抛异常 → failed（非 dry_run 且 is_windows 时）
  3. check_uia_narrator: subprocess 成功但无主窗口 → warn（兼容"微信未登录"场景）
  4. start.bat 包含 install-autostart.ps1 调用
  5. start.bat 不再包含早退的版本守卫块

跨平台纪律：所有 Windows-only 路径用 monkeypatch/mock 模拟。
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

NARRATOR_PATH = r"C:\Windows\System32\Narrator.exe"


# ──────────────────────────────────────────────────────────────────────────────
# 测试 1：Narrator.exe 不存在 → failed（Windows 真机路径）
# ──────────────────────────────────────────────────────────────────────────────

def test_narrator_exe_missing_returns_failed(monkeypatch):
    """Narrator.exe 不存在时（LTSC/N 精简版）→ status=failed，并给出明确提示。"""
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    orig_isfile = os.path.isfile

    def fake_isfile(path):
        if str(path) == NARRATOR_PATH:
            return False
        return orig_isfile(path)

    monkeypatch.setattr(os.path, "isfile", fake_isfile)

    result = check_uia_narrator(dry_run=False)
    assert result["status"] == "failed", (
        f"期望 failed，实际 {result['status']!r}。detail: {result['detail']}"
    )
    assert "Narrator" in result["detail"], "错误提示应包含 Narrator"


# ──────────────────────────────────────────────────────────────────────────────
# 测试 2：subprocess 启动 Narrator 抛异常 → failed（Windows 真机路径）
# ──────────────────────────────────────────────────────────────────────────────

def test_narrator_subprocess_exception_returns_failed(monkeypatch):
    """Narrator.exe 存在但 subprocess 启动失败 → status=failed，并给修复指引。"""
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    orig_isfile = os.path.isfile

    def fake_isfile(path):
        if str(path) == NARRATOR_PATH:
            return True
        return orig_isfile(path)

    monkeypatch.setattr(os.path, "isfile", fake_isfile)

    import subprocess as _subprocess

    def fake_run(cmd, **kwargs):
        if "Narrator" in " ".join(str(c) for c in cmd):
            raise RuntimeError("进程启动失败：组策略禁用了讲述人")
        return MagicMock(returncode=0)

    monkeypatch.setattr(_subprocess, "run", fake_run)
    import time as _time
    monkeypatch.setattr(_time, "sleep", lambda _: None)

    result = check_uia_narrator(dry_run=False)
    assert result["status"] == "failed", (
        f"期望 failed，实际 {result['status']!r}。detail: {result['detail']}"
    )
    detail_lower = result["detail"].lower()
    assert any(kw in detail_lower for kw in ("管理员", "组策略", "完整", "narrator")), (
        f"detail 缺少修复指引：{result['detail']}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 测试 3：subprocess 成功但无主窗口 → warn（微信未登录兼容场景）
# ──────────────────────────────────────────────────────────────────────────────

def test_narrator_subprocess_ok_no_window_returns_warn(monkeypatch):
    """Narrator 激活成功，但微信未登录时暂无主窗口 → status=warn（不阻断，登录后生效）。"""
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    orig_isfile = os.path.isfile

    def fake_isfile(path):
        if str(path) == NARRATOR_PATH:
            return True
        return orig_isfile(path)

    monkeypatch.setattr(os.path, "isfile", fake_isfile)

    import subprocess as _subprocess
    monkeypatch.setattr(_subprocess, "run", lambda *a, **kw: MagicMock(returncode=0))
    import time as _time
    monkeypatch.setattr(_time, "sleep", lambda _: None)

    import find_weixin as _fw
    monkeypatch.setattr(_fw, "get_main_window", lambda: None)

    result = check_uia_narrator(dry_run=False)
    assert result["status"] == "warn", (
        f"期望 warn（微信未登录，登录后生效），实际 {result['status']!r}。detail: {result['detail']}"
    )


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
