#!/usr/bin/env bash
# trim-json-lib-smoke.sh — trim_json_stdin 回归测试
#
# 背景：2026-08-04 审计发现 line02-android-collect-realmachine-smoke.sh 的 Seg3
# 语义质量闸用 `tr -d '\n' | xargs` 做 trim，xargs 的 shell-word-splitting 语义会
# 剥掉 JSON 双引号，导致后续 JSON.parse 必炸。本测试锁定两件事：
#   (1) 复现 xargs 写法确实会破坏 JSON（防止未来有人误以为 xargs trim 是安全的）
#   (2) trim_json_stdin（新写法）不破坏 JSON，JSON.parse 能正确解析
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/trim-json.sh"

SAMPLE='[{"nickname":"张三","comment_text":"求报价"}]'

# (1) 复现根因：xargs 写法确实破坏 JSON
XARGS_RESULT=$(echo "$SAMPLE" | tr -d '\n' | xargs)
if echo "$XARGS_RESULT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);
process.stdin.on('end',()=>{ JSON.parse(d.trim()); });
" 2>/dev/null; then
  echo "❌ FAIL: xargs 写法本应破坏 JSON（用于锁定已知 bug 复现前提），但 JSON.parse 意外成功——说明复现前提已失效，需要重新核实场景"
  exit 1
fi
echo "✅ 复现确认: tr -d '\\n' | xargs 破坏 JSON 引号（JSON.parse 失败），符合已知 bug"

# (2) 验证 trim_json_stdin 保留 JSON 引号，JSON.parse 正确解析
TRIM_RESULT=$(echo "$SAMPLE" | tr -d '\n' | trim_json_stdin)
PARSED_NICKNAME=$(echo "$TRIM_RESULT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);
process.stdin.on('end',()=>{
  const arr = JSON.parse(d.trim());
  console.log(arr[0].nickname);
});
")
[ "$PARSED_NICKNAME" = "张三" ] || { echo "❌ FAIL: trim_json_stdin 后 JSON.parse 解析 nickname 期望 '张三'，实得 '$PARSED_NICKNAME'"; exit 1; }
echo "✅ PASS: trim_json_stdin 保留 JSON 引号，JSON.parse 正确解析 nickname=张三"
