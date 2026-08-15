#!/usr/bin/env bash
# ensure-shizuku-server-lib-smoke.sh — shizuku_server_alive / resolve_shizuku_starter_path 回归测试
#
# 背景：2026-08-15 真机 spike（决策 78bd0467→799ad215→1fe3c420）验证 Shizuku shell 权限级
# input tap 可行，但 shizuku_server 进程重启后消失，须重新用 adb 拉起。范围限定 rog/pc4
# 常驻机队，本测试只覆盖两个可脱离真机单测的纯函数；ensure_shizuku_server 胶水函数调真实
# adb，不在本测试覆盖范围（同目录 dedupe_adb_devices 的胶水调用方也是同理直接写 CI 内联）。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/ensure-shizuku-server.sh"

# 场景1：ps -A 输出含 shizuku_server 一行 → 判定存活
PS_ALIVE=$'u0_a248      25041  1474   17379368 217696 0                   0 S moe.shizuku.privileged.api\nshell        27789     1   15649512 128392 __arm64_sys_epoll_pwait 0 S shizuku_server'
if shizuku_server_alive "$PS_ALIVE"; then
  echo "✅ 场景1通过：ps 输出含 shizuku_server 一行，判定存活"
else
  echo "❌ FAIL 场景1: ps 输出含 shizuku_server 一行，应判定存活，实际判定不存活"
  exit 1
fi

# 场景2：ps -A 输出不含 shizuku_server → 判定不存活
PS_DEAD=$'u0_a248      25041  1474   17379368 217696 0                   0 S moe.shizuku.privileged.api\nroot           1     0    12345   6789 0                   0 S init'
if shizuku_server_alive "$PS_DEAD"; then
  echo "❌ FAIL 场景2: ps 输出不含 shizuku_server，应判定不存活，实际判定存活"
  exit 1
else
  echo "✅ 场景2通过：ps 输出不含 shizuku_server，判定不存活"
fi

# 场景3：pm path 正常单行 base.apk → 正确替换出 libshizuku.so 路径
PM_PATH_SINGLE='package:/data/app/~~wAU6GecpzyvrrGkvNiGGlw==/moe.shizuku.privileged.api-1jayn3pBvt2cwpGOGmRNaA==/base.apk'
RESULT3=$(resolve_shizuku_starter_path "$PM_PATH_SINGLE")
EXPECTED3='/data/app/~~wAU6GecpzyvrrGkvNiGGlw==/moe.shizuku.privileged.api-1jayn3pBvt2cwpGOGmRNaA==/lib/arm64/libshizuku.so'
[ "$RESULT3" = "$EXPECTED3" ] || { printf '❌ FAIL 场景3: 期望:\n%s\n实得:\n%s\n' "$EXPECTED3" "$RESULT3"; exit 1; }
echo "✅ 场景3通过：正常单行 base.apk 正确解析出 libshizuku.so 路径"

# 场景4：pm path 空输入（App 未安装）→ 空输出 + 失败
RESULT4=$(resolve_shizuku_starter_path "" || true)
[ -z "$RESULT4" ] || { echo "❌ FAIL 场景4: 空输入应输出为空，实得: $RESULT4"; exit 1; }
if resolve_shizuku_starter_path "" >/dev/null 2>&1; then
  echo "❌ FAIL 场景4: 空输入应 return 非 0（失败），实际 return 0"
  exit 1
fi
echo "✅ 场景4通过：pm path 空输入正确判定失败（App 未安装）"

# 场景5：pm path 多行（AAB 分包含 split_config apk）→ 仍正确挑出 base.apk 那行
PM_PATH_MULTI=$'package:/data/app/~~AAA111==/moe.shizuku.privileged.api-BBB222==/split_config.arm64_v8a.apk\npackage:/data/app/~~AAA111==/moe.shizuku.privileged.api-BBB222==/base.apk\npackage:/data/app/~~AAA111==/moe.shizuku.privileged.api-BBB222==/split_config.zh.apk'
RESULT5=$(resolve_shizuku_starter_path "$PM_PATH_MULTI")
EXPECTED5='/data/app/~~AAA111==/moe.shizuku.privileged.api-BBB222==/lib/arm64/libshizuku.so'
[ "$RESULT5" = "$EXPECTED5" ] || { printf '❌ FAIL 场景5: 期望:\n%s\n实得:\n%s\n' "$EXPECTED5" "$RESULT5"; exit 1; }
echo "✅ 场景5通过：多行输出（含 split apk）仍正确挑出 base.apk 那行"

echo "🎉 PASS: ensure-shizuku-server 纯函数回归通过"
