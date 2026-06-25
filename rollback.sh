#!/usr/bin/env bash
# rollback.sh — ZenithJoy 生产人工回滚统一入口（API + Dashboard 两条路径）。
#
# 拓扑（按 repo 真相，别抄旧拓扑）：
#   · API 生产      = mmv:5200（跑 Claude 这台美国 Mac mini 本机，连生产 cecelia 库）。
#                     生产 launchd 从 $ZJ_RELEASES_DIR/current 软链跑。
#   · Dashboard 生产 = HK VPS autopilot.zenjoymedia.media，docker 容器 bind-mount
#                     /opt/zenithjoy/autopilot-dashboard/dist（软链 → releases/current → releases/<sha>）。
#
# 为什么需要本脚本（真正补的缺口）：
#   现有 deploy-lib.sh 的 staging_rollback 只在 blue_green_deploy 内部、promote 失败时被【自动】调用，
#   且回退目标来自实时读取。生产【已切完、过段时间才发现要回退】时没有人手点的命令，也没有"上一个 release
#   是谁 / 指定 sha 在不在留存5份里"的判定。本脚本补这个，API/Dashboard 各一条路径。
#
# 用法：
#   # —— API（默认；不带 api/dashboard 关键字时按 API 处理，向后兼容 rollback-prod.yml）——
#   ./rollback.sh                  无参 → 退到 current 的上一个留存 release（previous_release）
#   ./rollback.sh <sha>            带 sha → 从留存里挑（不在留存内报错退出）
#   ./rollback.sh --list           只列 API 留存 release（不动生产）
#   ./rollback.sh api [<sha>|--list]   显式 API 路径（同上）
#
#   # —— Dashboard（HK，只切软链；docker restart + 公网验证由调用方/workflow 做）——
#   ./rollback.sh dashboard          无参 → 退到 dashboard releases/current 的上一个
#   ./rollback.sh dashboard <sha>    带 sha → 从 dashboard 留存里挑（不在留存内报错退出）
#   ./rollback.sh dashboard --list   只列 dashboard 留存 release（不动任何东西）
#
# 复用现有原语，不重写：API 调 staging_rollback；Dashboard 调 dashboard_release_rollback
# （二者底层都是 atomic_repoint_current + previous_release/list_releases）。本脚本只做"挑哪个 + 安全校验"。
#
# 安全：会真切生产软链/重启，只应在对应部署机（API=mmv / Dashboard=HK）上人工执行。
# CI/单测绝不跑本脚本主流程，只单测被复用的纯函数（见 deploy-lib.test.sh Case P/Q/R/S）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="${ZJ_DEPLOY_LIB:-$SCRIPT_DIR/.github/workflows/scripts/deploy-lib.sh}"

if [ ! -f "$LIB" ]; then
  echo "❌ 找不到 deploy-lib.sh（${LIB}），无法回滚" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$LIB"

# ── 路径分发：第一个参数是 api/dashboard 关键字时切路径，否则按 API（向后兼容）──
MODE="api"
case "${1:-}" in
  api)       MODE="api"; shift ;;
  dashboard) MODE="dashboard"; shift ;;
esac

# ── 通用：在 <releases_root> 上做"挑哪个 + 校验"，把选定 sha 打到 stdout（最后一行），
#    报错/无可回退返非 0。--list 直接列出后以特殊返回 200 表示"已处理，无需回滚"。
_select_target() {
  local relroot="$1" arg="${2:-}"
  local cur; cur="$(current_release_sha "$relroot" || true)"
  if [ "$arg" = "--list" ] || [ "$arg" = "-l" ]; then
    echo "留存 release（新→旧，releases_dir=${relroot}）：" >&2
    local any=0 r
    while IFS= read -r r; do
      [ -z "$r" ] && continue
      any=1
      if [ "$r" = "$cur" ]; then echo "  * $r   ← current（当前生产）" >&2; else echo "    $r" >&2; fi
    done <<< "$(list_releases "$relroot")"
    [ "$any" -eq 1 ] || echo "  （无留存 release——$relroot 为空或不存在）" >&2
    return 200
  fi
  local target="$arg"
  if [ -z "$target" ]; then
    target="$(previous_release "$relroot" || true)"
    if [ -z "$target" ]; then
      echo "❌ 取不到上一个可回退的 release（current=${cur:-<无>}，没有更旧的留存版本）。" >&2
      echo "   用 --list 看留存清单，或显式指定 <sha>。" >&2
      return 1
    fi
    echo "无参回滚：current=${cur:-<无>} → 上一个 release=${target}" >&2
  else
    if [ ! -d "$(release_dir_for "$relroot" "$target")" ]; then
      echo "❌ 指定的 sha=${target} 不在留存 release 里（$relroot 下无此目录）。" >&2
      echo "   用 --list 看可回退的留存清单。" >&2
      return 1
    fi
    if [ "$target" = "$cur" ]; then
      echo "⚠️  指定的 sha=${target} 就是当前 current，无需回滚。" >&2
      return 1
    fi
    echo "指定回滚：current=${cur:-<无>} → 留存 release=${target}" >&2
  fi
  echo "$target"   # stdout 只有选定 sha
  return 0
}

if [ "$MODE" = "dashboard" ]; then
  # Dashboard（HK）：releases root = <DASH_DIR>/releases；DASH_DIR 可被环境/测试覆盖。
  DASH_DIR="${ZJ_DASHBOARD_DIR:-/opt/zenithjoy/autopilot-dashboard}"
  RELROOT="${DASH_DIR}/releases"
  set +e
  TARGET="$(_select_target "$RELROOT" "${1:-}")"; SEL_RC=$?
  set -e 2>/dev/null || true
  [ "$SEL_RC" -eq 200 ] && exit 0   # --list 已处理
  [ "$SEL_RC" -ne 0 ] && exit 1
  echo "════════ 即将回滚 Dashboard（${DASH_DIR}）→ ${TARGET} ════════"
  # 只切软链（dashboard_release_rollback：原子重指 releases/current + 兜底 dist 软链）。
  dashboard_release_rollback "$DASH_DIR" "$TARGET"
  echo "⚠️  软链已切。容器需重解析挂载才生效：docker restart autopilot-dashboard（由 workflow/调用方执行）。"
  exit 0
fi

# ── API（mmv:5200）──
REPO="${ZJ_REPO:-$SCRIPT_DIR}"
export ZJ_REPO="$REPO"
export ZJ_API_DIR="${ZJ_API_DIR:-$REPO/apps/api}"
export ZJ_PROD_PORT="${ZJ_PROD_PORT:-5200}"
export ZJ_PROD_DB="${ZJ_PROD_DB:-cecelia}"
export ZJ_PROD_LABEL="${ZJ_PROD_LABEL:-com.zenithjoy.api}"
export ZJ_PROD_PLIST="${ZJ_PROD_PLIST:-$HOME/Library/LaunchAgents/com.zenithjoy.api.plist}"
export ZJ_NODE="${ZJ_NODE:-/opt/homebrew/bin/node}"
export ZJ_RELEASES_DIR="${ZJ_RELEASES_DIR:-$HOME/zenithjoy-releases}"
RELROOT="$ZJ_RELEASES_DIR"

set +e
TARGET="$(_select_target "$RELROOT" "${1:-}")"; SEL_RC=$?
set -e 2>/dev/null || true
[ "$SEL_RC" -eq 200 ] && exit 0   # --list 已处理
[ "$SEL_RC" -ne 0 ] && exit 1

echo "════════ 即将回滚生产 API :${ZJ_PROD_PORT} → ${TARGET} ════════"
# 复用 staging_rollback：原子重指 current → 目标 + 重启生产 launchd + health + 版本断言。
staging_rollback "$TARGET"
