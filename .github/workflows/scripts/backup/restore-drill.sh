#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# G2 / A5 恢复演练 —— 真 pg_dump → 真还原到临时库 → 路③ 五表逐条比对全等
#
# 回执不是 `pg_dump` 的退出码。备份"跑成功了"但内容缺 schema、缺表、只有表结构没有数据，
# 全都能拿到退出码 0；真出事那一刻才发现备份是空的，而 G2 的全部意义就在那一刻。
# 所以判据是「从这份备份还原出来的库，跟源库逐行一模一样」。
#
# 三层判定，缺一层这条演练就作废：
#   ① 有得可比：源库五表逐表 count(*) > 0（空表上 0 == 0 恒真，--schema-only 也能全绿）
#   ② 比得相等：逐表 count 全等 + 关键字段排序后 md5 全等
#   ③ 逐行可查：还原库按本轮标记查到那行，且字段值与源库逐字相同
#      （只比行数会漏掉"行在但内容烂"，正是"退出码看不出缺内容"的同类洞）
#
# 演练前必须自己种数据：db_rows / db_view_prefs / db_audit 在 Sprint A 根本没有写入路径
# （Sprint B/C 才写），演练那一刻必然是空表。等业务端点来种 = 永远等不到。
#
# 用法：bash restore-drill.sh
# 环境：E2E_DATABASE_URL 或 DATABASE_URL（未设即报错退出，绝不落默认库）
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "❌ FAIL: $*"; exit 1; }
ok()   { echo "  ✅ $*"; }

for bin in psql pg_dump pg_restore createdb dropdb python3; do
  command -v "$bin" >/dev/null 2>&1 || fail "缺少必需命令：$bin"
done

if [ -n "${E2E_DATABASE_URL:-}" ]; then
  SRC_URL="$E2E_DATABASE_URL"; SRC_FROM="E2E_DATABASE_URL"
elif [ -n "${DATABASE_URL:-}" ]; then
  SRC_URL="$DATABASE_URL"; SRC_FROM="DATABASE_URL"
else
  fail "未设 E2E_DATABASE_URL / DATABASE_URL —— 拒绝落默认库跑成假绿"
fi

psql "$SRC_URL" -v ON_ERROR_STOP=1 -q -c "SELECT 1" >/dev/null 2>&1 \
  || fail "源库连不上（来源=${SRC_FROM}）"
echo "  源库连接串来源：${SRC_FROM}"

# 临时库的连接串从源库连接串推导：只换库名，主机/端口/账号一律沿用，
# 这样"能连源库就能连临时库"，不需要再引入任何写死的连接信息。
DRILL_DB="wb_drill_$(date +%s)_${RANDOM}"
TMP_URL=$(python3 - "$SRC_URL" "$DRILL_DB" <<'PY'
import sys, urllib.parse as up
u = up.urlparse(sys.argv[1])
print(up.urlunparse(u._replace(path='/' + sys.argv[2])))
PY
)
ADMIN_URL=$(python3 - "$SRC_URL" <<'PY'
import sys, urllib.parse as up
u = up.urlparse(sys.argv[1])
print(up.urlunparse(u._replace(path='/postgres')))
PY
)
[ -n "$TMP_URL" ] && [ -n "$ADMIN_URL" ] || fail "临时库连接串推导失败"

DRILL_RUN_ID="$(date +%s)${RANDOM}"
MARKER="WB-DRILL-${DRILL_RUN_ID}"
DUMP_FILE="$(mktemp -t wb-drill-XXXXXX).dump"

TENANT_ID=""
TABLE_ID=""

cleanup() {
  # 备份产物**故意不删**：db-backup.yml 在 job 末尾把它收进 artifact（14 天保留）。
  # 删了就只剩"演练说自己过了"，拿不到那份可以真去还原的备份。落在 /tmp，CI 用完即弃。
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$DRILL_DB\"" >/dev/null 2>&1
  if [ -n "$TENANT_ID" ]; then
    # 顺序照外键：审计/偏好/行/字段 → 表 → 租户
    for t in db_audit db_view_prefs db_rows db_fields db_tables; do
      psql "$SRC_URL" -q -c "DELETE FROM zenithjoy.$t WHERE org_id = '$TENANT_ID'" >/dev/null 2>&1
    done
    psql "$SRC_URL" -q -c "DELETE FROM zenithjoy.tenants WHERE id = '$TENANT_ID'" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

psql_q() { psql "$SRC_URL" -t -A -q -c "$1"; }

echo "== 1/5 种可判别数据（标记 ${MARKER}）=="
TENANT_ID=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('$MARKER-org', '$MARKER-lk', 'free') RETURNING id")
[ -n "$TENANT_ID" ] || fail "临时租户建不出来"
TABLE_ID=$(psql_q "INSERT INTO zenithjoy.db_tables (org_id, name, visibility, owner_member_id) VALUES ('$TENANT_ID', '$MARKER-table', 'org', '$MARKER-member') RETURNING id")
[ -n "$TABLE_ID" ] || fail "db_tables 种子行建不出来"
psql "$SRC_URL" -v ON_ERROR_STOP=1 -q -c "
  INSERT INTO zenithjoy.db_fields (table_id, org_id, name, field_type, options, display_order)
    VALUES ('$TABLE_ID', '$TENANT_ID', '$MARKER-field', 'text', '[]'::jsonb, 0);
  INSERT INTO zenithjoy.db_rows (table_id, org_id, data)
    VALUES ('$TABLE_ID', '$TENANT_ID', jsonb_build_object('marker', '$MARKER'));
  INSERT INTO zenithjoy.db_view_prefs (table_id, org_id, member_id, prefs)
    VALUES ('$TABLE_ID', '$TENANT_ID', '$MARKER-member', jsonb_build_object('marker', '$MARKER'));
  INSERT INTO zenithjoy.db_audit (org_id, table_id, member_id, action, detail)
    VALUES ('$TENANT_ID', '$TABLE_ID', '$MARKER-member', '$MARKER-action', jsonb_build_object('marker', '$MARKER'));
" >/dev/null || fail "五表种子行写入失败"

TABLES=(db_tables db_fields db_rows db_view_prefs db_audit)

# 关键字段口径（合同 Step8 硬阈值逐字）：只比行数会放过"行在但内容烂"。
key_expr() {
  case "$1" in
    db_tables)     echo "id::text || ',' || org_id::text || ',' || name || ',' || visibility || ',' || coalesce(deleted_at::text, '')";;
    db_fields)     echo "id::text || ',' || table_id::text || ',' || org_id::text || ',' || name || ',' || field_type || ',' || display_order::text";;
    db_rows)       echo "id::text || ',' || org_id::text || ',' || data::text";;
    db_view_prefs) echo "id::text || ',' || org_id::text || ',' || prefs::text";;
    db_audit)      echo "id::text || ',' || org_id::text || ',' || action || ',' || detail::text";;
  esac
}

echo "== 2/5 第①层：源库五表都有得可比 =="
for t in "${TABLES[@]}"; do
  C=$(psql_q "SELECT count(*) FROM zenithjoy.$t")
  case "$C" in ''|*[!0-9]*) fail "zenithjoy.$t 计数不可读（got='$C'）";; esac
  [ "$C" -gt 0 ] || fail "zenithjoy.$t 演练时是空表 —— count 全等在空表上恒真（0==0），备份缺内容看不出来"
  M=$(psql_q "SELECT count(*) FROM zenithjoy.$t WHERE ($(key_expr "$t")) LIKE '%$MARKER%'")
  [ "${M:-0}" -ge 1 ] || fail "zenithjoy.$t 无本轮 $MARKER 标记行 —— 种子没种上"
  ok "zenithjoy.$t count=${C}，含本轮标记行"
done

echo "== 3/5 真 pg_dump =="
# MUTATION-ANCHOR:A5-schema-only —— 变异把下一行改成 (--schema-only)，
# 备份里就只剩表结构没有数据，第③层逐行比对必须当场报红。
DUMP_MODE_ARGS=()
pg_dump "$SRC_URL" --format=custom --schema=zenithjoy "${DUMP_MODE_ARGS[@]+"${DUMP_MODE_ARGS[@]}"}" --file="$DUMP_FILE" \
  || fail "pg_dump 失败"
[ -s "$DUMP_FILE" ] || fail "备份产物为空文件"
ok "备份产物 $(wc -c < "$DUMP_FILE" | tr -d ' ') 字节"

echo "== 4/5 真还原到临时库 $DRILL_DB =="
createdb "$DRILL_DB" 2>/dev/null || psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$DRILL_DB\"" \
  || fail "临时库建不出来"
# pg_restore 对已存在对象会报 warning，非致命；真正的判据在下一段的逐行比对。
pg_restore --dbname="$TMP_URL" --no-owner --no-privileges "$DUMP_FILE" >/dev/null 2>&1
psql "$TMP_URL" -v ON_ERROR_STOP=1 -q -c "SELECT 1" >/dev/null 2>&1 || fail "临时库还原后连不上"

echo "== 5/5 第②③层：逐表 count 全等 + 关键字段 md5 全等 + 标记行逐字相同 =="
for t in "${TABLES[@]}"; do
  EXPR=$(key_expr "$t")

  SRC_C=$(psql "$SRC_URL" -t -A -q -c "SELECT count(*) FROM zenithjoy.$t")
  DST_C=$(psql "$TMP_URL" -t -A -q -c "SELECT count(*) FROM zenithjoy.$t" 2>/dev/null)
  case "$DST_C" in ''|*[!0-9]*) fail "还原库里读不到 zenithjoy.${t}（got='$DST_C'）—— 备份缺这张表";; esac
  [ "$SRC_C" = "$DST_C" ] || fail "zenithjoy.$t 行数不等：源=$SRC_C 还原=$DST_C"

  SRC_H=$(psql "$SRC_URL" -t -A -q -c "SELECT md5(coalesce(string_agg(k, '|' ORDER BY k), '')) FROM (SELECT ($EXPR) AS k FROM zenithjoy.$t) s")
  DST_H=$(psql "$TMP_URL" -t -A -q -c "SELECT md5(coalesce(string_agg(k, '|' ORDER BY k), '')) FROM (SELECT ($EXPR) AS k FROM zenithjoy.$t) s" 2>/dev/null)
  [ -n "$SRC_H" ] && [ -n "$DST_H" ] || fail "zenithjoy.$t 关键字段 md5 算不出来（源='$SRC_H' 还原='$DST_H'）"
  [ "$SRC_H" = "$DST_H" ] || fail "zenithjoy.$t 关键字段 md5 不等：源=$SRC_H 还原=$DST_H"

  SRC_ROW=$(psql "$SRC_URL" -t -A -q -c "SELECT ($EXPR) FROM zenithjoy.$t WHERE ($EXPR) LIKE '%$MARKER%' ORDER BY 1 LIMIT 1")
  DST_ROW=$(psql "$TMP_URL" -t -A -q -c "SELECT ($EXPR) FROM zenithjoy.$t WHERE ($EXPR) LIKE '%$MARKER%' ORDER BY 1 LIMIT 1" 2>/dev/null)
  [ -n "$DST_ROW" ] || fail "还原库 zenithjoy.$t 查不到本轮 $MARKER 标记行 —— 备份里只有表结构没有数据"
  [ "$SRC_ROW" = "$DST_ROW" ] || fail "zenithjoy.$t 标记行字段值不同：源='$SRC_ROW' 还原='$DST_ROW'"

  ok "zenithjoy.$t count=$SRC_C md5 全等，标记行逐字相同"
done

echo "✅ A5 恢复演练通过：五表非空、行数全等、关键字段 md5 全等、标记行逐字回读（run=${DRILL_RUN_ID}）"
