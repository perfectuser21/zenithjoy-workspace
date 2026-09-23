#!/usr/bin/env bash
# payment-smoke.sh
# 支付回调公网可达性 smoke —— 从 GHA runner（公网出口）验证部署后的回调端点。
#
# 治的事故：域名/nginx 反代配置漂移，或路由没挂上/验签中间件没接进去，
# 只有等真实支付回调打进来才发现——那时钱已经在等确认，代价比 CI 红一次大得多。
#
# 验证方式：不带签名头 POST 回调端点，期望被验签拦下返回 403。
# 这一次请求同时证明两件事：① 端点公网可达（能连上、路由确实挂了）
# ② 验签确实在生效（不是随便什么请求都放行）。
#
# I-4：探针原打的是 /callback/mock，但 provider-registry.ts 在 NODE_ENV=production
# 时不注册 mock provider（假网关绝不能在生产可用）——生产下打 mock 必然 404，
# 会被下面的判读逻辑误诊成"路由没挂上/部署漏了"，实际只是选错了探针。改打
# wechat：只要 env 配齐就会在生产环境注册，缺签名头同样会被验签拦下返回 403，
# 与是否是生产环境无关，不会有这个误诊。
#
# 退出码：0 = PASS（403）；1 = FAIL（任何非 403 响应）
#
# 判读：
#   403      = PASS，验签生效
#   404      = 路由没挂上（部署漏了 paymentCallbackRouter 或反代路径配错）
#   200      = 验签没生效（危险！未签名请求被当成合法回调放行）
#   5xx/000  = 端点不可达（服务没起来 / nginx 配置错误 / 网络不通）
set -euo pipefail

# 优雅跳过：secret 尚未配置时不让 CI 变红（判空放在脚本内部，workflow 侧只管调用，
# 这样 secret 配上去之后自动生效，不需要再开任务回来接线）。
if [[ -z "${PAYMENT_NOTIFY_BASE_URL:-}" ]]; then
  echo "⏭️  SKIP: PAYMENT_NOTIFY_BASE_URL 未配置，跳过支付回调可达性 smoke"
  exit 0
fi

BASE_URL="${PAYMENT_NOTIFY_BASE_URL}"
URL="${BASE_URL%/}/api/payment/callback/wechat"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  支付回调可达性 smoke"
echo "  探测: ${URL}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 不带签名头 POST：期望被验签拦下返回 403。
# curl 在连接失败（超时/拒连）时会以非零码退出，不能让 set -e 在这里直接杀脚本——
# 那样会丢失下面按状态码分类判读的诊断信息，所以显式兜底成 "000"（不可达的约定值）。
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${URL}" \
  -H 'Content-Type: application/json' --data '{}' --max-time 15) || code="000"

echo "  HTTP 状态码: ${code}"

if [[ "${code}" == "403" ]]; then
  echo "  ✅ PASS: 回调端点可达且验签生效（403）"
  exit 0
fi

case "${code}" in
  404)
    echo "  ❌ FAIL: 404 —— 路由没挂上（反代/部署漏了支付回调路由）"
    ;;
  200)
    echo "  ❌ FAIL: 200 —— 危险！验签没生效，未签名请求被当成合法回调放行"
    ;;
  000|5*)
    echo "  ❌ FAIL: ${code} —— 端点不可达（服务未起来 / nginx 配置错误 / 网络不通）"
    ;;
  *)
    echo "  ❌ FAIL: 期望 403，实际 ${code}（未归类状态码，一律视为失败）"
    ;;
esac
exit 1
