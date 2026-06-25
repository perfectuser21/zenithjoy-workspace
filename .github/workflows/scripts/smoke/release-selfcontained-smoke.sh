#!/usr/bin/env bash
# release-selfcontained-smoke.sh
# ════════════════════════════════════════════════════════════════════════════
# 方案 A 自包含 release proven-to-fire（系统级，直接拦 #866 的 node_modules hoist bug）。
#
# #866 漏洞：release 隔离假设 apps/api/node_modules 自包含，但本 repo 是 npm workspaces，
# 依赖 hoist 到根 node_modules，apps/api/node_modules 是空的 → release 目录在 workspace 树外，
# 跑 `node dist/index.js` 报 `Cannot find module 'dotenv'` → :5201/promote 后 :5200 都起不来。
# 单元测试（在 workspace 树内跑）测不出来，必须**真 build 一个 release 并 standalone 起一个进程**。
#
# 本 smoke：build_release 出一个真 release → 在【丢弃端口】standalone 起进程（绝不用 5200/5201）
# → 断言 /health 通（= 依赖能解析、release 自包含可跑）。这就是"系统绿"的证据。
#
# ★ 铁律：只用丢弃端口（默认 5388），绝不碰真生产 :5200 / 真 staging :5201。
#
# 退出码：0 通过；非 0 = release 起不来（自包含 bug 复现）。
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
# shellcheck source=/dev/null
source "${REPO_ROOT}/.github/workflows/scripts/deploy-lib.sh"

PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  方案 A 自包含 release smoke — 真 build + standalone 起进程 + /health"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

NODE_BIN="${ZJ_NODE:-$(command -v node)}"
if [ -z "$NODE_BIN" ]; then echo "❌ 找不到 node 可执行"; exit 1; fi

# sandbox releases 目录（绝不碰真 /Users/administrator/zenithjoy-releases）
SANDBOX="$(mktemp -d)"
export ZJ_RELEASES_DIR="$SANDBOX/releases"
export ZJ_REPO="$REPO_ROOT"
export ZJ_API_DIR="$REPO_ROOT/apps/api"
export ZJ_NODE="$NODE_BIN"
mkdir -p "$ZJ_RELEASES_DIR"

PROC_PID=""
cleanup() {
  [ -n "$PROC_PID" ] && kill "$PROC_PID" 2>/dev/null || true
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

# 用一个稳定的假 sha（内容由当前工作树决定，build_release 幂等）
SHA="smoke-selfcontained-$(date +%s)"

echo "▶ build_release（拷 dist + 实体拷 node_modules，自包含）..."
if ! build_release "$SHA" >/tmp/rel-build.log 2>&1; then
  echo "❌ build_release 失败："; tail -20 /tmp/rel-build.log; exit 1
fi
RELDIR="$(release_dir_for "$ZJ_RELEASES_DIR" "$SHA")"
ok "build_release 完成 → $RELDIR"

# 方案 A 断言：release/node_modules 是真目录、不是软链（自包含、与根解耦）
if [ -L "$RELDIR/node_modules" ]; then
  bad "release node_modules 是软链（方案A 要求实体拷贝）"
else
  ok "release node_modules 是真目录（非 symlink 到根）"
fi
# 哨兵依赖在 release 里
if [ -e "$RELDIR/node_modules/dotenv/package.json" ]; then
  ok "release 自带 dotenv（依赖可解析）"
else
  bad "release 缺 dotenv（依赖没拷进来）"
fi

# ── standalone 起进程（丢弃端口，绝不 5200/5201）──
PORT="${SMOKE_PORT:-5388}"
echo "▶ standalone 起 release 进程于丢弃端口 :${PORT}（绝不碰真 5200/5201）..."
( cd "$RELDIR" || exit 1
  PORT="$PORT" NODE_ENV=staging DATABASE_NAME="${SMOKE_DB:-zenithjoy_test}" \
    "$NODE_BIN" dist/index.js >/tmp/rel-run.log 2>&1 &
  echo $! > "$SANDBOX/proc.pid"
)
PROC_PID="$(cat "$SANDBOX/proc.pid" 2>/dev/null || echo "")"

# 等 /health（最多 ~20s）
UP=0
for _ in $(seq 1 40); do
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then UP=1; break; fi
  # 进程提前死了（依赖解析失败）→ 立即报，不空等
  if [ -n "$PROC_PID" ] && ! kill -0 "$PROC_PID" 2>/dev/null; then break; fi
  sleep 0.5
done

if [ "$UP" -eq 1 ]; then
  ok "standalone release /health 通 → release 自包含可跑（依赖解析成功）"
else
  bad "standalone release 起不来 / /health 不通（自包含 bug 复现）"
  echo "  --- release 进程日志（前 25 行）---"
  head -25 /tmp/rel-run.log 2>/dev/null || true
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  release-selfcontained-smoke: PASS=$PASS FAIL=$FAIL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[ "$FAIL" -eq 0 ]
