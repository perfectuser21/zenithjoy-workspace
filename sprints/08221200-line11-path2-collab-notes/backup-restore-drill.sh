#!/usr/bin/env bash
# 路② G2 备份恢复演练（A7 / L2）—— 真 pg_dump documents(+document_members) → 还原临时库 → 逐字段比对
#
# 比对字段（合同 A7 逐条）：content jsonb / crdt_state bytea / org_id / visibility / parent_id /
# deleted_at / ai_retrieval_opt_out。任一不一致即 exit≠0。演练进 cron（.github/workflows/db-backup.yml 引用）。
#
# 环境：E2E_DATABASE_URL / DATABASE_URL 指向含 zenithjoy.documents 的库；同 server 上建临时库还原。
set -euo pipefail

PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$PG" ]; then
  echo "[backup-drill] 需要 E2E_DATABASE_URL / DATABASE_URL" >&2
  exit 2
fi

TMPDB="zj_bkdrill_$$"
# 临时库连接串：把源连接串的 dbname 换成 TMPDB（用 node 稳妥改写，避免 bash URL 解析踩坑）
TMP_URL="$(node -e "const u=new URL(process.argv[1]);u.pathname='/'+process.argv[2];process.stdout.write(u.toString())" "$PG" "$TMPDB")"
WORK="$(mktemp -d)"
DUMP="$WORK/documents.dump.sql"
DOC_ID="00000000-0000-0000-0000-0000000d1111"
ORG_ID="00000000-0000-0000-0000-0000000d0a99"

cleanup() {
  psql "$PG" -v ON_ERROR_STOP=0 -q -c "DELETE FROM zenithjoy.document_members WHERE doc_id='$DOC_ID';" >/dev/null 2>&1 || true
  psql "$PG" -v ON_ERROR_STOP=0 -q -c "DELETE FROM zenithjoy.documents WHERE id='$DOC_ID';" >/dev/null 2>&1 || true
  psql "$PG" -v ON_ERROR_STOP=0 -q -c "DROP DATABASE IF EXISTS $TMPDB;" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "[backup-drill] 1) 种一行可比对的 documents（含 content jsonb + crdt_state bytea + 7 字段）"
psql "$PG" -v ON_ERROR_STOP=1 -q -c "
  INSERT INTO zenithjoy.documents
    (id, org_id, parent_id, title, owner_member_id, visibility, content, crdt_state, ai_retrieval_opt_out, deleted_at)
  VALUES
    ('$DOC_ID', '$ORG_ID', NULL, 'bkdrill', 'ou_bkdrill', 'members',
     '{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"备份演练正文\"}]}]}'::jsonb,
     decode('deadbeef01', 'hex'), true, NULL)
  ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content, crdt_state=EXCLUDED.crdt_state;
  INSERT INTO zenithjoy.document_members (doc_id, member_id) VALUES ('$DOC_ID','ou_bkdrill_member')
  ON CONFLICT (doc_id, member_id) DO NOTHING;
"

echo "[backup-drill] 2) pg_dump 两表（schema + data）"
pg_dump -t zenithjoy.documents -t zenithjoy.document_members "$PG" > "$DUMP"

echo "[backup-drill] 3) 建临时库 + zenithjoy schema + pgcrypto，还原"
psql "$PG" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $TMPDB;"
psql "$TMP_URL" -v ON_ERROR_STOP=1 -q -c "CREATE SCHEMA IF NOT EXISTS zenithjoy; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
psql "$TMP_URL" -v ON_ERROR_STOP=1 -q -f "$DUMP" >/dev/null

echo "[backup-drill] 4) 逐字段比对（content/crdt_state/org_id/visibility/parent_id/deleted_at/ai_retrieval_opt_out）"
SEL="SELECT md5(concat_ws('|',
  content::text,
  encode(crdt_state,'hex'),
  org_id::text,
  visibility,
  COALESCE(parent_id::text,'NULL'),
  COALESCE(deleted_at::text,'NULL'),
  ai_retrieval_opt_out::text
)) FROM zenithjoy.documents WHERE id='$DOC_ID';"

SRC_MD5="$(psql "$PG" -tAq -c "$SEL")"
DST_MD5="$(psql "$TMP_URL" -tAq -c "$SEL")"
echo "[backup-drill] src=$SRC_MD5 dst=$DST_MD5"

# document_members 也比一把行数
SRC_MEM="$(psql "$PG" -tAq -c "SELECT count(*) FROM zenithjoy.document_members WHERE doc_id='$DOC_ID';")"
DST_MEM="$(psql "$TMP_URL" -tAq -c "SELECT count(*) FROM zenithjoy.document_members WHERE doc_id='$DOC_ID';")"

if [ -z "$SRC_MD5" ] || [ "$SRC_MD5" != "$DST_MD5" ]; then
  echo "[backup-drill] ❌ documents 七字段还原后不一致" >&2
  exit 1
fi
if [ "$SRC_MEM" != "$DST_MEM" ]; then
  echo "[backup-drill] ❌ document_members 行数不一致 src=$SRC_MEM dst=$DST_MEM" >&2
  exit 1
fi

echo "[backup-drill] ✅ 备份→还原→七字段逐条一致（documents + document_members）"
exit 0
