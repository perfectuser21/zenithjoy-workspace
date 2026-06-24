#!/usr/bin/env bash
# wechat-update-lock-smoke.sh — 强版"关死微信自动更新"模块 smoke（纯逻辑真链路，无需 Windows/真机）。
#
# 背景：#853 删弱锁（实测锁不住，漏了 AppData xwechat 活更新器 + 路径写死）。本模块重建强版。
# 验收（真跑 python wechat_update_lock 的纯函数，断言关键不变量）：
#   1. updater_search_roots 必须同时含 install-dir + AppData xwechat WeixinUpdate（漏网通道）
#   2. install_dir=None 时仍返回 AppData 搜索根（不因没定位到安装目录就整跳过）
#   3. hosts 块带 ZJ-WeChat-Lock 标记 + 4 个更新域名，幂等 upsert 不重复、可 remove 还原
#   4. interpret_lock_verify 诚实判定（残留更新器 → locked=False，不假装锁死）
#   5. 三版本面一致：modules/build-modules manifest + 中台 required_version == EXPECTED
#
# 退出码：0 全过 / 2 纯逻辑断言 / 3 版本面不一致 / 6 缺依赖
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
EXPECTED="1.0.60"
RPA_DIR="$REPO_ROOT/services/agent/wechat-rpa"
echo "wechat-update-lock-smoke: 期望 line04=$EXPECTED (repo=$REPO_ROOT)"

command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }
command -v node    >/dev/null 2>&1 || { echo "FAIL: 缺 node"; exit 6; }

# ── 1-4：真跑模块纯函数断言 ──
python3 - "$RPA_DIR" <<'PY' || { echo "FAIL: 纯逻辑断言不通过"; exit 2; }
import sys, os
sys.path.insert(0, sys.argv[1])
import wechat_update_lock as wul

# 1. 搜索根含 install-dir + AppData xwechat（漏网通道）
roots = wul.updater_search_roots(install_dir=r"C:\Program Files\Tencent\Weixin",
                                 appdata=r"C:\Users\u\AppData\Roaming")
j = " | ".join(roots).lower()
assert "xwechat" in j and "weixinupdate" in j, f"搜索根缺 AppData xwechat WeixinUpdate: {roots}"
assert any("program files" in r.lower() for r in roots), "搜索根缺 install-dir"

# 2. install_dir=None 仍搜 AppData
r2 = wul.updater_search_roots(install_dir=None, appdata=r"C:\Users\u\AppData\Roaming")
assert any("xwechat" in r.lower() for r in r2), f"install_dir 缺失仍须搜 AppData: {r2}"

# 3. hosts 块标记 + 域名 + 幂等 + 还原
block = wul.build_hosts_block()
assert "ZJ-WeChat-Lock" in block
for d in ("dldir1v6.qq.com","dldir1.qq.com","dldir6.qq.com","update.weixin.qq.com"):
    assert d in block, f"hosts 块缺 {d}"
user = "10.0.0.1   my-host\n"
once = wul.upsert_hosts_block(user); twice = wul.upsert_hosts_block(once)
assert twice.count(wul.HOSTS_MARKER_BEGIN) == 1, "幂等失败：ZJ 块重复"
assert "my-host" in twice, "用户行丢失"
removed = wul.remove_hosts_block(twice)
assert wul.HOSTS_MARKER_BEGIN not in removed and "my-host" in removed, "还原失败"

# 4. verify 诚实：残留更新器 → locked=False
ok = wul.interpret_lock_verify([], [], hosts_blocked=True, autoupdate_regval=0)
assert ok["locked"] is True, "全锁应 locked=True"
bad = wul.interpret_lock_verify([r"C:\...\WeixinUpdate.exe"], [], hosts_blocked=True, autoupdate_regval=0)
assert bad["locked"] is False, "残留更新器应 locked=False（不假装锁死）"
print("  OK: 纯逻辑 1-4 全过（含 AppData 漏网通道 + 诚实 verify）")
PY

# ── 5：三版本面一致 ──
MOD_MANIFEST="$REPO_ROOT/services/agent/modules/line04/manifest.json"
V1=$(node -e "process.stdout.write(require('$MOD_MANIFEST').version)")
[ "$V1" = "$EXPECTED" ] || { echo "FAIL: modules/line04 manifest=$V1 != $EXPECTED"; exit 3; }
echo "  OK: modules/line04 manifest = $V1"

BUILD_MANIFEST="$REPO_ROOT/services/agent/build-modules/line04/manifest.json"
V2=$(node -e "process.stdout.write(require('$BUILD_MANIFEST').version)")
[ "$V2" = "$EXPECTED" ] || { echo "FAIL: build-modules/line04 manifest=$V2 != $EXPECTED"; exit 3; }
echo "  OK: build-modules/line04 manifest = $V2"

SVC="$REPO_ROOT/apps/api/src/services/walking-skeleton.service.ts"
grep -qE "'line04-wechat-cs': \{ status: 'active', required_version: '$EXPECTED' \}" "$SVC" \
  || { echo "FAIL: walking-skeleton.service.ts line04 required_version != $EXPECTED"; exit 3; }
echo "  OK: HEARTBEAT_MODULES line04 required_version = $EXPECTED"

# ── 6：新模块真打进 build-modules ──
[ -f "$REPO_ROOT/services/agent/build-modules/line04/wechat-rpa/wechat_update_lock.py" ] \
  || { echo "FAIL: 新模块未打进 build-modules"; exit 3; }
echo "  OK: wechat_update_lock.py 已打进 build-modules"

echo "wechat-update-lock-smoke: PASS"
