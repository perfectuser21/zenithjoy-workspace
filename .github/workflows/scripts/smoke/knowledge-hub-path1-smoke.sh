#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 员工知识中枢 路① 第一刀 smoke
#
#   A27  知识面源码里不许出现身份头名（静态守卫，--a27-only 可单独跑）
#   A30  员工目录一致性自检是 fail-closed 启动闸：四项成立才起得来，
#        四条变异各自把进程拦在 listen 之前（proven-to-fire，缺一条不算）
#   业务 登录签会话 → 无归属声明被拒 → 录入落账本 → 最近沉淀读到那一条 → 跨企业隔离
#
# 用法：
#   bash knowledge-hub-path1-smoke.sh              全部
#   bash knowledge-hub-path1-smoke.sh --a27-only   只跑 A27 静态守卫（无需 DB/服务）
#
# 为什么变异必须真起进程：只断言"服务起来了"是假绿——自检根本没实现时服务照样起。
# 只有反过来证明「破坏任一项 → 进程起不来且日志点名违规项」，这道闸才算真的存在。
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

KA="apps/api/src/middleware/knowledge-auth.ts"
KROUTE="apps/api/src/routes/knowledge.ts"
KFETCH="apps/staff-hub/src/lib/knowledgeFetch.ts"

fail() { echo "❌ FAIL: $*"; exit 1; }
ok()   { echo "  ✅ $*"; }

# ── A27：知识面三个文件里出现身份头名字面量即报红 ─────────────────────────────
# 判据放在源码层而不是行为层，是因为行为测试可以被"忘记补"，而源码里一旦出现这两个名字
# 就说明有人在知识面重新引入了可伪造的身份来源，那正是本条 GP 的命门。
run_a27() {
  echo "== A27 静态守卫：知识面源码零身份头名 =="
  local hit=0
  for f in "$KA" "$KROUTE" "$KFETCH"; do
    [ -f "$f" ] || fail "A27 扫描目标不存在：$f"
    if grep -qiE 'x-user-email|x-feishu-user-id' "$f"; then
      echo "  ❌ $f 出现身份头名："
      grep -inE 'x-user-email|x-feishu-user-id' "$f" | sed 's/^/     /'
      hit=1
    else
      ok "$f 零身份头名"
    fi
  done
  [ "$hit" -eq 0 ] || fail "A27 守卫命中：知识面不许读任何身份头"
  echo "✅ A27 通过"
}

if [ "${1:-}" = "--a27-only" ]; then
  run_a27
  exit 0
fi

run_a27

# ── 环境前置 ────────────────────────────────────────────────────────────────
for bin in psql node python3 curl; do
  command -v "$bin" >/dev/null 2>&1 || fail "缺少必需命令：$bin"
done

# 连接串来源要说清楚：静默落到 localhost 默认值而人以为在测 CI 那个库，
# 是"跑绿了但根本没测到目标"的经典来源，所以把用的是哪一个打出来。
if [ -n "${E2E_DATABASE_URL:-}" ]; then
  PGURL="$E2E_DATABASE_URL"; PGSRC="E2E_DATABASE_URL"
elif [ -n "${DATABASE_URL:-}" ]; then
  PGURL="$DATABASE_URL"; PGSRC="DATABASE_URL"
else
  PGURL="postgresql://postgres@localhost:5432/cecelia"; PGSRC="内置默认（未设 E2E_DATABASE_URL / DATABASE_URL）"
fi
API_PORT="${KNOWLEDGE_SMOKE_PORT:-52310}"
MUT_PORT=$((API_PORT + 1))

# -q 不能省：没有它，INSERT ... RETURNING 会连命令状态行（"INSERT 0 1"）一起吐到 stdout，
# 拿去当 uuid 用就会把 STAFF_ORG_MAP 污染成一个查不到的值，表现为 A30-3 莫名报红。
psql_q() { psql "$PGURL" -t -A -q -c "$1"; }

# apps/api 只认 DATABASE_* 五个离散变量（不读 DATABASE_URL），从 PGURL 推导出来，
# 保证被拉起的子进程连的是同一个库。
DBENV_FILE=$(mktemp)
python3 - "$PGURL" > "$DBENV_FILE" <<'PY'
import sys, urllib.parse as up
u = up.urlparse(sys.argv[1])
print(f'export DATABASE_HOST={u.hostname or "localhost"}')
print(f'export DATABASE_PORT={u.port or 5432}')
print(f'export DATABASE_NAME={(u.path or "/cecelia").lstrip("/") or "cecelia"}')
print(f'export DATABASE_USER={up.unquote(u.username or "postgres")}')
print(f'export DATABASE_PASSWORD={up.unquote(u.password or "")}')
PY
# shellcheck source=/dev/null
. "$DBENV_FILE"

# 连得上才继续：连不上时后面每一步都会以五花八门的方式失败，不如在这里一次说清
psql "$PGURL" -v ON_ERROR_STOP=1 -q -c "SELECT 1" >/dev/null 2>&1 \
  || fail "数据库连不上（来源=${PGSRC} host=${DATABASE_HOST} db=${DATABASE_NAME}）"
echo "  DB: ${DATABASE_USER}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}（连接串来源：${PGSRC}）"

echo "== 0. 前置：dist 就绪 + migration + 两家企业 tenants 行 =="
if [ ! -f apps/api/dist/index.js ]; then
  echo "  apps/api/dist 缺失，现场构建（CI 正常路径里已 build 过，这里只兜本地直跑）"
  ( cd apps/api && npm run build >/dev/null 2>&1 ) || fail "apps/api build 失败"
fi
# 本 sprint 的两条 migration：只在"目标状态还没到"时补跑，避免和正规 migration runner
# （zenithjoy.schema_migrations 追踪）抢着执行同一个文件。两条 DDL 本身也都是幂等的
# （IF NOT EXISTS / SET DEFAULT），补跑一次不会破坏已有状态。
if [ -z "$(psql_q "SELECT to_regclass('zenithjoy.knowledge_entries_projection')")" ]; then
  echo "  投影表不存在，补跑 migration"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f apps/api/db/migrations/20260819_210000_knowledge_entries_projection.sql >/dev/null \
    || fail "投影表 migration 应用失败"
fi
if [ -z "$(psql_q "SELECT column_default FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='tenants' AND column_name='license_key'")" ]; then
  echo "  tenants.license_key 尚无默认值，补跑 migration"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f apps/api/db/migrations/20260819_210500_tenants_license_key_default.sql >/dev/null \
    || fail "tenants.license_key 默认值 migration 应用失败"
fi
NULLABLE=$(psql_q "SELECT is_nullable FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='knowledge_entries_projection' AND column_name='org_id'")
[ "$NULLABLE" = "NO" ] || fail "投影表 org_id 未 NOT NULL（got=${NULLABLE}）"
ok "投影表就位且 org_id NOT NULL"

# Cecelia 账本 public.learnings 属 cecelia repo，**不在本仓 migrations 里**，CI 的库不保证有它
# （合同「未覆盖真实链路清单」#4 已登记）。缺表时用本 sprint committed 的 fixture 建。
# 不建的话录入会正确地回 LEDGER_UNREACHABLE，整条业务链无处可写。
LEDGER=$(psql_q "SELECT to_regclass('public.learnings')")
if [ -z "$LEDGER" ]; then
  echo "  public.learnings 不存在，应用 sprint fixture 建表"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q \
    -f "sprints/08192114-员工知识中枢-路-经验沉淀与问答-ade79e4e/fixtures/learnings-ledger.sql" >/dev/null \
    || fail "账本 fixture DDL 应用失败"
  LEDGER=$(psql_q "SELECT to_regclass('public.learnings')")
fi
[ -n "$LEDGER" ] || fail "public.learnings 不存在且 fixture 未建成 —— 录入链路无处可写"
ok "Cecelia 账本表可达 ${LEDGER}"

SFX=$(date +%s)$RANDOM
ORGA_TENANT_ID=$(psql_q "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('KH-SMOKE-A-$SFX','free') RETURNING id")
ORGB_TENANT_ID=$(psql_q "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('KH-SMOKE-B-$SFX','free') RETURNING id")
[ -n "$ORGA_TENANT_ID" ] && [ -n "$ORGB_TENANT_ID" ] || fail "tenants 行未建成"

ORGA_OPENID="ou_khsmoke_orga_$SFX"
ORGA_EMAIL="khsmoke-orga-$SFX@zenithjoy.local"
ORGB_OPENID="ou_khsmoke_orgb_$SFX"
NOORG_OPENID="ou_khsmoke_noorg_$SFX"

# 员工目录：扁平名单恰好等于主企业那一组（A30-1a），无归属账号单列一个没有租户映射的
# NOORG 分组——它必须被目录声明过（否则 A30-1b 报红），但拿不到 tenant uuid，
# 于是登录时命中 NO_ORG_ASSIGNMENT。这正是「白名单里有他、但没人声明他属于哪家」的形状。
export STAFF_EMAILS="$ORGA_EMAIL"
export STAFF_FEISHU_OPENIDS="$ORGA_OPENID"
export STAFF_EMAILS__ORGA="$ORGA_EMAIL"
export STAFF_FEISHU_OPENIDS__ORGA="$ORGA_OPENID"
export STAFF_FEISHU_OPENIDS__ORGB="$ORGB_OPENID"
export STAFF_FEISHU_OPENIDS__NOORG="$NOORG_OPENID"
export STAFF_ORG_MAP="ORGA:$ORGA_TENANT_ID,ORGB:$ORGB_TENANT_ID"
export FEISHU_API_BASE="http://localhost:$API_PORT/api/_smoke/fake-feishu"
export FEISHU_APP_ID="kh-smoke-app-id"
export FEISHU_APP_SECRET="kh-smoke-app-secret"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-kh-smoke-secret-not-for-prod-32-characters}"
export NODE_ENV=development
ok "员工目录 env 就位 ORGA=${ORGA_TENANT_ID} ORGB=${ORGB_TENANT_ID}"

API_PID=""
cleanup() {
  rm -f "$DBENV_FILE"
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  psql "$PGURL" -q -c "DELETE FROM public.learnings WHERE metadata->>'org_id' IN ('$ORGA_TENANT_ID','$ORGB_TENANT_ID')" >/dev/null 2>&1
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.session WHERE \"userId\" IN ('$ORGA_OPENID','$ORGB_OPENID','$NOORG_OPENID')" >/dev/null 2>&1
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.\"user\" WHERE id IN ('$ORGA_OPENID','$ORGB_OPENID','$NOORG_OPENID')" >/dev/null 2>&1
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenant_members WHERE tenant_id IN ('$ORGA_TENANT_ID','$ORGB_TENANT_ID')" >/dev/null 2>&1
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenants WHERE id IN ('$ORGA_TENANT_ID','$ORGB_TENANT_ID')" >/dev/null 2>&1
}
trap cleanup EXIT

# ── A30 正向：四项成立 → 起得来，且日志证明自检真跑过 ─────────────────────────
echo "== 1. A30 正向：四项成立，服务起得来 =="
# 端口先得是空的：被别的进程占着时，我们起的实例绑不上，而健康检查会打到**那个陌生进程**
# 并愉快地返回 200 —— 于是整轮 smoke 测的是别人，还看着像绿的。宁可在这里报红。
if curl -sf -m 2 "http://localhost:$API_PORT/api/health" >/dev/null 2>&1; then
  fail "端口 $API_PORT 已被占用（改 KNOWLEDGE_SMOKE_PORT 或先停掉那个进程）——继续跑会验到别人的进程上去"
fi
PORT="$API_PORT" node apps/api/dist/index.js > /tmp/kh-smoke-api.log 2>&1 &
API_PID=$!
UP=0
for _ in $(seq 1 30); do
  curl -sf "http://localhost:$API_PORT/api/health" >/dev/null 2>&1 && { UP=1; break; }
  sleep 1
done
[ "$UP" = "1" ] || { tail -30 /tmp/kh-smoke-api.log; fail "A30 四项成立但服务未起"; }
# 只验端口通是假绿：没实现自检时服务照样起，必须看到自检自己的输出
grep -q "A30 staff-directory selfcheck passed" /tmp/kh-smoke-api.log \
  || { tail -30 /tmp/kh-smoke-api.log; fail "启动日志无 A30 自检通过标记，自检根本没跑"; }
# A30-2 归属唯一已退役（多组织切换第一刀·Gate 0 四处同刀：一人多企业已合法），只剩三项。
for k in A30-1a A30-1b A30-3; do
  grep -q "$k" /tmp/kh-smoke-api.log || fail "启动日志未列出检查项 $k"
done
ok "服务起来了，且三个检查项都在启动日志里（A30-2 归属唯一已退役）"

# ── A30 反向：三条变异各自把进程拦在 listen 之前 ──────────────────────────────
echo "== 2. A30 反向：三条变异 proven-to-fire =="
run_mutation() {
  local name="$1"; shift
  local log="/tmp/kh-smoke-mut-$name.log"
  local rc=0
  env "$@" PORT="$MUT_PORT" timeout 40 node apps/api/dist/index.js > "$log" 2>&1 || rc=$?
  # rc=0 进程正常退出、rc=124 被 timeout 杀掉（说明它 listen 住了）——两种都是没拦住
  [ "$rc" -ne 0 ]   || fail "变异 $name 未报红（进程正常启动）"
  [ "$rc" -ne 124 ] || fail "变异 $name 未报红（服务起来了，被 timeout 杀掉）"
  grep -q "$name" "$log" || { tail -20 "$log"; fail "变异 $name 报红但日志未指明违规项"; }
  ok "变异 $name proven-to-fire（exit=${rc}，日志点名 ${name}）"
}
run_mutation "A30-1a" STAFF_FEISHU_OPENIDS__ORGA="$ORGA_OPENID,ou_khsmoke_ghost"
run_mutation "A30-1b" STAFF_FEISHU_OPENIDS="$ORGA_OPENID,ou_khsmoke_orphan"
# A30-2 归属唯一变异已删（多组织切换第一刀退役）：同一身份出现在多个分组现在是合法的多组织归属，
# 不再拦启动，此变异不再 proven-to-fire。
run_mutation "A30-3"  STAFF_ORG_MAP="ORGA:00000000-0000-4000-8000-000000000000,ORGB:$ORGB_TENANT_ID"

# ── 业务链路 ────────────────────────────────────────────────────────────────
echo "== 3. 登录签会话 + 按声明组织入驻 =="
curl -sf -D /tmp/kh-smoke-login-hdr.txt -c /tmp/kh-smoke-cookie.txt \
  -X POST "http://localhost:$API_PORT/api/staff/feishu-login" \
  -H 'Content-Type: application/json' -d '{"code":"smoke-code-orga"}' -o /tmp/kh-smoke-login.json \
  || { cat /tmp/kh-smoke-login.json; fail "白名单员工登录失败"; }
for attr in HttpOnly Secure "SameSite=Lax"; do
  grep -i '^set-cookie:' /tmp/kh-smoke-login-hdr.txt | grep -qi "$attr" || fail "会话 cookie 缺属性 $attr"
done
MEMBER_ORG=$(psql_q "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id='$ORGA_OPENID'")
[ "$MEMBER_ORG" = "$ORGA_TENANT_ID" ] || fail "成员行挂错组织 got=$MEMBER_ORG want=$ORGA_TENANT_ID"
PERSONAL=$(psql_q "SELECT count(*) FROM zenithjoy.tenant_members tm JOIN zenithjoy.tenants t ON t.id=tm.tenant_id WHERE tm.feishu_user_id='$ORGA_OPENID' AND t.name LIKE 'Personal-%'")
[ "$PERSONAL" = "0" ] || fail "命中 Personal-% 租户 count=$PERSONAL"
ok "cookie 三属性齐全，成员行挂在声明组织，未落 Personal-%"

echo "== 4. 无归属声明的账号被拒（不签会话、不写成员行）=="
CODE=$(curl -s -o /tmp/kh-smoke-noorg.json -D /tmp/kh-smoke-noorg-hdr.txt -w '%{http_code}' \
  -X POST "http://localhost:$API_PORT/api/staff/feishu-login" \
  -H 'Content-Type: application/json' -d '{"code":"smoke-code-noorg"}')
[ "$CODE" = "403" ] || { cat /tmp/kh-smoke-noorg.json; fail "无归属声明期望 403 得到 $CODE"; }
grep -q 'NO_ORG_ASSIGNMENT' /tmp/kh-smoke-noorg.json || fail "错误码不是 NO_ORG_ASSIGNMENT"
grep -qi '^set-cookie:' /tmp/kh-smoke-noorg-hdr.txt && fail "拒绝路径仍签发会话"
MC=$(psql_q "SELECT count(*) FROM zenithjoy.tenant_members WHERE feishu_user_id='$NOORG_OPENID'")
[ "$MC" = "0" ] || fail "拒绝路径写了成员行 count=$MC"
ok "403 NO_ORG_ASSIGNMENT，零 cookie 零成员行"

echo "== 5. 身份只来自会话：伪造头无效且账本零新增 =="
C401=$(curl -s -o /tmp/kh-smoke-401.json -w '%{http_code}' "http://localhost:$API_PORT/api/staff/knowledge/recent")
[ "$C401" = "401" ] || fail "无会话期望 401 得到 $C401"
grep -q 'SESSION_REQUIRED' /tmp/kh-smoke-401.json || fail "401 错误码不符"
LEDGER_BEFORE=$(psql_q "SELECT count(*) FROM public.learnings")
# 计数必须是个数字：查不动账本时它是空串，前后一比"都空"就假绿了——
# 「伪造头没写进账本」会在账本根本不存在的情况下自动成立。
case "$LEDGER_BEFORE" in ''|*[!0-9]*) fail "账本计数不可读（got='${LEDGER_BEFORE}'），零新增断言会假绿";; esac
CFORGE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-User-Email: $ORGA_EMAIL" -H "X-Feishu-User-Id: $ORGA_OPENID" \
  -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" \
  -H 'Content-Type: application/json' \
  -d '{"trigger_condition":"forged","conclusion":"forged","evidence_url":"https://example.com/forged"}')
[ "$CFORGE" = "401" ] || fail "伪造身份头改变了判定，得到 $CFORGE"
LEDGER_MID=$(psql_q "SELECT count(*) FROM public.learnings")
[ "$LEDGER_BEFORE" = "$LEDGER_MID" ] || fail "伪造头路径写进账本 $LEDGER_BEFORE -> $LEDGER_MID"
ok "伪造头判定不变（401）且账本零新增"

echo "== 6. 录入落账本带归属 + 最近沉淀读到那一条 =="
EVIDENCE="https://github.com/perfectuser21/zenithjoy-workspace/pull/kh-smoke-$SFX"
RESP=$(curl -s -b /tmp/kh-smoke-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/knowledge/entries" \
  -H 'Content-Type: application/json' \
  -d "{\"trigger_condition\":\"smoke 触发条件\",\"conclusion\":\"smoke 结论 $SFX\",\"evidence_url\":\"$EVIDENCE\",\"org_id\":\"$ORGB_TENANT_ID\"}")
ENTRY_ID=$(echo "$RESP" | sed -n 's/.*"entry_id":"\([^"]*\)".*/\1/p')
[ -n "$ENTRY_ID" ] || { echo "$RESP"; fail "录入未返回 entry_id"; }
# 请求体里塞的 org_id 必须被忽略：归属只认会话解析出来的那一个
ROW=$(psql_q "SELECT count(*) FROM public.learnings WHERE id='$ENTRY_ID' AND metadata->>'org_id'='$ORGA_TENANT_ID' AND metadata->>'author_member_id' IS NOT NULL")
[ "$ROW" = "1" ] || fail "账本无带归属行（或请求体 org_id 覆盖了归属）count=$ROW"
LIST=$(curl -sf -b /tmp/kh-smoke-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/recent")
echo "$LIST" | grep -q "$ENTRY_ID"  || fail "最近沉淀读不到刚提交的 $ENTRY_ID"
echo "$LIST" | grep -q "$EVIDENCE"  || fail "证据链接未逐字回读"
ok "201 落库带归属，请求体 org_id 被忽略，最近沉淀命中该条"

echo "== 7. 跨企业隔离：企业B 会话看不到企业A 那条 =="
curl -sf -c /tmp/kh-smoke-cookie-b.txt -X POST "http://localhost:$API_PORT/api/staff/feishu-login" \
  -H 'Content-Type: application/json' -d '{"code":"smoke-code-orgb"}' -o /dev/null \
  || fail "企业B 登录失败"
LISTB=$(curl -sf -b /tmp/kh-smoke-cookie-b.txt "http://localhost:$API_PORT/api/staff/knowledge/recent")
echo "$LISTB" | grep -q "$ENTRY_ID" && fail "企业B 看到了企业A 的条目"
ok "企业B 列表零企业A 条目"

echo "== 8. INV-5 投影表只读 + INV-12 不静默降级 =="
GPROJ=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/kh-smoke-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/projection")
[ "$GPROJ" = "200" ] || fail "投影表只读读端不存在 got=$GPROJ"
PPROJ=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/kh-smoke-cookie.txt -X POST "http://localhost:$API_PORT/api/staff/knowledge/projection" -H 'Content-Type: application/json' -d '{}')
case "$PPROJ" in 404|405) ok "投影表无写端点（${PPROJ}）";; *) fail "投影表疑似有写端点 got=$PPROJ";; esac
WRITES=$(grep -rInE "(INSERT|UPDATE|DELETE)[[:space:]]+(INTO[[:space:]]+)?(zenithjoy\.)?knowledge_entries_projection" apps/api/src --include=*.ts | grep -v "__tests__" | wc -l | tr -d ' ')
[ "$WRITES" = "0" ] || fail "投影表存在写入路径 count=${WRITES}（违反 SSOT 单向）"
psql "$PGURL" -q -c "ALTER TABLE public.learnings RENAME TO learnings_kh_smoke_hidden" >/dev/null 2>&1
CDEG=$(curl -s -o /tmp/kh-smoke-degraded.json -w '%{http_code}' -b /tmp/kh-smoke-cookie.txt "http://localhost:$API_PORT/api/staff/knowledge/recent")
psql "$PGURL" -q -c "ALTER TABLE public.learnings_kh_smoke_hidden RENAME TO learnings" >/dev/null 2>&1
[ "$CDEG" = "503" ] || fail "账本不可达期望 503 得到 ${CDEG}（疑似静默降级成空列表）"
grep -q 'LEDGER_UNREACHABLE' /tmp/kh-smoke-degraded.json || fail "降级错误码不是 LEDGER_UNREACHABLE"
ok "账本不可达回 503 LEDGER_UNREACHABLE，不冒充空列表"

echo "== 9. A31 前置保护：既有 16 端点未被误伤 =="
grep -q "X-User-Email" apps/staff-hub/src/lib/adminFetch.ts     || fail "adminFetch 摘除了 X-User-Email"
grep -q "X-Feishu-User-Id" apps/staff-hub/src/lib/adminFetch.ts || fail "adminFetch 摘除了 X-Feishu-User-Id"
N=$(node .github/workflows/scripts/count-staffguard-endpoints.mjs)
[ "$N" = "16" ] || fail "staffGuard 端点计数 $N != 16"
ok "adminFetch 两个头都在，端点计数 = 16"

echo "✅ knowledge-hub 路① 第一刀 smoke 全绿（A27 + A30 四变异 + 业务全链 + INV-5/12 + A31）"
