#!/usr/bin/env bash
# 多组织切换第一刀 smoke —— A10 静态守卫 + 6 条变异 proven-to-fire（A1/A4/A7/A10/A11/A12）
#
# 各断言段（--aN-only）直接跑本刀已过的 vitest（真 PG + 真会话，禁 mock）；变异（--mutation-apply/
# --mutation-revert）对源码做精确 sed 补丁，改完再跑对应段必须转红——「先证明因引入缺陷报红、
# 再证明正确实现转绿」。A10 段是纯静态扫描（无需 DB）：org 中间件/端点源码里 active_org/org_id 与
# 身份头名 / req.body / req.query 同现即报红，扫描域 <N 项即 exit 1（防空集假绿）。
#
# 用法：
#   bash org-context-switch-smoke.sh --a10-only        # 静态守卫（无需 DB）
#   bash org-context-switch-smoke.sh --a1-only|--a4-only|--a7-only|--a11-only|--a12-only   # 需 E2E_DATABASE_URL
#   bash org-context-switch-smoke.sh --mutation-list
#   bash org-context-switch-smoke.sh --mutation-apply <NAME>
#   bash org-context-switch-smoke.sh --mutation-revert <NAME>
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
API_DIR="apps/api"
TESTS_REL="../../sprints/08221800-org-context-switch-core/tests"
ORG_CFG="vitest.org-context.config.ts"

# A10 扫描域：org 解析核心 + 端点 + 两闸（含 org 维度的新代码；机器/AI 通道排后续刀，本刀不纳入）
A10_FILES=(
  "apps/api/src/middleware/active-org.ts"
  "apps/api/src/routes/org-context.ts"
  "apps/api/src/middleware/workbench-auth.ts"
  "apps/api/src/middleware/knowledge-auth.ts"
)
# 禁用身份头字面量（路③ 七个 + 本刀新增 X-Org-Id / X-Active-Org）
A10_BANNED_HEADERS='X-Tenant-Id|X-User-Email|X-Feishu-User-Id|X-Bypass-Tenant|X-Org-Id|X-Active-Org|tenantContextOptional|selfHealOwnerMember|staffGuard'
# 从请求体/查询取 org 身份维度即报红：读 tenant_id / active_org，或把 active_org 赋值自 req.body/query。
# 注意：POST /switch-org 从 body 取 org_id 是**合法的切换目标**（服务端随后校验 ∈ 成员集合），故不禁 org_id；
# 禁的是「解析出的当前企业身份」来自请求体/查询——那才是绕过会话态 active_org 的命门破口。
A10_BANNED_BODY='req\.(body|query)[?]?\.(tenant_id|active_?org|activeorg)|(active_?org|activeorg)[[:space:]]*=[[:space:]]*req\.(body|query)'
# 注释剥离：去掉块注释体行（^ *）、行注释、以及行尾 // 注释，避免文档里提到禁用名被误判
strip_comments() { sed -E 's://.*$::' "$1" | grep -vE '^[[:space:]]*(\*|/\*|//)'; }

fail() { echo "❌ FAIL: $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

pg_url() { echo "${E2E_DATABASE_URL:-${DATABASE_URL:-}}"; }

run_vitest() {
  # $1 = 测试文件名（相对 tests 目录）; $2 = -t 过滤（可空）
  local file="$1"; local pat="${2:-}"
  local pg; pg="$(pg_url)"
  [ -n "$pg" ] || fail "缺 E2E_DATABASE_URL / DATABASE_URL"
  ( cd "$API_DIR" && E2E_DATABASE_URL="$pg" DATABASE_URL="$pg" \
      npx vitest run --config "$ORG_CFG" "$TESTS_REL/$file" ${pat:+-t "$pat"} --reporter=dot )
}

run_a10() {
  echo "== A10 静态守卫：org 源码零身份头 / 零 req.body|query 取 org 维度 =="
  local n=0 hit=0
  for f in "${A10_FILES[@]}"; do
    [ -f "$f" ] || fail "A10 扫描域项不是真实文件：${f}（org 中间件/端点被改名或删了？）"
    n=$((n + 1))
  done
  [ "$n" -ge 4 ] || fail "A10 扫描域仅 $n 项（<4，疑似退化成空集，空集零命中=假绿）"
  echo "  扫描域 $n 项：${A10_FILES[*]}"
  for f in "${A10_FILES[@]}"; do
    local code; code="$(strip_comments "$f")"
    if printf '%s\n' "$code" | grep -nEi "$A10_BANNED_HEADERS"; then
      echo "  ❌ $f 出现禁用身份头字面量（上行，已剥注释）"; hit=1
    fi
    if printf '%s\n' "$code" | grep -nE "$A10_BANNED_BODY"; then
      echo "  ❌ $f 从 req.body/req.query 取 org 身份维度（上行，已剥注释）"; hit=1
    fi
  done
  [ "$hit" -eq 0 ] || fail "A10 守卫命中：org 解析不许读任何身份头，也不许从请求体/查询取 org 维度"
  # active-org 必须真被两闸引用（不是死代码）——挂载事实校验，防"守卫扫了个没人用的文件"
  grep -q "from './active-org'" apps/api/src/middleware/workbench-auth.ts \
    || fail "workbench-auth 未引用 active-org（org 解析核心成了死代码？）"
  grep -q "from './active-org'" apps/api/src/middleware/knowledge-auth.ts \
    || fail "knowledge-auth 未引用 active-org"
  ok "A10 通过：$n 个 org 文件零禁用字面量、零 req.body/query 取 org，且两闸真引用 active-org"
}

# ── 变异表 ──────────────────────────────────────────────────────────────────
mutation_list() {
  cat <<'EOF'
A1-404-timestamp
A4-silent-first
A7-trust-stale
A10-body-org-read
A11-no-audit
A12-nocheck
A12-reject-multiorg
EOF
}

# 每条变异：apply=把 FROM 串换成 TO 串；revert=把 TO 换回 FROM。串在源码里唯一。
mut_pair() {
  case "$1" in
    A1-404-timestamp)
      MUT_FILE="apps/api/src/middleware/workbench-auth.ts"
      MUT_FROM="return { success: false, data: null, error: { code: 'NOT_FOUND', message: '表不存在或无权访问' } };"
      MUT_TO="return { success: false, data: null, error: { code: 'NOT_FOUND', message: '表不存在或无权访问' }, timestamp: new Date().toISOString() };"
      ;;
    A4-silent-first)
      MUT_FILE="apps/api/src/middleware/active-org.ts"
      MUT_FROM="  const set = new Set(memberOrgIds);"
      MUT_TO="  const set = new Set(memberOrgIds); if (set.size > 1 && activeOrg === null) return { ok: true, orgId: [...set][0] };"
      ;;
    A7-trust-stale)
      # 让"active_org ∉ 成员集合"分支改成信任陈旧 active_org（= 登录快照/不实时重校），A7 应转红。
      # MUT_TO 带唯一标记，避免与合法分支的 `return { ok: true, orgId: activeOrg };` 撞串致 revert 误改。
      MUT_FILE="apps/api/src/middleware/active-org.ts"
      MUT_FROM="    return { ok: false, status: 403, code: 'ORG_FORBIDDEN', message: ORG_MESSAGES.ORG_FORBIDDEN };"
      MUT_TO="    return { ok: true, orgId: activeOrg }; /* A7-mut-stale */"
      ;;
    A10-body-org-read)
      # 注入「解析出的当前企业身份来自 req.body」这一命门破口（A10 纯静态扫描不编译，文本命中即可）
      MUT_FILE="apps/api/src/routes/org-context.ts"
      MUT_FROM="export const orgContextRouter = Router();"
      MUT_TO="export const orgContextRouter = Router(); const activeorg = req.body.tenant_id; void activeorg;"
      ;;
    A11-no-audit)
      MUT_FILE="apps/api/src/middleware/active-org.ts"
      MUT_FROM="      'INSERT INTO zenithjoy.org_audit (member_id, event, org_id, detail) VALUES (\$1, \$2, \$3, \$4)',"
      MUT_TO="      'SELECT 1 FROM zenithjoy.org_audit WHERE \$1 IS NULL AND \$2 IS NULL AND \$3 IS NULL AND \$4 IS NULL',"
      ;;
    A12-nocheck)
      MUT_FILE="apps/api/src/startup/single-org-selfcheck.ts"
      MUT_FROM="  if (!dimensionReady) {"
      MUT_TO="  if (false) {"
      ;;
    A12-reject-multiorg)
      MUT_FILE="apps/api/src/startup/single-org-selfcheck.ts"
      MUT_FROM="  const dimensionReady = await hasActiveOrgColumn(pool, opts);"
      MUT_TO="  const dimensionReady = await hasActiveOrgColumn(pool, opts); if (multiOrg.length > 0) throw new ActiveOrgDimensionError('A12-mut 多组织即退出');"
      ;;
    *) fail "未知变异：$1" ;;
  esac
}

mutation_apply() {
  mut_pair "$1"
  grep -qF "$MUT_FROM" "$MUT_FILE" || fail "变异 $1 锚点不在 ${MUT_FILE}（源码变了？）"
  # 用 perl 精确整串替换（避免 sed 转义地狱）
  MUT_FROM="$MUT_FROM" MUT_TO="$MUT_TO" perl -0777 -i -pe 's/\Q$ENV{MUT_FROM}\E/$ENV{MUT_TO}/' "$MUT_FILE"
  grep -qF "$MUT_TO" "$MUT_FILE" || fail "变异 $1 apply 未生效"
  echo "  已注入变异 $1 → $MUT_FILE"
}

mutation_revert() {
  mut_pair "$1"
  grep -qF "$MUT_TO" "$MUT_FILE" || { echo "  变异 $1 未处于注入态（跳过 revert）"; return 0; }
  MUT_FROM="$MUT_FROM" MUT_TO="$MUT_TO" perl -0777 -i -pe 's/\Q$ENV{MUT_TO}\E/$ENV{MUT_FROM}/' "$MUT_FILE"
  grep -qF "$MUT_FROM" "$MUT_FILE" || fail "变异 $1 revert 未复原"
  echo "  已复原变异 $1 → $MUT_FILE"
}

case "${1:-}" in
  --a10-only) run_a10; exit 0;;
  --a1-only)  run_vitest "org-context-isolation.test.ts" "A1"; exit $?;;
  --a4-only)  run_vitest "org-context-resolve.test.ts" "A4"; exit $?;;
  --a7-only)  run_vitest "org-context-live-audit.test.ts" "A7"; exit $?;;
  --a11-only) run_vitest "org-context-live-audit.test.ts" "A11"; exit $?;;
  --a12-only) run_vitest "org-context-dimension.test.ts" ""; exit $?;;
  --mutation-list)   mutation_list; exit 0;;
  --mutation-apply)  mutation_apply "${2:?缺变异名}"; exit 0;;
  --mutation-revert) mutation_revert "${2:?缺变异名}"; exit 0;;
  *)
    echo "用法见文件头注释" >&2; exit 2;;
esac
