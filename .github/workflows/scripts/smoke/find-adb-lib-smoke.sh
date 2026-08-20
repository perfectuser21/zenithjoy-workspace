#!/usr/bin/env bash
# find-adb-lib-smoke.sh — find_adb 回归测试
#
# 背景（2026-08-20 确诊）：nightly-android-fleet-pc4 连红三晚（08-17/18/19），
# 第一步「发现设备」就挂，日志只有两行：
#     使用 ADB=C:/platform-tools/adb.exe
#     C:/platform-tools/adb.exe: No such file or directory
#     ##[error]Process completed with exit code 127
#
# 根因两层：
#   ① 写法是 `ADB=$(command -v adb || echo "C:/platform-tools/adb.exe")`——
#      找不到就**拿一个写死的路径当结果返回**，调用方毫不知情地去执行它，exit 127。
#   ② pc4 runner 离线，job 落到同样带 android-capable 标签的 rog 上跑，
#      而 rog 的 adb 在 scrcpy 的 WinGet 目录里；且 runner 是服务进程，
#      它的 PATH 与交互式 SSH 不同，`command -v adb` 在 runner 里找不到。
#
# 于是「每天早上知道机队哪台不能用」这条线瞎了三天，而且瞎着的时候没人知道。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/find-adb.sh"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mk_exec() { printf '#!/bin/sh\nexit 0\n' > "$1"; chmod +x "$1"; }

# 场景1：按候选顺序返回第一个「存在且可执行」的
mk_exec "$TMP/adb_a"; mk_exec "$TMP/adb_b"
RESULT=$(FIND_ADB_CANDIDATES=$"$TMP/adb_a\n$TMP/adb_b" find_adb)
[ "$RESULT" = "$TMP/adb_a" ] || { echo "❌ FAIL 场景1: 期望 $TMP/adb_a，实得 $RESULT"; exit 1; }
echo "✅ 场景1通过：返回第一个可用候选"

# 场景2：跳过不存在的候选（这正是 C:/platform-tools/adb.exe 那种情况）
RESULT=$(FIND_ADB_CANDIDATES=$"$TMP/nope\n$TMP/adb_b" find_adb)
[ "$RESULT" = "$TMP/adb_b" ] || { echo "❌ FAIL 场景2: 期望跳过不存在的，实得 $RESULT"; exit 1; }
echo "✅ 场景2通过：不存在的候选被跳过，不会被当结果返回"

# 场景3：存在但不可执行 → 也要跳过
touch "$TMP/adb_noexec"
RESULT=$(FIND_ADB_CANDIDATES=$"$TMP/adb_noexec\n$TMP/adb_b" find_adb)
[ "$RESULT" = "$TMP/adb_b" ] || { echo "❌ FAIL 场景3: 存在但不可执行的应跳过，实得 $RESULT"; exit 1; }
echo "✅ 场景3通过：存在但不可执行的候选被跳过"

# 场景4（核心）：一个都找不到 → 非零退出 + stdout 必须为空
#   旧写法在这里会吐出一个写死路径，调用方拿去执行 → exit 127，日志里看不出为什么。
set +e
STDOUT=$(FIND_ADB_CANDIDATES=$"$TMP/nope1\n$TMP/nope2" find_adb 2>"$TMP/err"); RC=$?
set -e
[ "$RC" -ne 0 ] || { echo "❌ FAIL 场景4: 全找不到时必须非零退出"; exit 1; }
[ -z "$STDOUT" ] || { echo "❌ FAIL 场景4: 全找不到时 stdout 必须为空，实得「${STDOUT}」——吐出路径会被调用方拿去执行"; exit 1; }
echo "✅ 场景4通过：找不到时非零退出且不吐假路径"

# 场景5：失败信息必须列出找过哪些位置（否则又变成 exit 127 那种查不出原因的红）
grep -q "$TMP/nope1" "$TMP/err" && grep -q "$TMP/nope2" "$TMP/err" \
  || { echo "❌ FAIL 场景5: 失败信息必须列出所有找过的位置，实得:"; cat "$TMP/err"; exit 1; }
echo "✅ 场景5通过：失败时明确列出找过的位置"

echo "PASS find-adb-lib-smoke —— 5 个场景全过"

# ── 机械闸：全仓不许再出现「写死 adb 路径当兜底」的写法 ────────────────────
# 五处复制同一个 bug 的教训（agent 身份反查那次）说明：修好现有的不难，
# 难的是下次有人再写一遍。lib 自己持有候选清单是合法的（它会验 -x）。
#
# ⚠️ 这个闸门第一版自己就是摆设：REPO_ROOT 少算一层，扫的是不存在的 .github/.github，
# 永远扫不到东西；而当时的自测只验了正则、没验扫描路径。所以下面的自测**必须
# 连路径一起验**——造一个带坏写法的临时目录，跑同一个扫描函数，要求它真抓到。
BAD_PATTERN='command -v adb[^|]*\|\|[[:space:]]*echo'
scan_offenders() {  # $1 = 要扫的根目录
  grep -rlE "$BAD_PATTERN" "$1" 2>/dev/null | grep -vE 'lib/find-adb\.sh|find-adb-lib-smoke\.sh' || true   # lib 持有候选清单合法；smoke 自己含坏样例 fixture
}

# smoke 在 .github/workflows/scripts/smoke/ 下 → 上溯 4 层才是仓库根
REPO_ROOT="$(cd "$DIR/../../../.." && pwd)"
[ -d "$REPO_ROOT/.github/workflows" ] \
  || { echo "❌ FAIL 机械闸：REPO_ROOT 算错了（$REPO_ROOT 下没有 .github/workflows）——闸门会扫空目录变成摆设"; exit 1; }

# 自测（连路径一起验）：造一个坏样例，同一个扫描函数必须抓到
FAKE="$TMP/fakerepo/.github/workflows"; mkdir -p "$FAKE"
printf 'run: |\n  ADB=$(command -v adb 2>/dev/null || echo "C:/platform-tools/adb.exe")\n' > "$FAKE/bad.yml"
[ -n "$(scan_offenders "$TMP/fakerepo/.github")" ] \
  || { echo "❌ FAIL 自测：扫描抓不到坏样例，守卫是摆设"; exit 1; }
echo "✅ 自测通过：同一个扫描函数确实能抓到坏写法（含路径）"

OFFENDERS=$(scan_offenders "$REPO_ROOT/.github")
if [ -n "$OFFENDERS" ]; then
  echo "❌ FAIL 机械闸：下列文件仍在用「找不到 adb 就 echo 一个写死路径」的写法——"
  echo "   调用方会拿不存在的文件去执行，报 exit 127 且看不出原因（0817-0819 连红三晚）："
  printf '   - %s\n' $OFFENDERS
  echo "   改用 find_adb（source lib/find-adb.sh）"
  exit 1
fi
echo "✅ 机械闸通过：无人再写死 adb 兜底路径"
