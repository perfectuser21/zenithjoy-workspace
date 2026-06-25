#!/usr/bin/env bash
# rollback.sh — ZenithJoy 生产 API（mmv:5200）人工回滚统一入口。
#
# 拓扑（按 repo 真相，别抄旧拓扑）：
#   · API 生产 = mmv:5200（跑 Claude 这台美国 Mac mini 本机，连生产 cecelia 库），不是 HK。
#   · 生产 launchd 从 $ZJ_RELEASES_DIR/current 软链跑（promote 时原子重指）。
#   · 本脚本只回拨 API；Dashboard 生产在 HK 且【尚无 release 隔离】（promote-dashboard-prod.yml
#     是 cp -r dist 原地覆盖、零留存），无可回退版本——Dashboard 回滚需先给 HK 上 symlink-releases，
#     是独立任务，本脚本不冒充能回滚它（见 README / handoff）。
#
# 为什么需要本脚本（真正补的缺口）：
#   现有 deploy-lib.sh 的 staging_rollback 只在 blue_green_deploy 内部、promote 失败时被【自动】调用，
#   且回退目标（anchor）来自 promote 前实时读的 :5200 /version。生产【已经切完、过了几小时才发现要回退】时，
#   没有任何给人手动调用的命令，也没有"上一个 release 是谁""指定 sha 在不在留存5份里"的判定。本脚本补这个。
#
# 用法：
#   ./rollback.sh                  无参 → 退到 current 的【上一个】留存 release（previous_release）
#   ./rollback.sh <sha>            带 sha → 从留存的 release 里挑该 sha；不在留存内 → 报错退出（绝不臆造）
#   ./rollback.sh --list           只列出当前留存的 release（新→旧），不动任何东西
#
# 复用现有原语，不重写回滚机制：目标判定后直接调 deploy-lib.sh 的 staging_rollback（原子重指
# current → 目标 release + 重启生产 launchd + health + 版本断言）。本脚本只做"挑哪个 + 安全校验"。
#
# 安全：本脚本会真重启生产 :5200，只应在部署机（mmv）上人工执行。CI / 单测【绝不】跑本脚本主流程，
# 只单测被复用的纯函数（previous_release / list_releases / atomic_repoint_current，见 deploy-lib.test.sh）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="${ZJ_DEPLOY_LIB:-$SCRIPT_DIR/.github/workflows/scripts/deploy-lib.sh}"

if [ ! -f "$LIB" ]; then
  echo "❌ 找不到 deploy-lib.sh（${LIB}），无法回滚" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$LIB"

# ── 生产环境变量（与 promote-prod.yml 同一套；可被测试钩子覆盖）──
REPO="${ZJ_REPO:-$SCRIPT_DIR}"
export ZJ_REPO="$REPO"
export ZJ_API_DIR="${ZJ_API_DIR:-$REPO/apps/api}"
export ZJ_PROD_PORT="${ZJ_PROD_PORT:-5200}"
export ZJ_PROD_LABEL="${ZJ_PROD_LABEL:-com.zenithjoy.api}"
export ZJ_PROD_PLIST="${ZJ_PROD_PLIST:-$HOME/Library/LaunchAgents/com.zenithjoy.api.plist}"
export ZJ_NODE="${ZJ_NODE:-/opt/homebrew/bin/node}"
export ZJ_RELEASES_DIR="${ZJ_RELEASES_DIR:-$HOME/zenithjoy-releases}"

RELROOT="$ZJ_RELEASES_DIR"

# --list：只列留存，不动生产
if [ "${1:-}" = "--list" ] || [ "${1:-}" = "-l" ]; then
  cur="$(current_release_sha "$RELROOT" || true)"
  echo "留存 release（新→旧，releases_dir=${RELROOT}）："
  any=0
  while IFS= read -r r; do
    [ -z "$r" ] && continue
    any=1
    if [ "$r" = "$cur" ]; then echo "  * $r   ← current（当前生产）"; else echo "    $r"; fi
  done <<< "$(list_releases "$RELROOT")"
  [ "$any" -eq 1 ] || echo "  （无留存 release——$RELROOT 为空或不存在）"
  exit 0
fi

cur_sha="$(current_release_sha "$RELROOT" || true)"
target="${1:-}"

if [ -z "$target" ]; then
  # 无参：退到上一个留存 release
  target="$(previous_release "$RELROOT" || true)"
  if [ -z "$target" ]; then
    echo "❌ 取不到上一个可回退的 release（current=${cur_sha:-<无>}，没有更旧的留存版本）。" >&2
    echo "   用 ./rollback.sh --list 看留存清单，或 ./rollback.sh <sha> 指定。" >&2
    exit 1
  fi
  echo "无参回滚：current=${cur_sha:-<无>} → 上一个 release=${target}"
else
  # 带 sha：必须在留存的 release 里（绝不回滚到不存在的 release）
  if [ ! -d "$(release_dir_for "$RELROOT" "$target")" ]; then
    echo "❌ 指定的 sha=${target} 不在留存 release 里（$RELROOT 下无此目录）。" >&2
    echo "   用 ./rollback.sh --list 看可回退的留存清单。" >&2
    exit 1
  fi
  if [ "$target" = "$cur_sha" ]; then
    echo "⚠️  指定的 sha=${target} 就是当前生产 current，无需回滚。" >&2
    exit 1
  fi
  echo "指定回滚：current=${cur_sha:-<无>} → 留存 release=${target}"
fi

echo "════════ 即将回滚生产 :${ZJ_PROD_PORT} 到 ${target} ════════"
# 复用 deploy-lib.sh 的 staging_rollback：原子重指 current → 目标 + 重启 + health + 版本断言。
staging_rollback "$target"
