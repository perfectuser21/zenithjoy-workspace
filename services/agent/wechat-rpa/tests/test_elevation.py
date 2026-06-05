"""
preflight.py 提权检测（elevation）单测 —— mac / CI 无微信也能跑通。

真机踩坑：以管理员/"以管理员身份运行"（提权）跑 agent → start.bat 讲述人激活报
`Access is denied`（UIPI 权限隔离）→ UIA 没真激活 → 微信登录了也识别不到。
普通用户身份跑就正常。本测试锁住判定纯逻辑 + dry-run 优雅降级 + 进 report。

只测纯逻辑与 dry-run 结构，不触发任何 Windows-only token 查询的真实分支
（mac 上 _is_windows()=False，check_elevation 直接走 warn 跳过）。
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import preflight  # noqa: E402
from preflight import (  # noqa: E402
    CHECK_NAMES,
    build_report,
    check_elevation,
    classify_elevation,
    run_all_checks,
)

_ALLOWED_STATUS = {"ok", "fixed", "warn", "failed"}


# ---------- classify_elevation（纯函数核心）----------


def test_classify_admin_is_warn():
    """提权 → warn，且提示同时含'管理员'与'普通用户'关键词。"""
    status, detail = classify_elevation(True)
    assert status == "warn"
    assert "管理员" in detail
    assert "普通用户" in detail


def test_classify_non_admin_is_ok():
    """非提权 → ok。"""
    status, detail = classify_elevation(False)
    assert status == "ok"
    assert isinstance(detail, str) and detail


# ---------- check_elevation：dry-run 不抛、结构正确 ----------


def test_check_elevation_dry_run_structure():
    c = check_elevation(dry_run=True)
    assert set(c.keys()) == {"name", "status", "detail"}
    assert c["name"] == "elevation"
    assert c["status"] in _ALLOWED_STATUS
    assert isinstance(c["detail"], str) and c["detail"]


def test_check_elevation_non_windows_is_warn():
    """非 Windows（mac/CI）→ 优雅降级为 warn，不崩。"""
    if sys.platform.startswith("win"):
        import pytest

        pytest.skip("仅在非 Windows 上断言跳过分支")
    c = check_elevation(dry_run=True)
    assert c["status"] == "warn"


# ---------- elevation 进 CHECK_NAMES / report ----------


def test_elevation_in_check_names():
    assert "elevation" in CHECK_NAMES


def test_report_contains_elevation():
    """run_all_checks → build_report 后，checks 含 elevation 这一项。"""
    checks = run_all_checks("http://localhost:9", dry_run=True)
    report = build_report(checks, ts=1)
    names = [c["name"] for c in report["checks"]]
    assert "elevation" in names
    elev = next(c for c in report["checks"] if c["name"] == "elevation")
    assert elev["status"] in _ALLOWED_STATUS


def test_elevation_runs_early_after_os_session():
    """执行序列里 elevation 紧跟 os_session（影响后面 UIA/登录项成败）。"""
    checks = run_all_checks("http://localhost:9", dry_run=True)
    names = [c["name"] for c in checks]
    assert names[0] == "os_session"
    assert names[1] == "elevation"
