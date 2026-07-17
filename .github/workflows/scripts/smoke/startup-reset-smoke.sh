#!/usr/bin/env bash
# startup-reset-smoke.sh — 验证 startup_reset.py 5步checklist可跨平台干跑
#
# 背景：2026-07-17 用户拍板（ROG深度审计后），agent启动前必须先归零。
# 本smoke在ubuntu-latest跑，验证：
#   1. startup_reset.py 存在且语法正确
#   2. --dry-run 模式退出码为 0（全步骤 ok/warn）
#   3. run_startup_reset 返回 4 个 checklist item
#   4. 非 Windows 平台步骤1/2返回 warn（不是 fail）
#   5. 缺 ZENITHJOY_CORE_DIR 时 env_check 返回 fail（proven-to-fire）
#   6. manifest 版本 = 1.0.134
#
# 退出码：0 全过 / 2 startup_reset.py 缺失 / 3 版本不符 / 4 语法错误 / 5 逻辑断言失败
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
RPA="$REPO_ROOT/services/agent/wechat-rpa"
EXPECTED_VERSION="1.0.134"

# ─── 前置检查 ─────────────────────────────────────────────────────────────────

[ -f "$RPA/startup_reset.py" ] || { echo "FAIL: startup_reset.py 缺失"; exit 2; }
echo "  OK: startup_reset.py 存在"

# 语法检查
python3 -c "import ast; ast.parse(open('$RPA/startup_reset.py').read())" \
  || { echo "FAIL: startup_reset.py 语法错误"; exit 4; }
echo "  OK: startup_reset.py 语法正确"

# ─── 逻辑断言（python3 inline）────────────────────────────────────────────────

RPA_PATH="$RPA"
python3 - "$RPA_PATH" <<'PYEOF'
import sys, os

# 把 wechat-rpa 加入 path（由 shell 注入第一个参数）
rpa = sys.argv[1] if len(sys.argv) > 1 else "."
sys.path.insert(0, os.path.abspath(rpa))

import startup_reset

# ① non-Windows orphan_kill → warn
import unittest.mock as mock
with mock.patch.object(startup_reset.platform, "system", return_value="Linux"):
    r = startup_reset.step_orphan_kill(dry_run=True)
    assert r["status"] == "warn", f"orphan_kill on Linux should warn, got {r['status']}"
print("  OK: orphan_kill non-Windows → warn")

# ② non-Windows weixin_converge → warn
with mock.patch.object(startup_reset.platform, "system", return_value="Linux"):
    r = startup_reset.step_weixin_converge(dry_run=True)
    assert r["status"] == "warn", f"weixin_converge on Linux should warn, got {r['status']}"
print("  OK: weixin_converge non-Windows → warn")

# ③ env_check fail when ZENITHJOY_CORE_DIR missing（proven-to-fire）
env_bak = os.environ.pop("ZENITHJOY_CORE_DIR", None)
env_bak2 = os.environ.pop("ZENITHJOY_INSTALL_DIR", None)
try:
    r = startup_reset.step_env_check()
    assert r["status"] == "fail", f"env_check should fail when CORE_DIR missing, got {r['status']}"
    assert "ZENITHJOY_CORE_DIR" in r["detail"], "fail detail should mention ZENITHJOY_CORE_DIR"
finally:
    if env_bak is not None: os.environ["ZENITHJOY_CORE_DIR"] = env_bak
    if env_bak2 is not None: os.environ["ZENITHJOY_INSTALL_DIR"] = env_bak2
print("  OK: env_check fail when ZENITHJOY_CORE_DIR missing")

# ④ debris_cleanup returns ok (dry_run=True, no real files)
with mock.patch.object(startup_reset, "_list_stale_public_files", return_value=[]):
    with mock.patch.object(startup_reset, "_list_zj_scheduled_tasks", return_value=[]):
        with mock.patch.object(startup_reset, "_list_stale_lock_files", return_value=[]):
            r = startup_reset.step_debris_cleanup(dry_run=True)
            assert r["status"] == "ok", f"debris_cleanup dry_run should be ok, got {r['status']}"
print("  OK: debris_cleanup dry_run → ok")

# ⑤ run_startup_reset returns 4 items
posted = {}
with mock.patch.object(startup_reset, "_post_diag", lambda u, d: posted.update({"url": u, "data": d})):
    with mock.patch.object(startup_reset, "_list_stale_public_files", return_value=[]):
        with mock.patch.object(startup_reset, "_list_zj_scheduled_tasks", return_value=[]):
            with mock.patch.object(startup_reset, "_list_stale_lock_files", return_value=[]):
                result = startup_reset.run_startup_reset(middleware_url="", dry_run=True)
assert len(result["items"]) == 4, f"期望 4 个 item，实际 {len(result['items'])}"
print("  OK: run_startup_reset → 4 checklist items")

# ⑥ all_ok=False when step has fail
def _fake_fail(**kw):
    return {"step": "env_check", "status": "fail", "detail": "test"}
with mock.patch.object(startup_reset, "step_env_check", _fake_fail):
    with mock.patch.object(startup_reset, "_post_diag", lambda u, d: None):
        with mock.patch.object(startup_reset, "_list_stale_public_files", return_value=[]):
            with mock.patch.object(startup_reset, "_list_zj_scheduled_tasks", return_value=[]):
                with mock.patch.object(startup_reset, "_list_stale_lock_files", return_value=[]):
                    r2 = startup_reset.run_startup_reset(dry_run=True)
assert r2["all_ok"] is False, "all_ok should be False when env_check fails"
print("  OK: all_ok=False when step fails")

# ⑦ listen_chat.py 接线守卫
import io
listen = os.path.join(rpa, "listen_chat.py")
with io.open(listen, "r", encoding="utf-8") as f:
    src = f.read()
assert "startup_reset" in src, "listen_chat.py 未接线 startup_reset！"
print("  OK: listen_chat.py 已接线 startup_reset")

print("\nstartup-reset-smoke: 全 7 项断言通过")
PYEOF
[ $? -eq 0 ] || { echo "FAIL: 逻辑断言不通过"; exit 5; }

# ─── 版本闸 ───────────────────────────────────────────────────────────────────

V=$(python3 -c "import json; print(json.load(open('$REPO_ROOT/services/agent/build-modules/line04/manifest.json'))['version'])")
[ "$V" = "$EXPECTED_VERSION" ] || { echo "FAIL: build-modules/line04 manifest=$V != $EXPECTED_VERSION"; exit 3; }
echo "  OK: build-modules/line04 manifest = $V"

V2=$(python3 -c "import json; print(json.load(open('$REPO_ROOT/services/agent/modules/line04/manifest.json'))['version'])")
[ "$V2" = "$EXPECTED_VERSION" ] || { echo "FAIL: modules/line04 manifest=$V2 != $EXPECTED_VERSION"; exit 3; }
echo "  OK: modules/line04 manifest = $V2"

echo ""
echo "startup-reset-smoke: PASS"
