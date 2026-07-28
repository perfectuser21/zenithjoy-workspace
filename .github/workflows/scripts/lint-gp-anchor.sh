#!/usr/bin/env bash
# lint-gp-anchor.sh (ZenithJoy) —— GP锚定闭环 CI 硬闸（刀2）
#
# 规则：PR body 必须含恰好一行 `GP-Anchor:` 声明，三种合法形态：
#   GP-Anchor: line02/customer_smart_acquisition#step7    ← 推进某业务步骤
#   GP-Anchor: line02/customer_smart_acquisition keep-green ← 不推进但保持全绿
#   GP-Anchor: none(infra|docs|config|backlog)             ← 显式豁免
#
# 用法: PR_BODY="..." bash lint-gp-anchor.sh [BASE_REF]
# 退出码: 0 = 通过，1 = 失败
#
# 设计依据: docs/superpowers/specs/2026-07-28-gp-anchor-enforcement-design.md 第3节
#
# 架构决策（GAN收敛结论）：用 jq 读已生成、已入库的 product-map/generated/product-map.json，
# 不用 node+lib.mjs（避免 npm ci 100s+ 延迟，维持 L1 秒级门禁设计）。若PR只改了
# product-map.yaml未跑generate，由独立的 ci-l2-consistency.yml 的 product-map-contract
# job 的 drift check 兜底拦截（效果等价，只是拦在不同 job）。
set -euo pipefail

BASE_REF="${1:-origin/main}"
PR_BODY="${PR_BODY:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

MAP_JSON="product-map/generated/product-map.json"

USAGE_HINT() {
  echo "  合法形态示例："
  echo "    GP-Anchor: line02/customer_smart_acquisition#step7      (推进某业务步骤)"
  echo "    GP-Anchor: line02/customer_smart_acquisition keep-green (保持全绿)"
  echo "    GP-Anchor: none(infra)                                  (显式豁免：infra|docs|config|backlog)"
}

# ── 提取 GP-Anchor 声明行（恰好一行）────────────────────────────────────────
mapfile -t ANCHOR_LINES < <(printf '%s\n' "$PR_BODY" | grep -E '^GP-Anchor:' || true)
LINE_COUNT="${#ANCHOR_LINES[@]}"

if [ "$LINE_COUNT" -eq 0 ]; then
  echo "::error::GP-ANCHOR-MISSING PR body 缺少 GP-Anchor: 声明行。"
  USAGE_HINT
  exit 1
fi

if [ "$LINE_COUNT" -gt 1 ]; then
  echo "::error::GP-ANCHOR-MULTIPLE PR body 含 $LINE_COUNT 行 GP-Anchor 声明，只允许恰好一行。"
  printf '  %s\n' "${ANCHOR_LINES[@]}"
  exit 1
fi

DECL="${ANCHOR_LINES[0]#GP-Anchor:}"
DECL="$(echo "$DECL" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

# ── product-map JSON 环境自检（与业务判定失败区分）───────────────────────────
if [ ! -f "$MAP_JSON" ]; then
  echo "::error::GP-ANCHOR-ENV-FAIL $MAP_JSON 不存在，无法校验 GP id"
  exit 1
fi
if ! jq empty "$MAP_JSON" >/dev/null 2>&1; then
  echo "::error::GP-ANCHOR-ENV-FAIL $MAP_JSON 不是合法 JSON"
  exit 1
fi

# ── 三形态解析 ────────────────────────────────────────────────────────────
LINE_ID=""
GP_ID=""
MODE=""

if [[ "$DECL" =~ ^none\(([a-z_]+)\) ]]; then
  CATEGORY="${BASH_REMATCH[1]}"
  case "$CATEGORY" in
    infra|docs|config)
      echo "PASS: none($CATEGORY) 豁免"
      exit 0
      ;;
    backlog)
      if echo "$PR_BODY" | grep -qE '[0-9a-f]{8}'; then
        echo "PASS: none(backlog) 豁免，含issue id token"
        exit 0
      else
        echo "::error::GP-ANCHOR-BACKLOG-NO-ISSUE none(backlog) 必须在 PR body 里带一个 Brain issue id（形如8位hex，如 73a75417）"
        exit 1
      fi
      ;;
    *)
      echo "::error::GP-ANCHOR-INVALID-CATEGORY 豁免类别 '$CATEGORY' 不在白名单内（合法：infra|docs|config|backlog）"
      exit 1
      ;;
  esac
elif [[ "$DECL" =~ ^([a-z0-9_]+)/([a-z0-9_]+)[[:space:]]+keep-green$ ]]; then
  LINE_ID="${BASH_REMATCH[1]}"
  GP_ID="${BASH_REMATCH[2]}"
  MODE="keep-green"
elif [[ "$DECL" =~ ^([a-z0-9_]+)/([a-z0-9_]+)#(step[0-9]+)$ ]]; then
  LINE_ID="${BASH_REMATCH[1]}"
  GP_ID="${BASH_REMATCH[2]}"
  MODE="progressing"
else
  echo "::error::GP-ANCHOR-FORMAT-INVALID 声明格式不合法: '$DECL'"
  USAGE_HINT
  exit 1
fi

# ── id 存在性校验（推进/keep-green 都要过）──────────────────────────────────
GP_EXISTS=$(jq --arg line "$LINE_ID" --arg gp "$GP_ID" \
  '[.golden_paths[] | select(.line_id==$line and .id==$gp)] | length' "$MAP_JSON")

if [ "$GP_EXISTS" -eq 0 ]; then
  echo "::error::GP-ANCHOR-ID-NOTFOUND 找不到 line_id=$LINE_ID id=$GP_ID"
  echo "  现有 GP（按 line 分组）："
  jq -r '.golden_paths | group_by(.line_id) | .[] | "    " + .[0].line_id + ": " + ([.[].id] | join(", "))' "$MAP_JSON"
  echo "  完整校验命令: npm run product-map:check"
  exit 1
fi

# ── 推进类：diff 触碰校验 ────────────────────────────────────────────────
if [ "$MODE" = "progressing" ]; then
  SMOKE_FILES=$(jq -r --arg line "$LINE_ID" --arg gp "$GP_ID" \
    '.golden_paths[] | select(.line_id==$line and .id==$gp) | .smoke_files[]?' "$MAP_JSON")

  if [ -z "$SMOKE_FILES" ]; then
    echo "PASS: $LINE_ID/$GP_ID 未声明 smoke_files，跳过 diff 触碰校验"
    exit 0
  fi

  git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true
  DIFF_FILES=$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || true)

  TOUCHED=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if printf '%s\n' "$DIFF_FILES" | grep -qxF "$f"; then
      TOUCHED=1
      break
    fi
  done <<< "$SMOKE_FILES"

  if [ "$TOUCHED" -eq 0 ]; then
    echo "::error::GP-ANCHOR-NOT-TOUCHED 声明推进 $LINE_ID/$GP_ID ，但本 PR 未触碰其 smoke_files："
    printf '%s\n' "$SMOKE_FILES" | sed 's/^/    /'
    exit 1
  fi
fi

echo "PASS: GP-Anchor 校验通过 ($MODE: $LINE_ID/$GP_ID)"
exit 0
