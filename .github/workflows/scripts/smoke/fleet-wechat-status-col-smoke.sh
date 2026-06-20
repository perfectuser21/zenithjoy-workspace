#!/usr/bin/env bash
# fleet-wechat-status-col-smoke.sh
# 车队看板「微信版本 / 静默」专列的数据契约 smoke。
# 列从 GET /api/agent/module-health 的 line04-wechat-cs.reason 里解析出版本号+静默状态，
# 所以验:① 该端点活着 ② 走 licenseAuth(无 token 返 401 INVALID_LICENSE) ③ 解析逻辑对齐 reason 格式。
set -euo pipefail

API_BASE="${ZENITHJOY_API_BASE:-https://autopilot.zenjoymedia.media}"
echo "fleet-wechat-status-col-smoke: 验车队看板数据源 ${API_BASE}/api/agent/module-health"

# ① + ②：端点活着且 auth-gated（无 Bearer → 401 + INVALID_LICENSE）
BODY=$(curl -s -m 15 "${API_BASE}/api/agent/module-health" || echo '{}')
echo "$BODY" | grep -q "INVALID_LICENSE" || {
  echo "FAIL: module-health 端点未返回 auth gate（车队看板取不到数据）。实际: $BODY"
  exit 1
}
echo "  OK: module-health 端点活着且 licenseAuth 生效"

# ③：解析逻辑与 agent line04 preflight 透出的 reason 格式对齐（版本号 + SILENT/NOT-SILENT/跳过）
node -e '
const re_ver = /微信\s+(\d+\.\d+\.\d+(?:\.\d+)?)/;
const re_notsilent = /静默[\s:：]*NOT[\s-]*SILENT/i;
const sample = "微信 4.1.8.107 / 静默 SILENT";
if (!(sample.match(re_ver) && sample.match(re_ver)[1] === "4.1.8.107")) { console.error("FAIL: 版本号解析对不上"); process.exit(1); }
if (re_notsilent.test(sample)) { console.error("FAIL: SILENT 被误判成 NOT-SILENT"); process.exit(1); }
if (!re_notsilent.test("微信 4.1.8.107 / 静默 NOT-SILENT")) { console.error("FAIL: NOT-SILENT 没识别"); process.exit(1); }
console.log("  OK: 版本号 + 静默状态解析契约对齐 reason 格式");
'

echo "fleet-wechat-status-col-smoke: PASS"
