#!/usr/bin/env bash
# Lead acceptance evidence validator
# 用法: bash scripts/check-lead-acceptance.sh <evidence-file.md>
# Exit 0 = 合格；非 0 = 不合格

set -uo pipefail
FILE="${1:-}"

if [ -z "$FILE" ]; then
  echo "ERROR: 用法 bash check-lead-acceptance.sh <evidence-file.md>" >&2
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "ERROR: evidence 文件不存在: $FILE" >&2
  exit 1
fi

# 防作弊检查 1：严禁 'preset cookie' / '预置 cookie'
if grep -qiE "(preset[[:space:]]+cookie|预置[[:space:]]*cookie|cookie[[:space:]]+(was[[:space:]]+)?(preloaded|preset))" "$FILE"; then
  echo "ERROR: evidence 含 'preset cookie' / '预置 cookie' 字眼 — 不算合格 lead 自验（违反防作弊条款）" >&2
  echo "找到的痕迹:" >&2
  grep -niE "preset[[:space:]]+cookie|预置[[:space:]]*cookie|preloaded" "$FILE" >&2
  exit 1
fi

# 必须含真实平台 URL（抖音/快手/小红书等任一）
if ! grep -qE "https?://(www\.)?(douyin|iesdouyin|kuaishou|xiaohongshu|toutiao|weibo|zhihu|mp\.weixin)\.(com|qq\.com)/" "$FILE"; then
  echo "ERROR: evidence 不含真实平台 URL（douyin/kuaishou/xiaohongshu/...）" >&2
  exit 1
fi

# 必须含扫码相关字眼（证明走真扫码路径）
if ! grep -qE "(扫码|qr|QR|scan)" "$FILE"; then
  echo "ERROR: evidence 不含扫码字眼" >&2
  exit 1
fi

echo "OK: evidence 合格"
exit 0
