#!/usr/bin/env bash
# audit-gate.sh — npm 依赖漏洞门禁（含 devDependencies，替代被 --omit=dev 阉割的旧闸）
#
# 用法: audit-gate.sh <目录>   （目录须含 package.json + package-lock.json）
#
# 规则：任何 severity ≥ high 且不在 ALLOWLIST 的漏洞 → exit 1。
# ALLOWLIST 仅收"修复需要 semver major、已单独立项跟踪"的包，每项必须带到期条件；
# 对应升级 PR 合并后必须把该项删掉——允许名单只减不增（新增需在 PR 里说明立项链接）。
set -uo pipefail

DIR="${1:-.}"
# astro / @astrojs/mdx：修复需升 astro 7.x（semver major，涉及站点构建验证），
# 已另立 sprint 跟踪；升级合并后删除这两行。
ALLOWLIST=("astro" "@astrojs/mdx")

cd "$DIR"
AUDIT_JSON=$(npm audit --json 2>/dev/null || true)
if [ -z "$AUDIT_JSON" ]; then
  echo "❌ npm audit 无输出（$DIR 缺 package-lock.json？）"
  exit 1
fi

VIOLATIONS=$(echo "$AUDIT_JSON" | jq -r --argjson allow "$(printf '%s\n' "${ALLOWLIST[@]}" | jq -R . | jq -s .)" '
  .vulnerabilities // {} | to_entries[]
  | select(.value.severity == "high" or .value.severity == "critical")
  | select((.key as $k | $allow | index($k)) | not)
  | "\(.key): \(.value.severity)"')

echo "== npm audit gate（目录: ${DIR}，含 dev deps）=="
echo "$AUDIT_JSON" | jq -r '.metadata.vulnerabilities | "总计: low=\(.low) moderate=\(.moderate) high=\(.high) critical=\(.critical)"'

if [ -n "$VIOLATIONS" ]; then
  echo "❌ 存在 allowlist 之外的 high/critical 漏洞："
  echo "$VIOLATIONS"
  echo "修法：npm audit fix；semver major 才能修的需单独立项并在本脚本 ALLOWLIST 登记（带到期条件）。"
  exit 1
fi
echo "✅ 无 allowlist 之外的 high/critical 漏洞（allowlist: ${ALLOWLIST[*]}）"
