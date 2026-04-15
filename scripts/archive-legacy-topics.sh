#!/usr/bin/env bash
#
# 归档旧选题目录 — 选题池 v1 一次性清理脚本
#
# 把 content-output/research/ 下匹配 *2026-04-1[0-3]-* 的目录移入
# content-output/_archived/。
#
# 默认 dry-run（只打印清单）；加 --apply 才真正移动；幂等。
#
# 用法：
#   ./scripts/archive-legacy-topics.sh                  # dry-run
#   ./scripts/archive-legacy-topics.sh --apply          # 真正归档
#   ./scripts/archive-legacy-topics.sh --root /path     # 自定义 content-output 根
#   ./scripts/archive-legacy-topics.sh --pattern "..."  # 自定义匹配 pattern
#
# Brain Task: 4aac48fe-048a-4f82-9750-57e6614e0c62

set -euo pipefail

APPLY=false
ROOT="${HOME}/content-output"
PATTERN="*2026-04-1[0-3]-*"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply) APPLY=true; shift ;;
        --root) ROOT="$2"; shift 2 ;;
        --pattern) PATTERN="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,18p' "$0"
            exit 0
            ;;
        *)
            echo "未知参数: $1" >&2
            exit 2
            ;;
    esac
done

RESEARCH_DIR="${ROOT}/research"
ARCHIVE_DIR="${ROOT}/_archived"

if [[ ! -d "$RESEARCH_DIR" ]]; then
    echo "[skip] 目录不存在：$RESEARCH_DIR"
    echo "       （这可能意味着系统未在本机生产内容，或路径已变更）"
    exit 0
fi

mkdir -p "$ARCHIVE_DIR"

# shellcheck disable=SC2207
matches=()
while IFS= read -r -d '' p; do
    matches+=("$p")
done < <(find "$RESEARCH_DIR" -maxdepth 1 -mindepth 1 -name "$PATTERN" -print0 2>/dev/null || true)

count=${#matches[@]}
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Archive Legacy Topics  (apply=${APPLY})"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  research dir : $RESEARCH_DIR"
echo "  archive dir  : $ARCHIVE_DIR"
echo "  pattern      : $PATTERN"
echo "  matched      : $count"
echo ""

if [[ $count -eq 0 ]]; then
    echo "无匹配目录，已是干净状态。"
    exit 0
fi

moved=0
skipped=0
for path in "${matches[@]}"; do
    name=$(basename "$path")
    target="${ARCHIVE_DIR}/${name}"

    if [[ -e "$target" ]]; then
        echo "  [skip]   $name  (target 已存在)"
        skipped=$((skipped + 1))
        continue
    fi

    if [[ "$APPLY" == "true" ]]; then
        mv "$path" "$target"
        echo "  [moved]  $name"
        moved=$((moved + 1))
    else
        echo "  [would]  $name -> _archived/"
    fi
done

echo ""
if [[ "$APPLY" == "true" ]]; then
    echo "完成：移动 ${moved} 个目录，跳过 ${skipped} 个已归档。"
else
    echo "DRY-RUN 完成：${count} 个目录待归档。"
    echo "执行真正归档：再次运行加 --apply"
fi
