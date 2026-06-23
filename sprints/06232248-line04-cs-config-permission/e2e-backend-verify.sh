#!/bin/bash
# Line04 客服配置写接口安全闸 — 后端 E2E（ubuntu-latest + postgres:15 service）
# 核心：越权（member / 跨租户 / 无 session / 解析不出目标）一律拒绝且 DB 未变（钉死 Issue 96db53be）。
set -euo pipefail
API=${API_BASE:-http://localhost:3000}
DB=${DATABASE_URL:?FAIL: DATABASE_URL 未注入（应由 ubuntu postgres service 提供）}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"

echo "── 0. 装依赖 + 构建 + 迁移 + 启服务 ──"
npm ci --workspace=apps/api
( cd apps/api && npm run build && npm run migrate )
( cd apps/api && node dist/index.js >/tmp/api.log 2>&1 & echo $! >/tmp/api.pid )
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/health" 2>/dev/null || echo 000)
  [ "$CODE" = "200" ] && { echo "ready after ${i}s"; break; }
  [ "$i" = 30 ] && { echo "FAIL: 中台 30s 未就绪 code=$CODE"; cat /tmp/api.log; exit 1; }
  sleep 1
done

echo "── 0b. 种入 tenant-A 的 admin/member + tenant-A 客服 wxid_csa / tenant-B 客服 wxid_csb ──"
psql "$DB" -f sprints/06232248-line04-cs-config-permission/seed-e2e.sql

PERSONA='{"self_name":"小齐","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]}'
BODY=$(jq -n --argjson p "$PERSONA" '{persona:$p, business_hours_start:"09:00", business_hours_end:"21:00", daily_limit:50, whitelist:["客户甲"]}')

echo "── 1. 管理员正常路径：tenant-A admin 改 tenant-A 客服 → 200 + DB 写入（时间窗防伪）──"
curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' \
  -H 'X-Feishu-User-Id: user-admin-A' -d "$BODY" | jq -e '.success == true'
C=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_csa' AND business_hours_start='09:00' AND daily_limit=50 AND updated_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C" = "1" ] || { echo "FAIL: 管理员写入未生效/无时间窗内记录 cnt=$C"; exit 1; }

echo "── 2. 越权核心：member 改 → 403 NOT_ADMIN 且 DB 未变（钉死 96db53be）──"
BEFORE=$(psql "$DB" -t -c "SELECT updated_at FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_csa'" | tr -d ' ')
CODE=$(curl -s -o /tmp/m.json -w '%{http_code}' -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' -H 'X-Feishu-User-Id: user-member-A' -d "$BODY")
[ "$CODE" = "403" ] || { echo "FAIL: member 未被拒 code=$CODE"; exit 1; }
jq -e '.error.code == "NOT_ADMIN"' /tmp/m.json
AFTER=$(psql "$DB" -t -c "SELECT updated_at FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_csa'" | tr -d ' ')
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: member 越权后 DB 被改 before=$BEFORE after=$AFTER"; exit 1; }

echo "── 3. 租户隔离：tenant-A admin 改 tenant-B 客服 wxid_csb → 403/404 且 DB 未变 ──"
CODE=$(curl -s -o /tmp/x.json -w '%{http_code}' -X PUT "$API/api/wechat/cs/config/wxid_csb" -H 'Content-Type: application/json' -H 'X-Feishu-User-Id: user-admin-A' -d "$BODY")
case "$CODE" in 403|404) : ;; *) echo "FAIL: 跨租户未被拒 code=$CODE"; exit 1;; esac
XC=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_csb' AND updated_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$XC" = "0" ] || { echo "FAIL: 跨租户越权写入了 B 的行 cnt=$XC"; exit 1; }

echo "── 4. 无 session → 401 ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' -d "$BODY")
[ "$CODE" = "401" ] || { echo "FAIL: 无 session 未 401 code=$CODE"; exit 1; }

echo "── 5. deny by default：目标客服解析不到租户 → 404 TARGET_NOT_FOUND 且不写库 ──"
CODE=$(curl -s -o /tmp/d.json -w '%{http_code}' -X PUT "$API/api/wechat/cs/config/wxid_never_zzz" -H 'Content-Type: application/json' -H 'X-Feishu-User-Id: user-admin-A' -d "$BODY")
[ "$CODE" = "404" ] || { echo "FAIL: 解析不出目标未 404 code=$CODE"; exit 1; }
jq -e '.error.code == "TARGET_NOT_FOUND"' /tmp/d.json
# gate-allow: domain/db-no-time-window wxid_never_zzz 是从不存在的目标，deny-by-default 断言要求全时段 count==0（任何时间都不许有该行）；加 5 分钟时间窗反而会漏过历史泄漏行，全时段计数才是更强且正确的 oracle
DC=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_never_zzz'" | tr -d ' ')
[ "$DC" = "0" ] || { echo "FAIL: deny-by-default 仍写了库 cnt=$DC"; exit 1; }

# gate-allow: cheat/or-true 这是 teardown — 清理后台 API 进程，非断言；进程已退时 kill 失败必须忽略（不影响越权/隔离/deny 等真实验收结论）
kill "$(cat /tmp/api.pid)" 2>/dev/null || true
echo "✅ job1 后端全过：管理员写入(时间窗) + member 403 不写库 + 跨租户 403 不写库 + 无 session 401 + deny-by-default 404 不写库"
