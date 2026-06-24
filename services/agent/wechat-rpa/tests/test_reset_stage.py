"""
WS-B RPA 复位台逻辑层单测（UI driver 全 mock，不碰真机）。

PrepPRD（sprints/06242347-zenithjoy-staging-promote/prep-prd.md WS-B）：
xian-rog 升级为「专用 + 可复位 + 禁手工调试」。复位脚本回到黄金态四步：
  ① 关掉残留 app  ② 清会话残留  ③ 校验测试微信号已登录  ④ 校验微信版本在允许范围。
任一步红 → 复位红 → smoke 不跑。

本测全部 mock UI driver（StubDriver），只验逻辑层判定 —— 故可在 mac/CI 跑、proven-to-fire。
对应 CI gate：碰 wechat-rpa 模块的 PR 必须带逻辑单测，否则 CI 红。
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from reset_stage import reset_stage, ResetResult  # noqa: E402


class StubDriver:
    """可注入的 mock UI driver —— 模拟 xian-rog 真机的 4 个副作用动作 + 状态查询。

    测试通过构造不同 StubDriver 来驱动 reset_stage 走不同分支，不碰任何真窗口。
    """

    def __init__(self, *, logged_in=True, version="4.1.8.107",
                 close_ok=True, clear_ok=True, expected_account="测试号_zr"):
        self._logged_in = logged_in
        self._version = version
        self._close_ok = close_ok
        self._clear_ok = clear_ok
        self._expected_account = expected_account
        self.calls = []

    # ① 关残留 app
    def close_running_wechat(self):
        self.calls.append("close")
        return self._close_ok

    # ② 清会话残留
    def clear_session_residue(self):
        self.calls.append("clear")
        return self._clear_ok

    # ③ 校验测试号已登录 + 是不是那个专用测试号
    def get_logged_in_account(self):
        self.calls.append("get_account")
        return self._expected_account if self._logged_in else None

    # ④ 校验微信版本
    def get_wechat_version(self):
        self.calls.append("get_version")
        return self._version


EXPECTED = "测试号_zr"


def _driver(**kw):
    kw.setdefault("expected_account", EXPECTED)
    return StubDriver(**kw)


# ─────────────── happy path ───────────────
def test_reset_all_green_returns_ok():
    d = _driver()
    r = reset_stage(d, expected_account=EXPECTED)
    assert isinstance(r, ResetResult)
    assert r.ok is True, f"四步全绿应 ok=True，实际 {r}"
    # 顺序必须：先关 app → 清会话 → 验登录 → 验版本
    assert d.calls == ["close", "clear", "get_account", "get_version"], d.calls


# ─────────────── ③ 登出 proven-to-fire ───────────────
def test_reset_logged_out_is_red():
    """测试号登出 → 复位红 → smoke 不跑（PrepPRD WS-B proven-to-fire）。"""
    d = _driver(logged_in=False)
    r = reset_stage(d, expected_account=EXPECTED)
    assert r.ok is False, "测试号登出必须复位红"
    assert "logged_in" in r.failed_step or "登录" in r.reason


def test_reset_wrong_account_is_red():
    """登录的是别的号（不是专用测试号）→ 复位红，绝不在错号上发。"""
    d = _driver(logged_in=True, expected_account="别人的号")
    r = reset_stage(d, expected_account=EXPECTED)
    assert r.ok is False, "登录非专用测试号必须复位红"


# ─────────────── ④ 版本校验 proven-to-fire ───────────────
def test_reset_version_too_low_is_red():
    """微信版本 < 4.1.8（控件配方不一致）→ 复位红。"""
    d = _driver(version="4.1.7.99")
    r = reset_stage(d, expected_account=EXPECTED)
    assert r.ok is False, "版本过低必须复位红"
    assert "version" in r.failed_step or "版本" in r.reason


def test_reset_version_in_range_ok():
    """>= 4.1.8（含 4.1.10+，Qt UIA 可用）→ 版本校验过。"""
    for v in ["4.1.8.107", "4.1.10.0", "4.2.0.1"]:
        d = _driver(version=v)
        r = reset_stage(d, expected_account=EXPECTED)
        assert r.ok is True, f"版本 {v} 应放行，实际 {r}"


def test_reset_version_unparseable_is_red():
    """读不到版本（None / 空）→ 复位红（拿不准不放行，宁可红）。"""
    d = _driver(version=None)
    r = reset_stage(d, expected_account=EXPECTED)
    assert r.ok is False, "读不到版本必须复位红"


# ─────────────── ① 关 app 失败 ───────────────
def test_reset_close_fail_is_red():
    d = _driver(close_ok=False)
    r = reset_stage(d, expected_account=EXPECTED)
    assert r.ok is False, "关残留 app 失败必须复位红"
    assert "close" in r.failed_step or "关" in r.reason


# ─────────────── ② 清会话失败 ───────────────
def test_reset_clear_fail_is_red():
    d = _driver(clear_ok=False)
    r = reset_stage(d, expected_account=EXPECTED)
    assert r.ok is False, "清会话残留失败必须复位红"


# ─────────────── 可复现性：连跑两次都回到同一黄金态 ───────────────
def test_reset_idempotent_two_runs():
    """连跑两次，第二次仍把残留洗回黄金态（PrepPRD WS-B 验收：可复现）。"""
    d = _driver()
    r1 = reset_stage(d, expected_account=EXPECTED)
    r2 = reset_stage(d, expected_account=EXPECTED)
    assert r1.ok and r2.ok
    # 两次都走全 4 步（每次都真复位，不靠"上次干净了就跳过"）
    assert d.calls.count("close") == 2
    assert d.calls.count("clear") == 2
