#!/usr/bin/env bash
# lint-realmachine-unverified-ratchet.sh
#
# 真机验证车道三层防假绿 · 第3层棘轮的真正 CI 硬闸（2026-07-30 升级）。
#
# 背景：scripts/product-map/realmachine-unverified-ratchet.mjs 之前是 report-only
# （exit 恒 0，只喂 ci-patrol 日报），棘轮是否真的"硬伤数只许降不许升，升了开 issue"
# 完全依赖 ci-patrol 每日 LLM 巡检"恰好注意到"——没有任何机械保证。proven-to-fire
# 演练实测证实了这个缺口（该脚本本身计数逻辑没问题，但没有 CI 硬闸/没有机械开 issue）。
#
# 本脚本照抄仓库里已经真正生效的棘轮硬闸模式（lint-smoke-baseline.sh）：
#   - 维护一个数值 baseline 文件（realmachine-unverified-baseline.txt）
#   - CI 里读当前真实值（调 realmachine-unverified-ratchet.mjs）与 baseline 比较
#   - 当前值 > baseline → exit 1（直接卡 PR，不等巡检）
#   - baseline 文件本身被改大 → PR body 必须含 REALMACHINE-BASELINE-RAISE: 理由，
#     否则同样 exit 1（棘轮只降不升，改大要走豁免声明，跟 lint-smoke-baseline.sh
#     的 BASELINE-REMOVE: 约定同款）
#   - 真超标时机械调用 gh issue create 开 [realmachine-ratchet-red] issue（照抄
#     nightly-real-machine-staging.yml 汇总 job 的同日去重 + gh issue create 模式，
#     不依赖 LLM 判断，不新造开 issue 机制）
#
# 用法: lint-realmachine-unverified-ratchet.sh [base_ref]（默认 origin/main）
#
# 环境变量（均可覆盖，供测试隔离用）：
#   REALMACHINE_BASELINE_FILE  baseline 文件路径（默认 .github/workflows/scripts/realmachine-unverified-baseline.txt）
#   REALMACHINE_SMOKE_DIR      透传给 ratchet.mjs 的扫描目录
#   REALMACHINE_NIGHTLY_YML    透传给 ratchet.mjs 的 nightly workflow 路径
#   PR_BODY                    PR body（workflow 注入，baseline 改大理由声明检查用）
#   GH_BIN                     gh 可执行路径（默认 gh，测试用假 gh 覆盖）
#   GITHUB_REPOSITORY          gh issue 操作目标 repo（CI 自动注入）
set -uo pipefail

BASE_REF="${1:-origin/main}"
BASELINE_FILE="${REALMACHINE_BASELINE_FILE:-.github/workflows/scripts/realmachine-unverified-baseline.txt}"
GH_BIN="${GH_BIN:-gh}"
# ratchet.mjs 路径相对本脚本自身位置解析，不依赖调用方 cwd（proven-to-fire 测试需要
# 在隔离的临时 git 仓库里单独验证 baseline-raise 判定逻辑，cwd 不是真实仓库根）。
SCRIPT_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RATCHET_MJS="$SCRIPT_REPO_ROOT/scripts/product-map/realmachine-unverified-ratchet.mjs"

if [ ! -f "$BASELINE_FILE" ]; then
  echo "❌ baseline 文件不存在: $BASELINE_FILE"
  exit 1
fi

BASELINE=$(tr -d '[:space:]' < "$BASELINE_FILE")
case "$BASELINE" in
  ''|*[!0-9]*)
    echo "❌ baseline 文件内容不是合法非负整数: '$BASELINE'"
    exit 1
    ;;
esac

# ── 读当前真实值（调用 report-only 的计数脚本，本脚本负责机械判定+开issue）──
RATCHET_JSON=$(REALMACHINE_SMOKE_DIR="${REALMACHINE_SMOKE_DIR:-}" \
  REALMACHINE_NIGHTLY_YML="${REALMACHINE_NIGHTLY_YML:-}" \
  node "$RATCHET_MJS" 2>/dev/null)
CURRENT=$(printf '%s' "$RATCHET_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{console.log(JSON.parse(s).realmachine_unverified_count)}catch{console.log('NaN')}})")
case "$CURRENT" in
  ''|*[!0-9]*)
    echo "❌ realmachine-unverified-ratchet.mjs 输出无法解析: $RATCHET_JSON"
    exit 1
    ;;
esac

FAIL=0

# ── 规则 1：当前值超过 baseline → 直接判红（不等巡检）──────────────────
if [ "$CURRENT" -gt "$BASELINE" ]; then
  IDS=$(printf '%s' "$RATCHET_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{console.log(JSON.parse(s).realmachine_unverified_ids.join(', '))}catch{console.log('')}})")
  echo "::error::realmachine_unverified_count 上升：baseline=$BASELINE 当前=${CURRENT}（未覆盖标记: ${IDS}）——棘轮只许降不许升"
  FAIL=1

  # ── 机械开 issue（照抄 nightly-real-machine-staging.yml 汇总 job 的同日去重模式）──
  TODAY=$(TZ=Asia/Shanghai date +%F)
  TITLE="[realmachine-ratchet-red] 真机验证未覆盖标记数上升 $TODAY (baseline=$BASELINE 当前=$CURRENT)"
  if command -v "$GH_BIN" >/dev/null 2>&1; then
    EXIST=$("$GH_BIN" issue list --repo "${GITHUB_REPOSITORY:-}" --state open \
      --search "in:title [realmachine-ratchet-red] $TODAY" --json number --jq 'length' 2>/dev/null || echo "0")
    if [ "${EXIST:-0}" = "0" ]; then
      "$GH_BIN" issue create --repo "${GITHUB_REPOSITORY:-}" \
        --title "$TITLE" \
        --body "$(printf 'realmachine-unverified-ratchet 棘轮上升，机械触发（不依赖 ci-patrol 每日巡检）。\n\nbaseline=%s 当前=%s\n未覆盖标记: %s\n\n处理约定：给对应 [CI-MOCK] 标记补上 nightly_ref 指向的真机 nightly job，或撤回该步骤；确认修复后把 realmachine-unverified-baseline.txt 改回原值。' "$BASELINE" "$CURRENT" "$IDS")" \
        >/dev/null 2>&1 && echo "✅ 已机械开 issue: $TITLE" || echo "⚠️ gh issue create 调用失败（可能权限不足，仍判红不放行）"
    else
      echo "ℹ️ 同日 [realmachine-ratchet-red] issue 已存在，跳过重复开 issue"
    fi
  else
    echo "⚠️ 未找到 gh 可执行文件，跳过开 issue（仍判红不放行）"
  fi
fi

# ── 规则 2：baseline 文件被改大必须声明理由（同 lint-smoke-baseline.sh 的 BASELINE-REMOVE 约定）──
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true
  OLD_BASELINE=$(git show "${BASE_REF}:${BASELINE_FILE}" 2>/dev/null | tr -d '[:space:]' || echo "")
  case "$OLD_BASELINE" in
    ''|*[!0-9]*) OLD_BASELINE="" ;;
  esac
  if [ -n "$OLD_BASELINE" ] && [ "$BASELINE" -gt "$OLD_BASELINE" ]; then
    if ! printf '%s' "${PR_BODY:-}" | grep -q 'REALMACHINE-BASELINE-RAISE:'; then
      echo "::error::realmachine-unverified-baseline.txt 从 $OLD_BASELINE 改大到 ${BASELINE}，但 PR body 缺 'REALMACHINE-BASELINE-RAISE:' 理由声明（棘轮只降不升，改大需显式豁免）"
      FAIL=1
    fi
  fi
fi

if [ "$FAIL" -eq 0 ]; then
  echo "✅ lint-realmachine-unverified-ratchet 通过（baseline=$BASELINE 当前=${CURRENT}）"
fi

exit "$FAIL"
