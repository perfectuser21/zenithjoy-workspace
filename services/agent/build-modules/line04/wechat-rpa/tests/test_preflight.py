"""
preflight.py 单测 —— CI 无微信 / mac 也能跑通。

只测「判定/汇总纯逻辑」与「--dry-run 不执行真实自愈」：
  - decide_wechat_action(version_tuple) → 'ok' / 'install' / 'downgrade'
  - report 汇总（all_ok 计算、status 归类、exit code）
  - --dry-run 跑一次 main：产出 report 结构正确、不抛、不执行真实自愈
    （mac 上 windll 不可用要优雅降级为 warn/failed，不崩）。

真实自愈动作（download/uninstall/install/讲述人/防火墙）全在函数体内 +
try/except，本测试不触发它们（dry_run=True + 非 Windows 双保险）。
"""
from __future__ import annotations

import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import preflight  # noqa: E402
from preflight import (  # noqa: E402
    CHECK_NAMES,
    build_report,
    compute_all_ok,
    compute_exit_code,
    decide_wechat_action,
    has_failed,
    make_check,
    run_all_checks,
    status_counts,
)


# ---------- decide_wechat_action（纯函数核心）----------


def test_decide_install_when_none():
    """读不到 / 未安装（None）→ install。"""
    assert decide_wechat_action(None) == "install"


def test_decide_ok_only_for_4_1_8_x():
    """只有 4.1.8.x → ok（已验证可用基线，高于低于都不行）。"""
    assert decide_wechat_action((4, 1, 8, 107)) == "ok"
    assert decide_wechat_action((4, 1, 8)) == "ok"
    assert decide_wechat_action((4, 1, 8, 0)) == "ok"
    assert decide_wechat_action((4, 1, 8, 999)) == "ok"


def test_decide_downgrade_for_below_4_1_8():
    """【必须是 4.1.8 不是小】4.0.0 ~ 4.1.7.x 低于基线 → 不是 ok，必须替换成 4.1.8。

    回归守卫：曾经把 [4.0.0, 4.1.8) 漏判成 'ok'（只卡 >=4.1.9 上界，下界只卡到
    4.0.0），导致 4.1.7 机器 preflight 说"可用别动"，但 RPA 时 find_weixin 的
    assert_supported_version 又抛 RuntimeError（< 4.1.8 控件配方不一致）。两守卫自相矛盾。
    """
    assert decide_wechat_action((4, 0, 5, 20)) == "downgrade"
    assert decide_wechat_action((4, 1, 0)) == "downgrade"
    assert decide_wechat_action((4, 1, 7, 999)) == "downgrade"
    assert decide_wechat_action((4, 0, 0)) == "downgrade"


def test_decide_install_for_3_x():
    """3.x 旧版 → install（无 mmui::MainWindow，需安装 4.1.8）。"""
    assert decide_wechat_action((3, 9, 12, 51)) == "install"
    assert decide_wechat_action((3, 0, 0, 0)) == "install"


def test_decide_downgrade_for_4_1_9_and_above():
    """>=4.1.9 → downgrade（无障碍控件树被砍）。"""
    assert decide_wechat_action((4, 1, 9, 57)) == "downgrade"
    assert decide_wechat_action((4, 1, 10, 27)) == "downgrade"
    assert decide_wechat_action((5, 0, 0, 0)) == "downgrade"


def test_decide_handles_short_tuple():
    """不足 3 段的版本元组也能判定（补 0）。"""
    assert decide_wechat_action((4, 1, 8)) == "ok"
    assert decide_wechat_action((4, 1)) == "downgrade"  # (4,1,0) < 4.1.8
    assert decide_wechat_action((4,)) == "downgrade"    # (4,0,0) < 4.1.8
    assert decide_wechat_action((5,)) == "downgrade"    # (5,0,0) >= 4.1.9


# ---------- 报告汇总（all_ok / counts / exit code）----------


def _mk(*statuses):
    return [make_check(CHECK_NAMES[i % len(CHECK_NAMES)], s, f"d{i}") for i, s in enumerate(statuses)]


def test_make_check_rejects_bad_status():
    with pytest.raises(ValueError):
        make_check("x", "bogus", "d")


def test_all_ok_true_when_only_ok_and_fixed():
    checks = _mk("ok", "fixed", "ok")
    assert compute_all_ok(checks) is True
    assert has_failed(checks) is False
    assert compute_exit_code(checks) == 0


def test_all_ok_false_when_warn_present_but_exit_still_zero():
    """仅有 warn（无 failed）→ all_ok=False，但退出码仍 0。"""
    checks = _mk("ok", "warn", "fixed")
    assert compute_all_ok(checks) is False
    assert has_failed(checks) is False
    assert compute_exit_code(checks) == 0


def test_failed_makes_exit_nonzero():
    checks = _mk("ok", "failed", "warn")
    assert compute_all_ok(checks) is False
    assert has_failed(checks) is True
    assert compute_exit_code(checks) == 1


def test_status_counts():
    counts = status_counts(_mk("ok", "ok", "fixed", "warn", "failed"))
    assert counts == {"ok": 2, "fixed": 1, "warn": 1, "failed": 1}


def test_build_report_structure():
    checks = _mk("ok", "warn")
    report = build_report(checks, ts=123)
    assert report["ts"] == 123
    assert report["all_ok"] is False
    assert report["counts"]["ok"] == 1
    assert report["checks"] == checks


# ---------- run_all_checks：dry-run 产出全部项、结构正确、不抛 ----------


def test_run_all_checks_dry_run_structure():
    checks = run_all_checks("http://localhost:9", dry_run=True)
    assert len(checks) == len(CHECK_NAMES) == 9
    names = [c["name"] for c in checks]
    # 执行序列与 CHECK_NAMES 元组顺序不同（elevation 执行序排第 2，元组里追加在末尾），
    # 故按集合比对覆盖完整 + 显式确认 elevation 在列。
    assert set(names) == set(CHECK_NAMES)
    assert "elevation" in names
    for c in checks:
        assert set(c.keys()) == {"name", "status", "detail"}
        assert c["status"] in {"ok", "fixed", "warn", "failed"}
        assert isinstance(c["detail"], str) and c["detail"]


def test_run_all_checks_dry_run_no_fixed_on_mac():
    """dry-run + 非 Windows：绝不应出现 fixed（没有真执行任何自愈动作）。"""
    if sys.platform.startswith("win"):
        pytest.skip("仅在非 Windows 上断言无自愈")
    checks = run_all_checks("http://localhost:9", dry_run=True)
    assert all(c["status"] != "fixed" for c in checks)


# ---------- main --dry-run：跑通、写 JSON、退出码合理、不崩 ----------


def test_main_dry_run_smoke(tmp_path, monkeypatch, capsys):
    """--dry-run 跑一次 main：不抛、写出结构正确的 report JSON、退出码 0/1。"""
    out_json = tmp_path / "zj-preflight.json"
    monkeypatch.setattr(preflight, "PREFLIGHT_JSON_PATH", str(out_json))

    # 防御：即便测试环境意外可联网/可装微信，dry-run 也不该触发真实自愈；
    # 再把下载函数 stub 成抛错，确保一旦被误调立刻可见（不应被调用）。
    def _boom(*a, **k):
        raise AssertionError("dry-run 不应下载安装包")

    monkeypatch.setattr(preflight, "download_wechat_installer", _boom)

    rc = preflight.main(["--dry-run", "--middleware-url", "http://localhost:9"])
    assert rc in (0, 1)

    assert out_json.exists()
    report = json.loads(out_json.read_text(encoding="utf-8"))
    assert "ts" in report and "all_ok" in report and "checks" in report
    assert len(report["checks"]) == 9
    assert isinstance(report["all_ok"], bool)

    captured = capsys.readouterr()
    assert "preflight" in captured.out.lower()


def test_main_dry_run_no_middleware(tmp_path, monkeypatch):
    """不给 middleware-url 也能跑（中台连通项降级 warn），不抛。"""
    out_json = tmp_path / "zj-preflight.json"
    monkeypatch.setattr(preflight, "PREFLIGHT_JSON_PATH", str(out_json))
    monkeypatch.delenv("ZENITHJOY_API_BASE", raising=False)

    rc = preflight.main(["--dry-run"])
    assert rc in (0, 1)
    assert out_json.exists()


# ── 回归测试：WeChat 安装必须用 PowerShell RunAs 触发 UAC，而非直接 subprocess.run ──
# 根因：subprocess.run([installer, "/S"]) 在普通用户下 OSError: [WinError 740]，
#   且错误提示"以管理员身份运行 start.bat"破坏 UIA（UIA 需普通用户身份）。
# 修法：check_wechat_installed/_run_elevated 改用 PowerShell Start-Process -Verb RunAs -Wait。
def test_wechat_install_uses_runas(monkeypatch, tmp_path):
    """_run_elevated 必须通过 PowerShell Start-Process -Verb RunAs 调用安装器（不直接 subprocess.run）。

    测试 preflight._run_elevated 存在且调用 PowerShell 的 RunAs 路径。
    """
    import subprocess

    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        class R:
            returncode = 0
            stdout = b""
            stderr = b""
        return R()

    monkeypatch.setattr(subprocess, "run", fake_run)

    # _run_elevated 函数必须存在（未实现时 AttributeError → 测试失败）
    assert hasattr(preflight, "_run_elevated"), (
        "preflight._run_elevated 不存在 — 需实现该函数替代 _run_silent 进行 UAC 提权安装"
    )

    preflight._run_elevated(["WeChatWin_4.1.8.exe", "/S"])

    assert len(calls) > 0, "_run_elevated 没有调用任何外部命令"
    combined = " ".join(str(c) for c in calls)
    assert "powershell" in combined.lower(), (
        f"_run_elevated 应调用 powershell，实际调用: {calls}"
    )
    assert "RunAs" in combined, (
        f"_run_elevated 应使用 -Verb RunAs，实际调用: {calls}"
    )
