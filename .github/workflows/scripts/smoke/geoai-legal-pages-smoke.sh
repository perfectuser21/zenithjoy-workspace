#!/usr/bin/env bash
# geoai-legal-pages-smoke.sh
# zenithjoyai.com 法律页与 TikTok 域名验证文件的线上冒烟
#
# 为什么需要这个脚本：
#   1) 这些页面是 TikTok 开发者申请的必填项，掉了就要重新走审核；
#   2) 站点用 Astro i18n（prefixDefaultLocale），**不存在的路径也返回 HTTP 200**，
#      内容是"Redirecting to: /zh/"的兜底跳转页（正文仅 ~47 字节）。
#      只测状态码会被这个假 200 骗过去 —— 2026-09-12 实际踩过。
#      故本脚本必须校验正文特征，不能只看 200。
#   3) zenithjoyai 是 Cloudflare Pages 直传项目，源码不在仓库里的文件会被下一次
#      干净构建抹掉 —— 本脚本即为该回归的守卫。
#
# 验证：
#   Step 1  4 个法律页（zh/en × privacy-policy/terms-of-service）
#           → 200 + 正文长度达标 + 非兜底跳转页
#   Step 2  2 个 TikTok 域名验证文件 → 200 + 正文令牌正确
#           URL Prefix 文件的令牌取自**文件名**，不是 DNS 验证令牌（两者不同）
#
# 退出码：
#   0  全过
#   1  法律页缺失/返回兜底跳转页/正文过短
#   2  TikTok 验证文件缺失或令牌不符
#
# 依赖：仅 curl。SITE 可覆盖（默认线上正式域）。

set -uo pipefail

SITE="${SITE:-https://www.zenithjoyai.com}"
MIN_BODY_CHARS="${MIN_BODY_CHARS:-600}"
FAIL=0

_body_text() {
  # 去掉 script/style 与标签，压空白，输出纯文本
  sed -e 's/<script[^>]*>.*<\/script>//g' -e 's/<style[^>]*>.*<\/style>//g' \
    | tr '\n' ' ' | sed -e 's/<[^>]*>/ /g' -e 's/  */ /g'
}

echo "== Step 1: 法律页 =="
for P in /zh/privacy-policy/ /zh/terms-of-service/ /en/privacy-policy/ /en/terms-of-service/; do
  CODE=$(curl -s -o /tmp/lp.html -w '%{http_code}' --max-time 20 "${SITE}${P}")
  TXT=$(_body_text < /tmp/lp.html)
  LEN=${#TXT}

  if [ "$CODE" != "200" ]; then
    echo "  FAIL $P  HTTP=$CODE"; FAIL=1; continue
  fi
  # 关键断言：兜底跳转页会包含 "Redirecting"，真实政策页不会
  if echo "$TXT" | grep -qi "Redirecting to:"; then
    echo "  FAIL $P  命中 Astro i18n 兜底跳转页（假 200）"; FAIL=1; continue
  fi
  if [ "$LEN" -lt "$MIN_BODY_CHARS" ]; then
    echo "  FAIL $P  正文仅 ${LEN} 字符（阈值 ${MIN_BODY_CHARS}），疑似非真实政策内容"; FAIL=1; continue
  fi
  echo "  OK   $P  HTTP=200  正文=${LEN} 字符"
done

echo "== Step 2: TikTok 域名验证文件 =="
check_verify_file() {
  local path="$1" expect_token="$2"
  local code body token
  code=$(curl -s -o /tmp/vf.txt -w '%{http_code}' --max-time 20 "${SITE}${path}")
  body=$(tr -d '\r\n' < /tmp/vf.txt)
  token="${body#*=}"
  if [ "$code" != "200" ]; then
    echo "  FAIL $path  HTTP=$code"; return 1
  fi
  if [ "$token" != "$expect_token" ]; then
    echo "  FAIL $path  令牌不符"; return 1
  fi
  echo "  OK   $path  HTTP=200  令牌匹配"
  return 0
}

# URL Prefix 验证：令牌 = 文件名去掉 tiktok 前缀与 .txt 后缀
PREFIX_FILE="tiktokAjuIaUzM7g4v0lFmxkCbUsh2EXgoDY8Y.txt"
PREFIX_TOKEN="${PREFIX_FILE#tiktok}"; PREFIX_TOKEN="${PREFIX_TOKEN%.txt}"
check_verify_file "/zh/${PREFIX_FILE}" "$PREFIX_TOKEN" || FAIL=2

# 根域验证：令牌为 DNS 验证串（与上面那个不同，勿混用）
check_verify_file "/tiktok-developers-site-verification.txt" "IcnU6eTXwXb7klJcWqDyAFA4GxvDJmPe" || FAIL=2

rm -f /tmp/lp.html /tmp/vf.txt
if [ "$FAIL" -ne 0 ]; then
  echo "geoai-legal-pages-smoke FAIL (code=$FAIL)"; exit "$FAIL"
fi
echo "geoai-legal-pages-smoke PASS"
