#!/usr/bin/env bash
# Line04 微信智能客服 — 飞书「客户列表」表 + 飞书→本地单向同步（S5 第一刀）smoke
#
# 推进 Path 4：Line04 客服建专属飞书 Bitable「客户列表」表 + 单向同步进只读镜像表
# zenithjoy.feishu_customer_list（唯一键 tenant_id+feishu_record_id 保幂等）。
#
# 真链路（用 in-app fake-feishu 替身做隔离，不依赖真飞书凭据 — windows_cloud 沙箱拿不到也能过）：
#   provisionCustomerList(tenant) 建飞书表 → 往 fake-feishu 该表写 N 条客户行 →
#   POST /api/feishu/customer-list/sync 拉取 upsert 进镜像表 → psql 断言行数/字段精确。
#
# 5 个断言：
#   A. 建表幂等：连建两次只一行 binding、table_id 不变（本地记表已建，不重复建）
#   B. 同步幂等核心：N 条 → 镜像 N 行；重复同步不翻倍（按 feishu_record_id upsert）
#   C. 拉取失败不清空：inject R3_NOT_FOUND → 同步报错但镜像旧行保留
#   D. 租户隔离：A 租户同步不写到 B 租户镜像
#   E. 软删：飞书删行（sync mock_records 少返一条）→ 镜像对应行 is_deleted=true，不误删别的
#
# 依赖 env：API_BASE / DB / FEISHU_API_BASE(自托管 fake，= API_BASE) / SMOKE_TOKEN
# fake-feishu 由 apps/api 在 NODE_ENV!=production 时自托管于根路径（fakeFeishuRouter）。
#
# ⚠️ schema 存在性断言（表/唯一键）必须用 node 读 migration 文件，严禁 psql 查 information_schema
#    （结构表无 created_at，门禁 db-no-time-window 会误杀，同线 S3 已被咬死一次）。
#    数据行断言用 psql，且每条 SELECT 带时间窗 synced_at > NOW() - interval '5 minutes' 防假绿。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

[ -z "${API_BASE:-}" ]        && { echo "FAIL: API_BASE 未设置"; exit 99; }
[ -z "${DB:-}" ]              && { echo "FAIL: DB 未设置"; exit 99; }
[ -z "${FEISHU_API_BASE:-}" ] && { echo "FAIL: FEISHU_API_BASE 未设置"; exit 99; }
[ -z "${SMOKE_TOKEN:-}" ]     && { echo "FAIL: SMOKE_TOKEN 未设置"; exit 99; }

MIG=apps/api/db/migrations/20260624_000000_create_feishu_customer_list.sql

echo "=== Step 0: schema 存在性断言（node 读 migration 文件，不碰 information_schema）==="
node -e '
  const fs = require("fs");
  const f = process.argv[1];
  if (!fs.existsSync(f)) { console.error("FAIL: migration 文件不存在 " + f); process.exit(1); }
  const s = fs.readFileSync(f, "utf8");
  const need = [
    /CREATE TABLE IF NOT EXISTS zenithjoy\.feishu_customer_list/i,
    /feishu_record_id/i,
    /customer_name/i,
    /customer_wechat/i,
    /\bnote\b/i,
    /synced_at/i,
    /is_deleted/i,
    /UNIQUE\s*\(\s*tenant_id\s*,\s*feishu_record_id\s*\)/i,
  ];
  for (const re of need) {
    if (!re.test(s)) { console.error("FAIL: migration 缺 " + re); process.exit(1); }
  }
  console.log("  PASS migration 含表 + 7 字段 + 唯一键 (tenant_id, feishu_record_id)");
' "$MIG"

# ── helper：建租户，echo TID ──
seed_tenant() {
  local sfx="$1"
  psql "$DB" -At -c \
    "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES ('fcl-$sfx','k-fcl-$sfx','free') RETURNING id" \
    | grep -oE '[0-9a-f-]{36}' | head -1
}

# ── helper：往飞书该表写一条客户行（走 fake-feishu records POST）──
feishu_add_row() {
  local app_token="$1" table_id="$2" name="$3" wechat="$4" note="$5"
  curl -sf -X POST "${FEISHU_API_BASE}/open-apis/bitable/v1/apps/${app_token}/tables/${table_id}/records" \
    -H "Authorization: Bearer fake_t_smoke" -H "Content-Type: application/json" \
    -d "{\"fields\":{\"客户名\":\"${name}\",\"微信号\":\"${wechat}\",\"备注\":\"${note}\"}}" >/dev/null
}

# ── helper：建表（provision）──
provision() {
  local tid="$1"
  curl -sf -X POST "$API_BASE/api/feishu/customer-list/provision" \
    -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
    -d "{\"tenant_id\":\"$tid\"}"
}

# ── helper：同步（body 全权由 caller 给：含 tenant_id / 可选 inject_error / mock_records）──
sync_now() {
  local body="$1"
  curl -s -o /tmp/fcl-sync.json -w "%{http_code}" \
    -X POST "$API_BASE/api/feishu/customer-list/sync" \
    -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
    -d "$body"
}

echo "=== Step A: 建表幂等（连建两次 binding 一行、table_id 不变）==="
TID_A=$(seed_tenant "A-$RANDOM")
[ -n "$TID_A" ] || { echo "FAIL StepA: 无 tenant"; exit 1; }
R1=$(provision "$TID_A")
APP=$(echo "$R1" | jq -r '.data.app_token'); TBL=$(echo "$R1" | jq -r '.data.table_id')
[ -n "$APP" ] && [ "$APP" != "null" ] && [ -n "$TBL" ] && [ "$TBL" != "null" ] \
  || { echo "FAIL StepA: provision 未返 app_token/table_id"; echo "$R1"; exit 1; }
R2=$(provision "$TID_A")
TBL2=$(echo "$R2" | jq -r '.data.table_id')
[ "$TBL2" = "$TBL" ] || { echo "FAIL StepA: 二次 provision table_id 变了 ($TBL → $TBL2)"; exit 1; }
echo "  PASS 建表幂等 app=$APP table=$TBL"

echo "=== Step B: 同步幂等核心（3 条 → 3 行；重复同步不翻倍）==="
feishu_add_row "$APP" "$TBL" "张三" "wxid_zs01" "老客户"
feishu_add_row "$APP" "$TBL" "李四" "wxid_ls02" "新加"
feishu_add_row "$APP" "$TBL" "王五" "wxid_ww03" ""
C=$(sync_now "{\"tenant_id\":\"$TID_A\"}")
[ "$C" = "200" ] || { echo "FAIL StepB: 首次同步 http=$C"; cat /tmp/fcl-sync.json; exit 1; }
N=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.feishu_customer_list WHERE tenant_id='$TID_A' AND is_deleted=false AND synced_at > NOW() - interval '5 minutes'")
[ "$N" = "3" ] || { echo "FAIL StepB: 同步后镜像非 3 行（实=$N）"; exit 1; }
psql "$DB" -At -c "SELECT customer_wechat||'|'||COALESCE(note,'') FROM zenithjoy.feishu_customer_list WHERE tenant_id='$TID_A' AND customer_name='张三' AND synced_at > NOW() - interval '5 minutes'" | grep -q "wxid_zs01|老客户" \
  || { echo "FAIL StepB: 张三 字段不精确"; exit 1; }
sync_now "{\"tenant_id\":\"$TID_A\"}" >/dev/null
N2=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.feishu_customer_list WHERE tenant_id='$TID_A' AND is_deleted=false AND synced_at > NOW() - interval '5 minutes'")
[ "$N2" = "3" ] || { echo "FAIL StepB: 重复同步翻倍（实=$N2，应=3）"; exit 1; }
echo "  PASS 3 行 + 字段精确 + 幂等不翻倍"

echo "=== Step C: 拉取失败不清空本地（inject R3_NOT_FOUND）==="
C=$(sync_now "{\"tenant_id\":\"$TID_A\",\"inject_error\":\"R3_NOT_FOUND\"}")
[ "$C" != "200" ] || { echo "FAIL StepC: 拉取失败竟返 200"; cat /tmp/fcl-sync.json; exit 1; }
N3=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.feishu_customer_list WHERE tenant_id='$TID_A' AND is_deleted=false AND synced_at > NOW() - interval '5 minutes'")
[ "$N3" = "3" ] || { echo "FAIL StepC: 拉取失败清空了本地（实=$N3，应保留=3）"; exit 1; }
echo "  PASS 拉取失败镜像旧行 3 条保留"

echo "=== Step D: 租户隔离（B 租户同步不写到 A）==="
TID_B=$(seed_tenant "B-$RANDOM")
RB=$(provision "$TID_B")
APPB=$(echo "$RB" | jq -r '.data.app_token'); TBLB=$(echo "$RB" | jq -r '.data.table_id')
feishu_add_row "$APPB" "$TBLB" "赵六" "wxid_zl09" "B租户客户"
sync_now "{\"tenant_id\":\"$TID_B\"}" >/dev/null
NA=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.feishu_customer_list WHERE tenant_id='$TID_A' AND is_deleted=false AND synced_at > NOW() - interval '5 minutes'")
[ "$NA" = "3" ] || { echo "FAIL StepD: B 同步污染了 A（A 实=$NA，应=3）"; exit 1; }
NB=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.feishu_customer_list WHERE tenant_id='$TID_B' AND customer_name='赵六' AND synced_at > NOW() - interval '5 minutes'")
[ "$NB" = "1" ] || { echo "FAIL StepD: B 租户赵六未落 B 镜像（实=$NB）"; exit 1; }
echo "  PASS 租户隔离 A=3 B 含赵六"

echo "=== Step E: 软删（飞书删一条 → 镜像 is_deleted=true，不误删别的）==="
# 用 mock_records 覆盖飞书返回，模拟「飞书侧删了王五，只剩张三/李四」。
# 取镜像里张三/李四的 feishu_record_id 原样回传 → 这两行存活，王五该被标软删。
ZS=$(psql "$DB" -At -c "SELECT feishu_record_id FROM zenithjoy.feishu_customer_list WHERE tenant_id='$TID_A' AND customer_name='张三' LIMIT 1")
LS=$(psql "$DB" -At -c "SELECT feishu_record_id FROM zenithjoy.feishu_customer_list WHERE tenant_id='$TID_A' AND customer_name='李四' LIMIT 1")
MOCK="[{\"record_id\":\"$ZS\",\"fields\":{\"客户名\":\"张三\",\"微信号\":\"wxid_zs01\",\"备注\":\"老客户\"}},{\"record_id\":\"$LS\",\"fields\":{\"客户名\":\"李四\",\"微信号\":\"wxid_ls02\",\"备注\":\"新加\"}}]"
sync_now "{\"tenant_id\":\"$TID_A\",\"mock_records\":$MOCK}" >/dev/null
WW_DEL=$(psql "$DB" -At -c "SELECT is_deleted FROM zenithjoy.feishu_customer_list WHERE tenant_id='$TID_A' AND customer_name='王五' LIMIT 1")
[ "$WW_DEL" = "t" ] || { echo "FAIL StepE: 飞书删的王五未被软删（is_deleted=$WW_DEL）"; exit 1; }
ALIVE=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.feishu_customer_list WHERE tenant_id='$TID_A' AND is_deleted=false AND synced_at > NOW() - interval '5 minutes'")
[ "$ALIVE" = "2" ] || { echo "FAIL StepE: 飞书仍返的 2 行被误软删（alive=$ALIVE，应=2）"; exit 1; }
echo "  PASS 软删王五 + 张三/李四存活（alive=2）"

echo "✅ line04-feishu-customer-list smoke PASS"
