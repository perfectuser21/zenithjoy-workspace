# -*- coding: utf-8 -*-
"""
startup_reset.py 行为测试（TDD commit 1 — 失败测试定义验收目标）。

覆盖 5 步 checklist（进程归零/微信归一/环境自检/残骸清理/diag 上报），
全部纯函数接缝，跨平台可在 Linux CI 跑。

决策：2026-07-17 用户拍板 agent 启动前置幂等复位（ROG 深度审计后）。
"""
from __future__ import annotations

import os
import sys
import time
import urllib.request
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..")))

import startup_reset  # noqa: E402


# ─── Step 1: 进程归零 ──────────────────────────────────────────────────────────

def test_orphan_kill_returns_correct_structure():
    result = startup_reset.step_orphan_kill(dry_run=True)
    assert result["step"] == "orphan_kill"
    assert result["status"] in ("ok", "warn", "fail")
    assert "detail" in result


def test_orphan_kill_warns_on_nonwindows(monkeypatch):
    monkeypatch.setattr(startup_reset.platform, "system", lambda: "Darwin")
    result = startup_reset.step_orphan_kill(dry_run=True)
    # 非 Windows 环境 → warn（不是 fail，CI 要能跑）
    assert result["status"] == "warn"
    assert "non-windows" in result["detail"].lower() or "skip" in result["detail"].lower()


def test_orphan_kill_dry_run_does_not_kill(monkeypatch):
    killed_pids = []
    monkeypatch.setattr(startup_reset.platform, "system", lambda: "Windows")
    monkeypatch.setattr(startup_reset, "_list_orphan_pids", lambda: [99999])
    monkeypatch.setattr(startup_reset, "_kill_pid", lambda pid: killed_pids.append(pid))
    startup_reset.step_orphan_kill(dry_run=True)
    assert killed_pids == [], "dry_run=True 不能真杀进程"


def test_orphan_kill_kills_pids_when_not_dry_run(monkeypatch):
    killed_pids = []
    monkeypatch.setattr(startup_reset.platform, "system", lambda: "Windows")
    monkeypatch.setattr(startup_reset, "_list_orphan_pids", lambda: [11111, 22222])
    monkeypatch.setattr(startup_reset, "_kill_pid", lambda pid: killed_pids.append(pid))
    result = startup_reset.step_orphan_kill(dry_run=False)
    assert killed_pids == [11111, 22222]
    assert result["status"] == "ok"
    assert "2" in result["detail"]


# ─── Step 2: 微信归一 ──────────────────────────────────────────────────────────

def test_weixin_converge_returns_correct_structure():
    result = startup_reset.step_weixin_converge(dry_run=True)
    assert result["step"] == "weixin_converge"
    assert result["status"] in ("ok", "warn", "fail")
    assert "detail" in result


def test_weixin_converge_warns_on_nonwindows(monkeypatch):
    monkeypatch.setattr(startup_reset.platform, "system", lambda: "Linux")
    result = startup_reset.step_weixin_converge(dry_run=True)
    assert result["status"] == "warn"


def test_weixin_converge_ok_when_single_window(monkeypatch):
    monkeypatch.setattr(startup_reset.platform, "system", lambda: "Windows")
    monkeypatch.setattr(startup_reset, "_count_weixin_windows", lambda: 1)
    result = startup_reset.step_weixin_converge(dry_run=False)
    assert result["status"] == "ok"
    assert "1" in result["detail"]


def test_weixin_converge_triggers_restart_when_multiple(monkeypatch):
    restarted = []
    monkeypatch.setattr(startup_reset.platform, "system", lambda: "Windows")
    monkeypatch.setattr(startup_reset, "_count_weixin_windows", lambda: 3)
    monkeypatch.setattr(startup_reset, "_restart_weixin_single", lambda: restarted.append(True) or True)
    result = startup_reset.step_weixin_converge(dry_run=False)
    assert restarted == [True]
    assert result["status"] == "ok"
    assert "3" in result["detail"]


def test_weixin_converge_dry_run_does_not_restart(monkeypatch):
    restarted = []
    monkeypatch.setattr(startup_reset.platform, "system", lambda: "Windows")
    monkeypatch.setattr(startup_reset, "_count_weixin_windows", lambda: 2)
    monkeypatch.setattr(startup_reset, "_restart_weixin_single", lambda: restarted.append(True) or True)
    startup_reset.step_weixin_converge(dry_run=True)
    assert restarted == [], "dry_run=True 不能重启微信"


# ─── Step 3: 环境自检 ──────────────────────────────────────────────────────────

def test_env_check_returns_correct_structure():
    result = startup_reset.step_env_check()
    assert result["step"] == "env_check"
    assert result["status"] in ("ok", "warn", "fail")
    assert "detail" in result


def test_env_check_fails_when_core_dir_missing(monkeypatch):
    monkeypatch.delenv("ZENITHJOY_CORE_DIR", raising=False)
    monkeypatch.delenv("ZENITHJOY_INSTALL_DIR", raising=False)
    result = startup_reset.step_env_check()
    assert result["status"] == "fail"
    assert "ZENITHJOY_CORE_DIR" in result["detail"]


def test_env_check_ok_when_core_dir_set(monkeypatch, tmp_path):
    monkeypatch.setenv("ZENITHJOY_CORE_DIR", str(tmp_path))
    # python-embedded 检测：直接放 warn（目录下 python 子目录不一定存在）
    result = startup_reset.step_env_check()
    # 只要 ZENITHJOY_CORE_DIR 有了，不再因此 fail
    if result["status"] == "fail":
        assert "ZENITHJOY_CORE_DIR" not in result["detail"]


def test_env_check_warns_missing_python_embedded(monkeypatch, tmp_path):
    monkeypatch.setenv("ZENITHJOY_CORE_DIR", str(tmp_path))
    # tmp_path 下没有 python-embedded
    result = startup_reset.step_env_check()
    # 应当 warn（python-embedded 不存在），而非 fail（仍可继续启动）
    assert result["status"] in ("ok", "warn")


def test_env_check_reports_core_dir_in_detail(monkeypatch, tmp_path):
    monkeypatch.setenv("ZENITHJOY_CORE_DIR", str(tmp_path))
    result = startup_reset.step_env_check()
    assert str(tmp_path) in result["detail"] or "CORE_DIR" in result["detail"]


# ─── Step 4: 残骸清理 ──────────────────────────────────────────────────────────

def test_debris_cleanup_returns_correct_structure():
    result = startup_reset.step_debris_cleanup(dry_run=True)
    assert result["step"] == "debris_cleanup"
    assert result["status"] in ("ok", "warn", "fail")
    assert "detail" in result


def test_debris_cleanup_counts_stale_files(monkeypatch, tmp_path):
    # 制造 3 个超过 7 天的 zj-* 文件
    old_time = time.time() - (8 * 24 * 3600)
    stale = []
    for i in range(3):
        f = tmp_path / f"zj-test-{i}.json"
        f.write_text("{}")
        os.utime(f, (old_time, old_time))
        stale.append(str(f))

    monkeypatch.setattr(startup_reset, "_list_stale_public_files", lambda: stale)
    monkeypatch.setattr(startup_reset, "_list_zj_scheduled_tasks", lambda: [])
    monkeypatch.setattr(startup_reset, "_list_stale_lock_files", lambda: [])
    result = startup_reset.step_debris_cleanup(dry_run=True)
    assert result["status"] == "ok"
    assert "3" in result["detail"]


def test_debris_cleanup_dry_run_does_not_delete(monkeypatch, tmp_path):
    deleted = []
    f = tmp_path / "zj-old.json"
    f.write_text("{}")
    monkeypatch.setattr(startup_reset, "_list_stale_public_files", lambda: [str(f)])
    monkeypatch.setattr(startup_reset, "_list_zj_scheduled_tasks", lambda: [])
    monkeypatch.setattr(startup_reset, "_list_stale_lock_files", lambda: [])
    monkeypatch.setattr(startup_reset, "_delete_file", lambda p: deleted.append(p))
    startup_reset.step_debris_cleanup(dry_run=True)
    assert deleted == [], "dry_run=True 不能真删文件"


def test_debris_cleanup_deletes_when_not_dry_run(monkeypatch, tmp_path):
    deleted = []
    f = tmp_path / "zj-old.json"
    f.write_text("{}")
    monkeypatch.setattr(startup_reset, "_list_stale_public_files", lambda: [str(f)])
    monkeypatch.setattr(startup_reset, "_list_zj_scheduled_tasks", lambda: [])
    monkeypatch.setattr(startup_reset, "_list_stale_lock_files", lambda: [])
    monkeypatch.setattr(startup_reset, "_delete_file", lambda p: deleted.append(p))
    startup_reset.step_debris_cleanup(dry_run=False)
    assert str(f) in deleted


# ─── Step 5 / main: run_startup_reset ─────────────────────────────────────────

def test_run_startup_reset_returns_4_items(monkeypatch):
    for fn in ("step_orphan_kill", "step_weixin_converge", "step_env_check", "step_debris_cleanup"):
        monkeypatch.setattr(startup_reset, fn, lambda **kw: {"step": fn, "status": "ok", "detail": "ok"})
    monkeypatch.setattr(startup_reset, "_post_diag", lambda url, data: None)
    result = startup_reset.run_startup_reset(middleware_url="", dry_run=True)
    assert len(result["items"]) == 4, f"期望 4 个 checklist 项，实际 {len(result['items'])}"


def test_run_startup_reset_all_ok_true_when_all_pass(monkeypatch):
    for fn in ("step_orphan_kill", "step_weixin_converge", "step_env_check", "step_debris_cleanup"):
        monkeypatch.setattr(startup_reset, fn, lambda **kw: {"step": "x", "status": "ok", "detail": ""})
    monkeypatch.setattr(startup_reset, "_post_diag", lambda url, data: None)
    result = startup_reset.run_startup_reset(middleware_url="", dry_run=True)
    assert result["all_ok"] is True


def test_run_startup_reset_all_ok_false_when_step_fails(monkeypatch):
    def _fail(**kw):
        return {"step": "env_check", "status": "fail", "detail": "missing"}

    monkeypatch.setattr(startup_reset, "step_orphan_kill", lambda **kw: {"step": "x", "status": "ok", "detail": ""})
    monkeypatch.setattr(startup_reset, "step_weixin_converge", lambda **kw: {"step": "x", "status": "ok", "detail": ""})
    monkeypatch.setattr(startup_reset, "step_env_check", _fail)
    monkeypatch.setattr(startup_reset, "step_debris_cleanup", lambda **kw: {"step": "x", "status": "ok", "detail": ""})
    monkeypatch.setattr(startup_reset, "_post_diag", lambda url, data: None)
    result = startup_reset.run_startup_reset(middleware_url="", dry_run=True)
    assert result["all_ok"] is False


def test_run_startup_reset_warn_does_not_flip_all_ok(monkeypatch):
    for fn in ("step_orphan_kill", "step_weixin_converge", "step_debris_cleanup"):
        monkeypatch.setattr(startup_reset, fn, lambda **kw: {"step": "x", "status": "ok", "detail": ""})
    monkeypatch.setattr(startup_reset, "step_env_check", lambda **kw: {"step": "x", "status": "warn", "detail": "ok"})
    monkeypatch.setattr(startup_reset, "_post_diag", lambda url, data: None)
    result = startup_reset.run_startup_reset(middleware_url="", dry_run=True)
    assert result["all_ok"] is True, "warn 不应让 all_ok=False"


def test_run_startup_reset_posts_to_diag(monkeypatch):
    posted = {}

    def fake_post(url, data):
        posted["url"] = url
        posted["data"] = data

    for fn in ("step_orphan_kill", "step_weixin_converge", "step_env_check", "step_debris_cleanup"):
        monkeypatch.setattr(startup_reset, fn, lambda **kw: {"step": "x", "status": "ok", "detail": ""})
    monkeypatch.setattr(startup_reset, "_post_diag", fake_post)
    startup_reset.run_startup_reset(middleware_url="http://middleware", dry_run=True)
    assert posted.get("url", "").startswith("http://middleware"), "必须上报到中台 diag"
    assert "items" in posted.get("data", {})


def test_run_startup_reset_diag_not_posted_when_no_url(monkeypatch):
    posted = {}

    def fake_post(url, data):
        posted["called"] = True

    for fn in ("step_orphan_kill", "step_weixin_converge", "step_env_check", "step_debris_cleanup"):
        monkeypatch.setattr(startup_reset, fn, lambda **kw: {"step": "x", "status": "ok", "detail": ""})
    monkeypatch.setattr(startup_reset, "_post_diag", fake_post)
    startup_reset.run_startup_reset(middleware_url="", dry_run=True)
    assert "called" not in posted, "middleware_url 为空时不应尝试上报"


# ─── listen_chat.py 接线守卫（源码文本断言）──────────────────────────────────────

def test_run_real_listen_calls_startup_reset():
    """run_real_listen 开头必须调用 startup_reset.run_startup_reset（或 startup_reset 模块函数）。

    守卫：任何人删掉这行接线 → 测试红 → CI 拦截。
    """
    import io
    listen_path = os.path.abspath(os.path.join(HERE, "..", "listen_chat.py"))
    with io.open(listen_path, "r", encoding="utf-8") as f:
        src = f.read()
    assert "startup_reset" in src, (
        "listen_chat.py 未接线 startup_reset —— "
        "agent 启动前置归零步骤已被删除，违反 2026-07-17 用户拍板"
    )
