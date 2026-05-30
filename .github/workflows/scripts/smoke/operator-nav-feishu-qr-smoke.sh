#!/usr/bin/env bash
# operator-nav-feishu-qr-smoke.sh
# 验证：operator-dashboard feature flag + QR 飞书推送函数 + session 告警改飞书
#
# 退出码：0=全过 1=feature flag 缺失 2=QR 推送函数缺失 3=Bark 残留 4=webhook 变量正确
set -uo pipefail

INSTANCE_CTX="apps/dashboard/src/contexts/InstanceContext.tsx"
QR_PUBLISHER="services/agent/publishers/qr-bind-operator.cjs"
SESSION_VERIFY="scripts/sessions/verify-operator-douyin.js"
WORKFLOW="./github/workflows/douyin-operator-session-e2e.yml"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  operator-nav-feishu-qr smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "▶ [1/4] operator-dashboard feature flag 已开启"
node -e "
const s = require('fs').readFileSync('${INSTANCE_CTX}', 'utf8');
if (!s.match(/'operator-dashboard'\s*:\s*true/)) {
  console.error('FAIL: operator-dashboard feature flag 未开启');
  process.exit(1);
}
console.log('OK: operator-dashboard: true 已设置');
" || exit 1

echo "▶ [2/4] QR publisher 包含 sendFeishuQrCard 函数"
node -e "
const s = require('fs').readFileSync('${QR_PUBLISHER}', 'utf8');
if (!s.includes('sendFeishuQrCard')) {
  console.error('FAIL: sendFeishuQrCard 函数不存在');
  process.exit(1);
}
if (!s.includes('ZENITHJOY_FEISHU_WEBHOOK')) {
  console.error('FAIL: ZENITHJOY_FEISHU_WEBHOOK 环境变量未引用');
  process.exit(1);
}
if (!s.includes('app_access_token')) {
  console.error('FAIL: 飞书 token 获取逻辑不存在');
  process.exit(1);
}
console.log('OK: sendFeishuQrCard + ZENITHJOY_FEISHU_WEBHOOK + token 逻辑均存在');
" || exit 2

echo "▶ [3/4] session 验证脚本已移除 Bark，改用飞书"
node -e "
const s = require('fs').readFileSync('${SESSION_VERIFY}', 'utf8');
if (s.includes('BARK_URL') || s.includes('barkNotify') || s.includes('api.day.app')) {
  console.error('FAIL: Bark 相关代码仍存在（BARK_URL / barkNotify / api.day.app）');
  process.exit(1);
}
if (!s.includes('ZENITHJOY_FEISHU_WEBHOOK')) {
  console.error('FAIL: ZENITHJOY_FEISHU_WEBHOOK 未引用');
  process.exit(1);
}
console.log('OK: Bark 已移除，ZENITHJOY_FEISHU_WEBHOOK 已到位');
" || exit 3

echo "▶ [4/4] navigation config 包含 /operator 路由 + operator-dashboard featureKey"
node -e "
const navPath = 'apps/dashboard/src/config/navigation.config.ts';
const s = require('fs').readFileSync(navPath, 'utf8');
if (!s.includes(\"'operator-dashboard'\") && !s.includes('\"operator-dashboard\"')) {
  console.error('FAIL: navigation.config.ts 未包含 operator-dashboard featureKey');
  process.exit(1);
}
if (!s.includes('/operator')) {
  console.error('FAIL: navigation.config.ts 未包含 /operator 路径');
  process.exit(1);
}
console.log('OK: /operator + operator-dashboard featureKey 均已注册');
" || exit 4

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ operator-nav-feishu-qr smoke PASS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
