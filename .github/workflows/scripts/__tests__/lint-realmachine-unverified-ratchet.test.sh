#!/usr/bin/env bash
# lint-realmachine-unverified-ratchet.test.sh — proven-to-fire 测试
#
# 验证真机验证车道三层防假绿 · 第3层棘轮的新 CI 硬闸
# (lint-realmachine-unverified-ratchet.sh) 真的有牙齿：
#   A. 故意造一个未覆盖的 [CI-MOCK] 标记（count 从 baseline 之上）→ 脚本必须 exit 1，
#      且必须机械调用 gh issue create（不依赖 ci-patrol 巡检/LLM判断）
#   B. 现有仓库真实状态（count=baseline=0）→ 脚本必须 exit 0（不误伤正常状态）
#   C. baseline 文件被人为改大但 PR body 没有 REALMACHINE-BASELINE-RAISE: 声明
#      → 脚本必须 exit 1（棘轮只降不升）
#
# 用法: bash lint-realmachine-unverified-ratchet.test.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRIPT="$REPO_ROOT/.github/workflows/scripts/lint-realmachine-unverified-ratchet.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  lint-realmachine-unverified-ratchet.sh proven-to-fire 测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$SCRIPT" ]; then
  echo "❌ RED（预期）: $SCRIPT 不存在 —— Generator 尚未实现，TDD Red 阶段正常现象"
  exit 1
fi

FAILED=0
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# 假 gh：记录被调用过 + 记录传入的 --title，不真的打 GitHub API
GH_CALLED_FLAG="$WORKDIR/gh_called.flag"
GH_TITLE_FILE="$WORKDIR/gh_title.txt"
FAKE_GH="$WORKDIR/gh"
cat > "$FAKE_GH" << GHEOF
#!/usr/bin/env bash
if [ "\$1" = "issue" ] && [ "\$2" = "list" ]; then
  echo "0"
  exit 0
fi
if [ "\$1" = "issue" ] && [ "\$2" = "create" ]; then
  touch "$GH_CALLED_FLAG"
  # 提取 --title 后面那个参数
  prev=""
  for arg in "\$@"; do
    if [ "\$prev" = "--title" ]; then echo "\$arg" > "$GH_TITLE_FILE"; fi
    prev="\$arg"
  done
  exit 0
fi
exit 0
GHEOF
chmod +x "$FAKE_GH"

# ── Test A: 未覆盖标记 → count(1) > baseline(0) → exit 1 + 机械开 issue ──
BASELINE_A="$WORKDIR/baseline-zero.txt"
printf '0\n' > "$BASELINE_A"
SMOKE_A="$WORKDIR/smoke-a"
mkdir -p "$SMOKE_A"
printf '%s\n' "# [CI-MOCK: real-device-only | nightly_ref: nonexistent-not-in-nightly.sh]" \
  > "$SMOKE_A/golden-path-98-drill-smoke.sh"

cd "$REPO_ROOT"
rm -f "$GH_CALLED_FLAG"
OUTPUT_A=$(GH_BIN="$FAKE_GH" GITHUB_REPOSITORY="fake/repo" \
  REALMACHINE_BASELINE_FILE="$BASELINE_A" \
  REALMACHINE_SMOKE_DIR="$SMOKE_A" \
  REALMACHINE_NIGHTLY_YML="$REPO_ROOT/.github/workflows/nightly-real-machine-staging.yml" \
  bash "$SCRIPT" 2>&1)
CODE_A=$?
echo "$OUTPUT_A"
echo "── Test A exit=$CODE_A ──"

if [ "$CODE_A" -eq 1 ]; then
  echo "✅ PASS [A1]: 未覆盖标记导致 count 超 baseline 时脚本 exit 1（proven-to-fire：真的会报红）"
else
  echo "❌ FAIL [A1]: 期望 exit 1，实得 $CODE_A —— 硬闸没有牙齿"
  FAILED=1
fi

if [ -f "$GH_CALLED_FLAG" ]; then
  echo "✅ PASS [A2]: 超标时机械调用了 gh issue create（不依赖巡检/LLM）"
else
  echo "❌ FAIL [A2]: 超标但从未调用 gh issue create —— 开 issue 机制没有牙齿"
  FAILED=1
fi

if [ -f "$GH_TITLE_FILE" ] && grep -q '\[realmachine-ratchet-red\]' "$GH_TITLE_FILE"; then
  echo "✅ PASS [A3]: issue 标题带 [realmachine-ratchet-red] 前缀（沿用既有自动开issue命名约定）"
else
  echo "❌ FAIL [A3]: issue 标题未含约定前缀"
  FAILED=1
fi

# ── Test B: 仓库真实当前状态（count=baseline=0）→ exit 0，不误伤 ──
rm -f "$GH_CALLED_FLAG"
OUTPUT_B=$(GH_BIN="$FAKE_GH" GITHUB_REPOSITORY="fake/repo" bash "$SCRIPT" 2>&1)
CODE_B=$?
echo "$OUTPUT_B"
echo "── Test B exit=$CODE_B ──"

if [ "$CODE_B" -eq 0 ]; then
  echo "✅ PASS [B]: 仓库真实当前状态(count=baseline)不误判红"
else
  echo "❌ FAIL [B]: 仓库真实当前状态被误判红（exit=${CODE_B}），可能是假阳性"
  FAILED=1
fi

# ── Test C: baseline 被改大但 PR body 缺理由声明 → exit 1 ──
# main = 改动前状态(baseline=0)；pr-branch = 模拟 PR 分支(baseline 改大到5)，
# 脚本用 base_ref=main 对比 pr-branch 当前 checkout 出的文件，模拟真实 PR diff 场景。
cd "$WORKDIR"
git init -q repo_c 2>/dev/null
cd repo_c
mkdir -p .github/workflows/scripts
printf '0\n' > .github/workflows/scripts/realmachine-unverified-baseline.txt
git add -A >/dev/null 2>&1
git -c user.email=t@t.com -c user.name=t commit --no-verify -qm base >/dev/null 2>&1
git branch -q -M main
git checkout -qb pr-branch
printf '5\n' > .github/workflows/scripts/realmachine-unverified-baseline.txt
git add -A >/dev/null 2>&1
git -c user.email=t@t.com -c user.name=t commit --no-verify -qm raise >/dev/null 2>&1

OUTPUT_C=$(GH_BIN="$FAKE_GH" GITHUB_REPOSITORY="fake/repo" \
  REALMACHINE_SMOKE_DIR="$WORKDIR/empty-smoke-dir" \
  PR_BODY="没有豁免声明的一般 PR 描述" \
  bash "$SCRIPT" main 2>&1)
CODE_C=$?
echo "$OUTPUT_C"
echo "── Test C exit=$CODE_C ──"

if [ "$CODE_C" -eq 1 ] && printf '%s' "$OUTPUT_C" | grep -q 'REALMACHINE-BASELINE-RAISE'; then
  echo "✅ PASS [C]: baseline 改大且 PR body 缺理由声明时 exit 1（棘轮只降不升）"
else
  echo "❌ FAIL [C]: baseline 改大缺理由声明时未被拦截（exit=${CODE_C}）"
  FAILED=1
fi

echo ""
echo "lint-realmachine-unverified-ratchet proven-to-fire 测试: $([ "$FAILED" -eq 0 ] && echo 全部通过 || echo 有失败)"
exit "$FAILED"
