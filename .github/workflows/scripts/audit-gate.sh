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
# sharp/miniflare/wrangler/undici：同一根因，都是 astro 传递依赖链带进来的（astro→miniflare→
# sharp, astro→miniflare→undici, astro→wrangler），升 astro 7.x 后这几个一并解决，不是独立
# 漏洞，随 astro 那条一起删。undici 于 08-04 由 npm 漏洞库新公布 CVE 补入本链（node_modules/
# miniflare/node_modules/undici，非本仓库代码改动引入，修复需 wrangler@4.35.0 semver major）。
#
# 2026-07-27：以下一批是 npm 外部 CVE 库当天新公布的漏洞，package-lock.json 最后改动在
# 07-21（先于本次 CVE 公布），确认不是任何近期代码改动引入——已建 issue a46e7823 跟踪，
# 需要 eslint@10 / @vitest/coverage-v8@4 等 semver major 升级（glob/minimatch/rimraf/
# brace-expansion/ts-node-dev 目前 npm 侧无可用修复版本）。issue 关闭后删除本段。
# 2026-08-07：js-yaml CVE-2026-59870（!!omap 二次方 CPU）当天新公布，lock 早于公布、非代码
# 改动引入；fix 不 backport 4.x，需 js-yaml@5 semver major（传递依赖声明 ^4.1.1）。
# 已建 issue 366d671d 跟踪，升级合并后删除 js-yaml 这一项。
ALLOWLIST=(
  "js-yaml"
  "astro" "@astrojs/mdx" "sharp" "miniflare" "wrangler" "undici"
  "eslint" "@eslint/config-array" "@eslint/eslintrc"
  "@typescript-eslint/eslint-plugin" "@typescript-eslint/parser"
  "@typescript-eslint/type-utils" "@typescript-eslint/typescript-estree"
  "@typescript-eslint/utils" "@vitest/coverage-v8" "better-auth"
  "brace-expansion" "ejs" "eslint-plugin-react" "filelist" "glob"
  "jake" "minimatch" "postcss" "rimraf" "test-exclude" "ts-node-dev"
  "workbox-build" "@trickfilm400/rollup-plugin-off-main-thread"
)

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
