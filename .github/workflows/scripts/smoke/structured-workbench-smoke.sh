#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 路③ 结构化工作台 Sprint A smoke
#
# 分工（合同「夹具供给协议」）：本脚本**供给环境**（起真 apps/api + 种双企业 + 签三个真会话），
# 高价值判定写在 contract-dod.md 的命令里由 evaluator 直接跑。这样"脚本自己 echo 通过"
# 骗不到分——DB 侧断言的连接串直接取自 env，完全绕开本脚本。
#
# 变异协议（合同「变异证明执行协议」）：--mutation-apply 只改代码，判据是「被守卫的那一段
# 自己 exit≠0」。apply/revert 内一个 pass/fail 判定都没有，也不打印 proven-to-fire。
#
# 用法：
#   bash structured-workbench-smoke.sh                 段2 全跑（需 DB + 会起服务）
#   bash structured-workbench-smoke.sh --static-only   段1 静态守卫（无需 DB/服务）
#   bash structured-workbench-smoke.sh --a2-only|--a35-only|--a33-only
#   bash structured-workbench-smoke.sh --a1-a3-only|--a4-only|--a7-only|--a8-only|--a9-only|--a10-only|--a11-only
#   bash structured-workbench-smoke.sh --inv-<name>
#   bash structured-workbench-smoke.sh --fixture-up | --fixture-down
#   bash structured-workbench-smoke.sh --mutation-list|--mutation-apply <N>|--mutation-revert <N>
#
# 不用 set -e：本脚本靠显式 exit 传播失败，set -e 会让 `[ ... ] && x` 这类惯用法在条件为假时
# 直接把脚本打死，反而丢掉后面的诊断输出。
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "❌ FAIL: $*"; exit 1; }
ok()   { echo "  ✅ $*"; }

SPRINT_DIR="sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff"
GUARD_FILE="apps/api/src/middleware/workbench-auth.ts"
ROUTE_FILE="apps/api/src/routes/workbench.ts"
SERVICE_FILE="apps/api/src/services/workbench.service.ts"
SELFCHECK_FILE="apps/api/src/startup/single-org-selfcheck.ts"
EXCLUSIONS_FILE="apps/api/src/knowledge/retrieval-exclusions.ts"
E2E_WORKFLOW=".github/workflows/e2e-knowledge-hub-path3.yml"
BACKUP_WORKFLOW=".github/workflows/db-backup.yml"
DRILL=".github/workflows/scripts/backup/restore-drill.sh"
SCOPE_TOOL=".github/workflows/scripts/smoke/lib/workbench-a2-scope.mjs"
FIXTURE_ENV="./.wb-fixture.env"
FIXTURE_PID="./.wb-fixture.pid"
MUTATION_TARGET_FILE="./.wb-mutation-target"
API_LOG="/tmp/wb-smoke-api.log"

API_PORT="${WORKBENCH_SMOKE_PORT:-52320}"
MUT_PORT=$((API_PORT + 1))

# ═══════════════════════════════════════════════════════════════════════════
# 段1 静态守卫（无需 DB / 服务）
# ═══════════════════════════════════════════════════════════════════════════

# 七个禁用字面量。它们出现在路③ 源码里 = 有人重新引入了可伪造的身份来源，那正是本条 GP 的命门。
# 本脚本自身必然要写出这七个名字才能去查，所以扫描域显式把它排除（见 workbench-a2-scope.mjs）。
BANNED_LITERALS=(
  'X-Tenant-Id'
  'X-User-Email'
  'X-Feishu-User-Id'
  'X-Bypass-Tenant'
  'tenantContextOptional'
  'selfHealOwnerMember'
  'staffGuard'
)
# 同一份清单的正则形态（扫描用；数组形态给变异注入逐个用，两者必须同源）
BANNED_RE=$(IFS='|'; echo "${BANNED_LITERALS[*]}")

a2_scope() {
  node "$SCOPE_TOOL"
}

run_a2_print_scope() {
  a2_scope
}

run_a2() {
  echo "== A2 静态守卫：路③ 源码零身份头名 =="
  local scope
  scope=$(a2_scope) || fail "A2 扫描域推导失败（见上方原因）—— 空集上的零命中是假绿"

  local n=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    n=$((n + 1))
    [ -f "$f" ] || fail "A2 扫描域项不是真实文件：$f"
  done <<< "$scope"
  [ "$n" -ge 3 ] || fail "A2 扫描域仅 $n 项（<3，疑似推导退化成空集）"
  echo "  扫描域 $n 项："
  while IFS= read -r f; do [ -n "$f" ] && echo "     $f"; done <<< "$scope"

  # 兜底②：本分支新增的路③ 源文件必须全在域内，漏一个即 FAIL 并打印文件名
  local changed
  changed=$(git diff --name-only origin/main...HEAD -- apps/api/src apps/staff-hub/src 2>/dev/null | grep -E '\.(ts|tsx)$' || true)
  while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$f" ] || continue
    grep -qE '/api/knowledge/db|[Ww]orkbench' "$f" || continue
    printf '%s\n' "$scope" | grep -qxF "$f" || fail "路③ 新增文件未进 A2 扫描域：$f"
  done <<< "$changed"

  local hit=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if grep -qiE "$BANNED_RE" "$f"; then
      echo "  ❌ $f 出现禁用字面量："
      grep -inE "$BANNED_RE" "$f" | sed 's/^/     /'
      hit=1
    fi
  done <<< "$scope"
  [ "$hit" -eq 0 ] || fail "A2 守卫命中：路③ 不许读任何身份头，也不许挂身份头闸"

  grep -q "app.use('/api/knowledge/db'" apps/api/src/app.ts \
    || fail "路③ 挂载路径不是 /api/knowledge/db"
  grep -q "app.use('/api/staff/knowledge/db'" apps/api/src/app.ts \
    && fail "路③ 被挂进了 /api/staff 前缀（那道前缀有身份头闸）"

  local n16
  n16=$(node .github/workflows/scripts/count-staffguard-endpoints.mjs | tr -dc '0-9')
  [ "$n16" = "16" ] || fail "既有身份头闸端点计数 $n16 != 16（路③ 端点被误挂）"
  ok "A2 通过：$n 个文件零禁用字面量，挂载路径正确，既有端点计数仍 16"
}

run_a35() {
  echo "== A35① 前向兼容锚：排除清单五表名逐字命中 =="
  [ -f "$EXCLUSIONS_FILE" ] || fail "A35 排除清单不存在：$EXCLUSIONS_FILE"
  node -e "require('fs').readFileSync('$EXCLUSIONS_FILE','utf8')" >/dev/null 2>&1 \
    || fail "A35 排除清单无法被 Node 读取"
  grep -qE 'export const .*=\s*\[' "$EXCLUSIONS_FILE" || fail "A35 排除清单未导出常量数组"
  local miss=0
  for t in db_tables db_fields db_rows db_view_prefs db_audit; do
    if grep -qF "'$t'" "$EXCLUSIONS_FILE"; then
      ok "排除清单含 $t"
    else
      echo "  ❌ 排除清单缺表名 $t"
      miss=1
    fi
  done
  [ "$miss" -eq 0 ] || fail "A35 守卫命中：路③ 物理表未全部排除出问答检索域"
  echo "✅ A35① 通过（5/5）"
}

run_a33() {
  echo "== A33 独立 workflow 四段静态判据（YAML 真解析）=="
  [ -f "$E2E_WORKFLOW" ] || fail "A33 workflow 不存在：$E2E_WORKFLOW"
  node - "$E2E_WORKFLOW" <<'NODEEOF' || fail "A33 四段未全绿"
const fs = require('fs');
const yaml = require('js-yaml');
const file = process.argv[2];
let doc;
try {
  doc = yaml.load(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('  ❌ YAML 解析失败:', e.message);
  process.exit(1);
}
let bad = 0;
const on = doc?.on ?? doc?.true;   // YAML 1.1 把裸 on 解析成布尔 true
if (!on || !('pull_request' in on)) { console.error('  ❌ A33(a) on: 不含 pull_request'); bad = 1; }
else console.log('  ✅ A33(a) on: 含 pull_request');

const jobs = doc?.jobs ?? {};
const winEntries = Object.entries(jobs).filter(([, j]) => String(j?.['runs-on'] ?? '').includes('windows-latest'));
if (winEntries.length === 0) { console.error('  ❌ A33(b) 无 runs-on: windows-latest 的 job'); bad = 1; }
else console.log(`  ✅ A33(b) windows-latest job: ${winEntries.map(([n]) => n).join(', ')}`);

for (const [name, j] of winEntries) {
  const steps = JSON.stringify(j?.steps ?? []);
  if (!/structured-workbench\.spec\.ts|e2e-verify\.ps1/.test(steps)) {
    console.error(`  ❌ A33(b) job ${name} 没有跑路③ 真浏览器全链`); bad = 1;
  }
  // (c) job 级 if 门 —— 静态形状为真、job 却从不运行，spec 照样是孤儿
  if (j?.if !== undefined) {
    const cond = String(j.if);
    if (/github\.event_name|workflow_dispatch|schedule/.test(cond)) {
      console.error(`  ❌ A33(c) job ${name} 带事件条件门 if: ${cond}`); bad = 1;
    } else {
      console.log(`  ⚠️  A33(c) job ${name} 有 if 但不是事件门: ${cond}`);
    }
  } else {
    console.log(`  ✅ A33(c) job ${name} 无 job 级 if 门`);
  }
}

const paths = on?.pull_request?.paths ?? [];
const joined = paths.join(' ');
const needSpec = /structured-workbench\.spec\.ts|apps\/staff-hub/.test(joined);
const needSrc = /apps\/api\/src/.test(joined);
if (paths.length === 0) { console.log('  ✅ A33(d) 未设 paths（等于全量触发，比 paths 漏配更安全）'); }
else if (!needSpec || !needSrc) { console.error(`  ❌ A33(d) paths 未同时覆盖路③ spec 与源码: ${joined}`); bad = 1; }
else console.log('  ✅ A33(d) paths 覆盖路③ spec 与源码');

process.exit(bad);
NODEEOF
  echo "✅ A33 四段通过"
}

run_static_inv() {
  echo "== 静态 INV：扫描器 + 交付物存在性 =="
  node .github/workflows/scripts/smoke/lib/scan-hardcoded-secrets.mjs \
    "$SPRINT_DIR" apps/api/src/knowledge "$GUARD_FILE" "$BACKUP_WORKFLOW" "$E2E_WORKFLOW" \
    || fail "INV-4 硬编码凭据扫描未过"
  node .github/workflows/scripts/smoke/lib/scan-hardcoded-env.mjs \
    "${BASH_SOURCE[0]}" "$DRILL" "$SPRINT_DIR/e2e-verify.ps1" \
    || fail "INV-7 写死环境假设值扫描未过"
  grep -q 'structured-workbench-smoke.sh' .github/workflows/scripts/smoke-baseline.txt \
    || fail "路③ smoke 未进 smoke-baseline.txt（nightly 不跑 = 死了没人知道）"
  grep -qE '^\s{2}schedule:' "$BACKUP_WORKFLOW" || fail "G2 备份 workflow 缺 schedule 持久载体"
  ok "两个扫描器基线绿，smoke 已进棘轮，备份 workflow 有 schedule"
}

run_static() {
  run_a2
  run_a35
  run_a33
  run_static_inv
  echo "✅ 段1 静态守卫全绿"
}

# ═══════════════════════════════════════════════════════════════════════════
# 变异开关（apply/revert 内零判定、零 proven-to-fire 字样）
# ═══════════════════════════════════════════════════════════════════════════

# 行为类变异同时改源码与其编译产物：源码是"变异真的施加在被守卫的代码上"的证据，
# dist 是"起进程就立刻生效"的载体。只改源码要重新 tsc，一轮变异要多烧一分钟；
# 只改 dist 又会被质疑没碰真代码。两处一起改，revert 时一起还原。
DIST_GUARD="apps/api/dist/middleware/workbench-auth.js"
DIST_SERVICE="apps/api/dist/services/workbench.service.js"
DIST_SELFCHECK="apps/api/dist/startup/single-org-selfcheck.js"

INJECT_SECRET_FILE="apps/api/src/knowledge/.wb-mutation-secret.ts"

mutation_list() {
  # 每行：<变异名><空白><注入次数>。合计 9 开关 / 19 次注入。
  cat <<'EOF'
A2-inject-all	7
A35-drop-name	5
INV4-inject-secret	1
INV7-inject-hardcoded-env	1
A1-header-fallback	1
A8-deny-all	1
A9-hard-delete	1
A11-take-first	1
A5-schema-only	1
EOF
}

backup_of() { echo "/tmp/wb-mut-$(echo "$1" | tr '/' '_').bak"; }

save_file() { [ -f "$1" ] && cp "$1" "$(backup_of "$1")"; }
restore_file() { local b; b=$(backup_of "$1"); [ -f "$b" ] && mv "$b" "$1"; }

mutation_apply() {
  local name="$1"
  : > "$MUTATION_TARGET_FILE"
  case "$name" in
    A2-inject-all)
      # 注入到**现算扫描域里的真实文件**，不是某个登记过的旧文件
      local target
      target=$(a2_scope | grep -F "$ROUTE_FILE" | head -1)
      [ -n "$target" ] || target=$(a2_scope | head -1)
      [ -n "$target" ] || { echo "扫描域为空，无法注入"; exit 1; }
      save_file "$target"
      for lit in "${BANNED_LITERALS[@]}"; do
        printf '// mutation %s\n' "$lit" >> "$target"
      done
      echo "$target" > "$MUTATION_TARGET_FILE"
      ;;
    A35-drop-name)
      save_file "$EXCLUSIONS_FILE"
      for t in db_tables db_fields db_rows db_view_prefs db_audit; do
        perl -0pi -e "s/^\s*'\Q$t\E',\n//m" "$EXCLUSIONS_FILE"
      done
      echo "$EXCLUSIONS_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    INV4-inject-secret)
      # 载荷运行时拼，别在本脚本里写出完整形态 —— INV-7 扫的正是这个文件，
      # 把变异素材原样写在这儿，守卫会先红在自己身上。
      local sch='postgre''sql' hst='db''.internal'
      {
        echo '// mutation fixture'
        printf "export const CONN = '%s://wbuser:wbSecretPassw0rd@%s:5432/zenithjoy';\n" "$sch" "$hst"
      } > "$INJECT_SECRET_FILE"
      echo "$INJECT_SECRET_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    INV7-inject-hardcoded-env)
      save_file "$DRILL"
      # 同上：分段拼一个 uuid 形态，本脚本源码里不出现完整字面量
      printf '# mutation: HARD_ID=%s-%s-%s-%s-%s\n' 3f2a1b4c 5d6e 4f70 8a91 b2c3d4e5f607 >> "$DRILL"
      echo "$DRILL" > "$MUTATION_TARGET_FILE"
      ;;
    A1-header-fallback)
      save_file "$GUARD_FILE"; save_file "$DIST_GUARD"
      # 把闸改回「有头则读头」：组织归属从请求头取，会话解析出来的那个被丢掉
      perl -0pi -e "s/(req\.workbenchIdentity = \{ memberId, orgId: rows\[0\]\.tenant_id \};)/const __h = req.headers['x-tenant-id']; if (typeof __h === 'string' && __h) { req.workbenchIdentity = { memberId, orgId: __h }; next(); return; }\n  \$1/" "$GUARD_FILE"
      [ -f "$DIST_GUARD" ] && perl -0pi -e "s/(req\.workbenchIdentity = \{ memberId, orgId: rows\[0\]\.tenant_id \};)/const __h = req.headers['x-tenant-id']; if (typeof __h === 'string' && __h) { req.workbenchIdentity = { memberId, orgId: __h }; next(); return; }\n    \$1/" "$DIST_GUARD"
      echo "$GUARD_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A8-deny-all)
      save_file "$SERVICE_FILE"; save_file "$DIST_SERVICE"
      # 可见性判据改成一律拒绝：表主本人也读不到（正向对照没跑的话这条不会被发现）。
      # 锚点故意在 "= " 处截断，不含 $1/$2/$3 —— 双引号里的 \$N 会被 bash 交给 perl 当捕获组变量
      # 展开成空串，模式就永远匹配不上，变异静默失效、守卫看着"证明"过了。
      perl -0pi -e "s/\Q(t.visibility = 'org' OR t.owner_member_id = \E/(1 = 0 AND t.owner_member_id = /g" "$SERVICE_FILE"
      [ -f "$DIST_SERVICE" ] && perl -0pi -e "s/\Q(t.visibility = 'org' OR t.owner_member_id = \E/(1 = 0 AND t.owner_member_id = /g" "$DIST_SERVICE"
      echo "$SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A9-hard-delete)
      save_file "$SERVICE_FILE"; save_file "$DIST_SERVICE"
      # 软删改成物理删：API 层看起来一模一样，只有查库才分得出来。
      # 同样避开 $N 锚点（见 A8-deny-all 的注释）：把 UPDATE ... SET 整段换成 DELETE + 行注释，
      # 后面的 WHERE / RETURNING 原样留着，SQL 依然合法但语义变成了真删。
      perl -0pi -e "s/\QUPDATE zenithjoy.db_tables SET deleted_at = NOW(), updated_at = NOW()\E/DELETE FROM zenithjoy.db_tables --/g" "$SERVICE_FILE"
      [ -f "$DIST_SERVICE" ] && perl -0pi -e "s/\QUPDATE zenithjoy.db_tables SET deleted_at = NOW(), updated_at = NOW()\E/DELETE FROM zenithjoy.db_tables --/g" "$DIST_SERVICE"
      echo "$SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A11-take-first)
      save_file "$SELFCHECK_FILE"; save_file "$DIST_SELFCHECK"
      save_file "$GUARD_FILE"; save_file "$DIST_GUARD"
      # 自检改回「取第一条」：多组织既不拦启动，请求期也不报 409
      perl -0pi -e 's/HAVING count\(DISTINCT tenant_id\) > 1/HAVING count(DISTINCT tenant_id) > 999/g' "$SELFCHECK_FILE"
      [ -f "$DIST_SELFCHECK" ] && perl -0pi -e 's/HAVING count\(DISTINCT tenant_id\) > 1/HAVING count(DISTINCT tenant_id) > 999/g' "$DIST_SELFCHECK"
      perl -0pi -e 's/if \(rows\.length > 1\)/if (rows.length > 999)/g' "$GUARD_FILE"
      [ -f "$DIST_GUARD" ] && perl -0pi -e 's/if \(rows\.length > 1\)/if (rows.length > 999)/g' "$DIST_GUARD"
      echo "$SELFCHECK_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A5-schema-only)
      save_file "$DRILL"
      perl -0pi -e 's/^DUMP_MODE_ARGS=\(\)$/DUMP_MODE_ARGS=(--schema-only)/m' "$DRILL"
      echo "$DRILL" > "$MUTATION_TARGET_FILE"
      ;;
    *)
      echo "未登记的变异名：$name"; exit 1;;
  esac
  echo "mutation applied: $name -> $(cat "$MUTATION_TARGET_FILE")"
}

mutation_revert() {
  local name="$1"
  case "$name" in
    A2-inject-all)      [ -f "$MUTATION_TARGET_FILE" ] && restore_file "$(cat "$MUTATION_TARGET_FILE")";;
    A35-drop-name)      restore_file "$EXCLUSIONS_FILE";;
    INV4-inject-secret) rm -f "$INJECT_SECRET_FILE";;
    INV7-inject-hardcoded-env) restore_file "$DRILL";;
    A1-header-fallback) restore_file "$GUARD_FILE"; restore_file "$DIST_GUARD";;
    A8-deny-all)        restore_file "$SERVICE_FILE"; restore_file "$DIST_SERVICE";;
    A9-hard-delete)     restore_file "$SERVICE_FILE"; restore_file "$DIST_SERVICE";;
    A11-take-first)     restore_file "$SELFCHECK_FILE"; restore_file "$DIST_SELFCHECK";
                        restore_file "$GUARD_FILE"; restore_file "$DIST_GUARD";;
    A5-schema-only)     restore_file "$DRILL";;
    *) echo "未登记的变异名：$name"; exit 1;;
  esac
  rm -f "$MUTATION_TARGET_FILE"
  echo "mutation reverted: $name"
}

# ═══════════════════════════════════════════════════════════════════════════
# 夹具供给（--fixture-up / --fixture-down）：零判定、零「通过」字样
# ═══════════════════════════════════════════════════════════════════════════

resolve_pg() {
  if [ -n "${E2E_DATABASE_URL:-}" ]; then
    PGURL="$E2E_DATABASE_URL"; PGSRC="E2E_DATABASE_URL"
  elif [ -n "${DATABASE_URL:-}" ]; then
    PGURL="$DATABASE_URL"; PGSRC="DATABASE_URL"
  else
    fail "未设 E2E_DATABASE_URL / DATABASE_URL —— 拒绝落默认库跑成假绿"
  fi
}

psql_q() { psql "$PGURL" -t -A -q -c "$1"; }

export_db_env() {
  # apps/api 只认 DATABASE_* 五个离散变量，从连接串推导，保证子进程连的是同一个库
  local f; f=$(mktemp)
  python3 - "$PGURL" > "$f" <<'PY'
import sys, urllib.parse as up
u = up.urlparse(sys.argv[1])
print(f'export DATABASE_HOST={u.hostname or "localhost"}')
print(f'export DATABASE_PORT={u.port or 5432}')
print(f'export DATABASE_NAME={(u.path or "/postgres").lstrip("/") or "postgres"}')
print(f'export DATABASE_USER={up.unquote(u.username or "postgres")}')
print(f'export DATABASE_PASSWORD={up.unquote(u.password or "")}')
PY
  # shellcheck source=/dev/null
  . "$f"
  rm -f "$f"
}

ensure_dist() {
  if [ ! -f apps/api/dist/index.js ] || [ -n "${WORKBENCH_SMOKE_FORCE_BUILD:-}" ]; then
    echo "  apps/api/dist 缺失或强制重建，现场构建"
    ( cd apps/api && npx tsc >/dev/null 2>&1 ) || fail "apps/api build 失败"
  fi
}

ensure_migration() {
  if [ -z "$(psql_q "SELECT to_regclass('zenithjoy.db_tables')")" ] \
     || [ -z "$(psql_q "SELECT 1 FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='field_definitions' AND column_name='tenant_id'")" ]; then
    echo "  路③ 五表或 tenant_id 列缺失，补跑 migration（DDL 幂等）"
    psql "$PGURL" -v ON_ERROR_STOP=1 -q -f apps/api/db/migrations/20260820_120000_structured_workbench.sql >/dev/null \
      || fail "路③ migration 应用失败"
  fi
}

# 种双企业 + 三个身份，导出到全局变量（不落盘的那一半由调用方决定）
seed_two_tenants() {
  SFX="$(date +%s)${RANDOM}"
  ORGA_TENANT_ID=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('WB-SMOKE-A-$SFX', 'wb-smoke-lk-a-$SFX', 'free') RETURNING id")
  ORGB_TENANT_ID=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('WB-SMOKE-B-$SFX', 'wb-smoke-lk-b-$SFX', 'free') RETURNING id")
  [ -n "$ORGA_TENANT_ID" ] && [ -n "$ORGB_TENANT_ID" ] || fail "两家企业的 tenants 行未建成"

  ALICE_OPENID="ou_wb_alice_$SFX"
  BOB_OPENID="ou_wb_bob_$SFX"
  CAROL_OPENID="ou_wb_carol_$SFX"

  # A30-1a：扁平白名单必须**恰好等于主企业那一组**（它是 staffGuard 的历史单企业口径）。
  # 把丙也塞进扁平名单，启动自检会正确地报 A30-1a VIOLATED 把进程拦在 listen 之前 ——
  # 那时红的是"这个 smoke 的员工目录写错了"，不是业务。丙只出现在 ORGB 分组里。
  export STAFF_FEISHU_OPENIDS="$ALICE_OPENID,$BOB_OPENID"
  export STAFF_FEISHU_OPENIDS__ORGA="$ALICE_OPENID,$BOB_OPENID"
  export STAFF_FEISHU_OPENIDS__ORGB="$CAROL_OPENID"
  export STAFF_ORG_MAP="ORGA:$ORGA_TENANT_ID,ORGB:$ORGB_TENANT_ID"
  export FEISHU_API_BASE="http://localhost:$API_PORT/api/_smoke/fake-feishu"
  export FEISHU_APP_ID="${FEISHU_APP_ID:-wb-smoke-app-id}"
  export FEISHU_APP_SECRET="${FEISHU_APP_SECRET:-wb-smoke-app-secret}"
  export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-wb-smoke-secret-not-for-prod-32-characters}"
  export NODE_ENV=development
}

start_api() {
  local port="$1" log="$2"
  if curl -sf -m 2 "http://localhost:$port/api/health" >/dev/null 2>&1; then
    fail "端口 $port 已被占用（改 WORKBENCH_SMOKE_PORT 或先停掉那个进程）—— 继续跑会验到别人的进程上去"
  fi
  PORT="$port" node apps/api/dist/index.js > "$log" 2>&1 &
  API_PID=$!
  local up=0
  for _ in $(seq 1 40); do
    curl -sf "http://localhost:$port/api/health" >/dev/null 2>&1 && { up=1; break; }
    kill -0 "$API_PID" 2>/dev/null || break
    sleep 1
  done
  [ "$up" = "1" ] || { tail -30 "$log"; fail "apps/api 未在 40s 内就绪（端口 ${port}）"; }
}

login_cookie() {
  local openid="$1" hdr; hdr=$(mktemp)
  curl -sf -D "$hdr" -o /dev/null -X POST "http://localhost:$API_PORT/api/staff/feishu-login" \
    -H 'Content-Type: application/json' -d "{\"code\":\"wb-code-$openid\"}" \
    || { rm -f "$hdr"; fail "会话签发失败 open_id=${openid}（假上游未按成员寻址？）"; }
  local c
  c=$(grep -i '^set-cookie:' "$hdr" | sed 's/^[Ss]et-[Cc]ookie: *//' | cut -d';' -f1 | paste -sd';' -)
  rm -f "$hdr"
  [ -n "$c" ] || fail "登录未返回 set-cookie open_id=$openid"
  echo "$c"
}

eight_fields_json() {
  cat <<'EOF'
[{"name":"字段-text","field_type":"text","options":[],"display_order":0},{"name":"字段-long_text","field_type":"long_text","options":[],"display_order":1},{"name":"字段-number","field_type":"number","options":[],"display_order":2},{"name":"字段-date","field_type":"date","options":[],"display_order":3},{"name":"字段-single_select","field_type":"single_select","options":["甲","乙"],"display_order":4},{"name":"字段-multi_select","field_type":"multi_select","options":["甲","乙"],"display_order":5},{"name":"字段-person","field_type":"person","options":[],"display_order":6},{"name":"字段-url","field_type":"url","options":[],"display_order":7}]
EOF
}

cleanup_seed() {
  [ -n "${ORGA_TENANT_ID:-}" ] || return 0
  for t in db_audit db_view_prefs db_rows db_fields db_tables; do
    psql "$PGURL" -q -c "DELETE FROM zenithjoy.$t WHERE org_id IN ('$ORGA_TENANT_ID','$ORGB_TENANT_ID')" >/dev/null 2>&1
  done
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.field_definitions WHERE tenant_id IN ('$ORGA_TENANT_ID','$ORGB_TENANT_ID')" >/dev/null 2>&1
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.session WHERE \"userId\" IN ('$ALICE_OPENID','$BOB_OPENID','$CAROL_OPENID')" >/dev/null 2>&1
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.\"user\" WHERE id IN ('$ALICE_OPENID','$BOB_OPENID','$CAROL_OPENID')" >/dev/null 2>&1
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenant_members WHERE tenant_id IN ('$ORGA_TENANT_ID','$ORGB_TENANT_ID')" >/dev/null 2>&1
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenants WHERE id IN ('$ORGA_TENANT_ID','$ORGB_TENANT_ID')" >/dev/null 2>&1
}

fixture_up() {
  resolve_pg
  export_db_env
  ensure_dist
  ensure_migration
  seed_two_tenants
  start_api "$API_PORT" "$API_LOG"
  echo "$API_PID" > "$FIXTURE_PID"
  local ca cb cc
  ca=$(login_cookie "$ALICE_OPENID")
  cb=$(login_cookie "$BOB_OPENID")
  cc=$(login_cookie "$CAROL_OPENID")
  {
    echo "export API_PORT='$API_PORT'"
    echo "export SFX='$SFX'"
    echo "export ORGA_TENANT_ID='$ORGA_TENANT_ID'"
    echo "export ORGB_TENANT_ID='$ORGB_TENANT_ID'"
    echo "export COOKIE_A='$ca'"
    echo "export COOKIE_A2='$cb'"
    echo "export COOKIE_B='$cc'"
    echo "export ALICE_OPENID='$ALICE_OPENID'"
    echo "export BOB_OPENID='$BOB_OPENID'"
    echo "export CAROL_OPENID='$CAROL_OPENID'"
    echo "export EIGHT_FIELDS='$(eight_fields_json)'"
  } > "$FIXTURE_ENV"
  echo "fixture up: port=$API_PORT sfx=$SFX env=$FIXTURE_ENV"
}

fixture_down() {
  if [ -f "$FIXTURE_ENV" ]; then
    # shellcheck source=/dev/null
    . "$FIXTURE_ENV"
  fi
  if [ -f "$FIXTURE_PID" ]; then
    kill "$(cat "$FIXTURE_PID")" 2>/dev/null
    rm -f "$FIXTURE_PID"
  fi
  if [ -n "${ORGA_TENANT_ID:-}" ]; then
    resolve_pg
    cleanup_seed
  fi
  rm -f "$FIXTURE_ENV"
  echo "fixture down"
}

# 各 --aN-only 段自带环境：变异证明会单独调它们，不能依赖外面先 fixture-up。
# 无参数全跑时置 SHARED_FIXTURE=1，十几个段共用一次起服务 —— CI 的 glob 棘轮闸给每个
# 基线脚本的预算是 90 秒，每段各起一次 apps/api 光等就绪就把预算烧光了。
SECTION_UP=0
SHARED_FIXTURE=0
# 复用了外部 fixture 时不许在段末把它停掉 —— 那是调用方的环境，停了它后面的断言全瞎
REUSED_FIXTURE=0
section_up() {
  if [ "$SHARED_FIXTURE" = "1" ] && [ "$SECTION_UP" = "1" ]; then
    return 0
  fi
  # 外面已经 --fixture-up 过就复用它（DoD 的内联命令是这个形态：先 --fixture-up 起环境，
  # 再调某个 --aN-only / --inv-* 段）。不复用就会撞在自己起的端口上，
  # 红的是"端口被占"而不是业务——而且那个占端口的正是本脚本自己。
  if [ -f "$FIXTURE_ENV" ] && [ -f "$FIXTURE_PID" ] && kill -0 "$(cat "$FIXTURE_PID")" 2>/dev/null; then
    # shellcheck source=/dev/null
    . "$FIXTURE_ENV"
    API="http://localhost:$API_PORT/api/knowledge/db"
    resolve_pg
    REUSED_FIXTURE=1
    return 0
  fi
  fixture_up >/dev/null
  # shellcheck source=/dev/null
  . "$FIXTURE_ENV"
  API="http://localhost:$API_PORT/api/knowledge/db"
  SECTION_UP=1
}
section_down() {
  [ "$SHARED_FIXTURE" = "1" ] && return 0
  [ "$REUSED_FIXTURE" = "1" ] && return 0
  [ "$SECTION_UP" = "1" ] && fixture_down >/dev/null
  SECTION_UP=0
}
final_down() {
  [ "$REUSED_FIXTURE" = "1" ] && return 0
  [ "$SECTION_UP" = "1" ] && fixture_down >/dev/null
  SECTION_UP=0
}
trap 'final_down' EXIT

# ═══════════════════════════════════════════════════════════════════════════
# 段2 业务判定
# ═══════════════════════════════════════════════════════════════════════════

# $1=cookie $2=表名 $3=visibility —— 八类字段各一，返回完整响应体
create_table_as() {
  curl -sf -b "$1" -H 'Content-Type: application/json' -X POST "$API/tables" \
    -d "{\"name\":\"$2\",\"visibility\":\"$3\",\"fields\":$EIGHT_FIELDS}"
}

run_a1_a3() {
  echo "== A1 反向（伪造头无效） + A3 正向对照（同一次运行内成对执行）=="
  section_up
  local fn="WB-FORGE-$SFX" code
  code=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_B" \
    -H "X-Tenant-Id: $ORGA_TENANT_ID" -H 'Content-Type: application/json' \
    -X POST "$API/tables" \
    -d "{\"name\":\"$fn\",\"visibility\":\"org\",\"org_id\":\"$ORGA_TENANT_ID\",\"tenant_id\":\"$ORGA_TENANT_ID\",\"fields\":$EIGHT_FIELDS}")
  local leaked
  leaked=$(psql_q "SELECT count(*) FROM zenithjoy.db_tables WHERE org_id = '$ORGA_TENANT_ID' AND name = '$fn'")
  [ "$leaked" = "0" ] || fail "A1 反向失败：B 企业会话伪造头把行写进了 A 企业（http=$code count=${leaked}）"
  ok "A1 反向：伪造头 + 请求体 org_id 全部无效，A 企业零新增行（http=${code}）"

  # A3 正向对照：九个端点在 A 会话下逐个 2xx —— 哪怕一个 403 都说明闸在"一律拒绝"
  local t1
  t1=$(create_table_as "$COOKIE_A" "WB-A3-$SFX" 'org' | jq -r '.data.table_id')
  [ -n "$t1" ] || fail "A3 正向失败：A 企业自己也建不出表"
  local ep=0
  for u in "GET $API/tables" "GET $API/tables/$t1" "GET $API/tables/$t1/fields" "GET $API/trash" "GET $API/templates"; do
    local m="${u%% *}" p="${u#* }" c
    c=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" -b "$COOKIE_A" "$p")
    case "$c" in 2*) ep=$((ep+1));; *) fail "A3 正向失败：$m $p 在本企业会话下返 ${c}（闸在一律拒绝）";; esac
  done
  for u in "POST $API/tables/$t1/fields" ; do
    local c
    c=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" -H 'Content-Type: application/json' \
      -X POST "$API/tables/$t1/fields" -d '{"fields":[{"name":"追加","field_type":"text","options":[],"display_order":8}]}')
    case "$c" in 2*) ep=$((ep+1));; *) fail "A3 正向失败：加字段端点返 $c";; esac
  done
  local cdel crestore
  cdel=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" -H 'Content-Type: application/json' \
    -X DELETE "$API/tables/$t1" -d "{\"confirm_name\":\"WB-A3-$SFX\"}")
  case "$cdel" in 2*) ep=$((ep+1));; *) fail "A3 正向失败：删表端点返 $cdel";; esac
  crestore=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" -X POST "$API/trash/$t1/restore")
  case "$crestore" in 2*) ep=$((ep+1));; *) fail "A3 正向失败：还原端点返 $crestore";; esac
  ok "A3 正向：建表 + 其余 8 个端点在本企业会话下全部 2xx（共 $((ep+1))/9）"
  section_down
  echo "✅ A1/A3 通过"
}

run_a7() {
  echo "== A7 开箱模板 ≥2 且一键建表结构与模板声明逐字一致 =="
  section_up
  local tpl
  tpl=$(curl -sf -b "$COOKIE_A" "$API/templates") || fail "模板端点非 2xx"
  echo "$tpl" | jq -e '.success == true and (.data.templates | length) >= 2' >/dev/null || fail "模板数 <2"
  local key exp tid got
  key=$(echo "$tpl" | jq -r '.data.templates[0].template_key')
  exp=$(echo "$tpl" | jq -Sc '[.data.templates[0].fields[] | {name,field_type,display_order}] | sort_by(.display_order)')
  tid=$(curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X POST "$API/tables" \
    -d "{\"name\":\"WB-A7-$SFX\",\"visibility\":\"org\",\"template_key\":\"$key\"}" | jq -r '.data.table_id')
  [ -n "$tid" ] && [ "$tid" != "null" ] || fail "一键建表未返 table_id"
  got=$(psql_q "SELECT json_agg(json_build_object('name', name, 'field_type', field_type, 'display_order', display_order) ORDER BY display_order) FROM zenithjoy.db_fields WHERE table_id = '$tid'" | jq -Sc '.')
  [ "$got" = "$exp" ] || fail "落库字段集与模板声明不一致 got=$got exp=$exp"
  ok "模板 $key 一键建表后字段集与声明逐字相等"
  section_down
  echo "✅ A7 通过"
}

run_a8() {
  echo "== A8 表级可见性是真访问控制（反向 404 同形 + 正向对照）=="
  section_up
  local pn="WB-PRIV-$SFX" pt rnd h1 h2 m1 m2
  pt=$(create_table_as "$COOKIE_A" "$pn" 'private' | jq -r '.data.table_id')
  [ -n "$pt" ] && [ "$pt" != "null" ] || fail "建私有表失败"
  rnd=$(psql_q "SELECT gen_random_uuid()")
  h1=$(curl -s -b "$COOKIE_A2" -o /tmp/wb-a8-1.json -w '%{http_code}' "$API/tables/$pt")
  h2=$(curl -s -b "$COOKIE_A2" -o /tmp/wb-a8-2.json -w '%{http_code}' "$API/tables/$rnd")
  [ "$h1" = "404" ] || fail "乙访问甲的私有表返 ${h1}（应 404，403 会泄漏存在性）"
  [ "$h2" = "404" ] || fail "随机 uuid 返 $h2"
  m1=$(openssl dgst -md5 < /tmp/wb-a8-1.json | awk '{print $NF}')
  m2=$(openssl dgst -md5 < /tmp/wb-a8-2.json | awk '{print $NF}')
  [ "$m1" = "$m2" ] || fail "两个 404 响应体不同 —— 可被逐个 id 枚举出他人表（$m1 vs ${m2}）"
  curl -sf -b "$COOKIE_A2" "$API/tables" | jq -e "[.data.tables[].table_id] | index(\"$pt\") | not" >/dev/null \
    || fail "乙的列表里泄漏了甲的私有表"
  curl -sf -b "$COOKIE_A" "$API/tables/$pt" | jq -e ".data.name == \"$pn\"" >/dev/null \
    || fail "正向对照失败：表主本人同时刻也访问不到（一律拒绝假绿）"
  ok "乙两个 404 逐字节同形，列表不泄漏；甲同时刻 200 且表名逐字一致"
  section_down
  echo "✅ A8 通过"
}

run_a9() {
  echo "== A9 二次确认 + 软删物理行仍在 + 30 天回收站还原 =="
  section_up
  local dn="WB-DEL-$SFX" dt c0 c1 bad
  dt=$(create_table_as "$COOKIE_A" "$dn" 'org' | jq -r '.data.table_id')
  [ -n "$dt" ] && [ "$dt" != "null" ] || fail "建表失败"
  c0=$(psql_q "SELECT count(*) FROM zenithjoy.db_tables WHERE org_id = '$ORGA_TENANT_ID'")
  bad=$(curl -s -o /tmp/wb-a9-bad.json -w '%{http_code}' -b "$COOKIE_A" -H 'Content-Type: application/json' \
    -X DELETE "$API/tables/$dt" -d "{\"confirm_name\":\"WRONG-$SFX\"}")
  [ "$bad" = "400" ] || fail "确认名不符返 ${bad}（应 400）"
  jq -e '.error.code == "CONFIRM_MISMATCH"' < /tmp/wb-a9-bad.json >/dev/null || fail "错误码不是 CONFIRM_MISMATCH"
  psql_q "SELECT count(*) FROM zenithjoy.db_tables WHERE id = '$dt' AND deleted_at IS NULL" | grep -qx 1 \
    || fail "确认名不符却已执行删除"
  curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X DELETE "$API/tables/$dt" \
    -d "{\"confirm_name\":\"$dn\"}" >/dev/null || fail "正确确认名删除非 2xx"
  psql_q "SELECT count(*) FROM zenithjoy.db_tables WHERE id = '$dt' AND deleted_at IS NOT NULL" | grep -qx 1 \
    || fail "软删未打 deleted_at"
  c1=$(psql_q "SELECT count(*) FROM zenithjoy.db_tables WHERE org_id = '$ORGA_TENANT_ID'")
  [ "$c0" = "$c1" ] || fail "物理行被删了（$c0 -> ${c1}）不是软删"
  # jq 的 fromdate 不吃毫秒（ISO 里的 .123Z），先削掉再算，否则这里会红在解析上而不是业务上
  local days
  days=$(curl -sf -b "$COOKIE_A" "$API/trash" \
    | jq -r "[.data.tables[] | select(.table_id == \"$dt\")][0]
             | ((.restorable_until | sub(\"\\\\.[0-9]+Z$\"; \"Z\") | fromdate)
                - (.deleted_at | sub(\"\\\\.[0-9]+Z$\"; \"Z\") | fromdate)) / 86400 | round")
  [ "$days" = "30" ] || fail "回收站窗口不是 30 天（got=${days}）"
  curl -sf -b "$COOKIE_A" -X POST "$API/trash/$dt/restore" >/dev/null || fail "回收站还原非 2xx"
  psql_q "SELECT count(*) FROM zenithjoy.db_tables WHERE id = '$dt' AND deleted_at IS NULL" | grep -qx 1 \
    || fail "还原后 deleted_at 未清空"
  ok "输错名零改动；正确删后 deleted_at 非空而物理行不减；30 天窗口；还原回 NULL"
  section_down
  echo "✅ A9 通过"
}

run_a10() {
  echo "== A10 建表全程零运行时 DDL =="
  section_up
  local before after
  before=$(psql_q "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'zenithjoy'")
  create_table_as "$COOKIE_A" "WB-DDL-$SFX" 'org' >/dev/null || fail "建表失败"
  after=$(psql_q "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'zenithjoy'")
  [ "$before" = "$after" ] || fail "建表前后 zenithjoy 表清单变了 —— 出现了运行时 DDL"
  for t in db_tables db_fields db_rows db_view_prefs db_audit; do
    printf '%s' "$after" | tr ',' '\n' | grep -qx "$t" || fail "migration 声明的表 $t 不在 information_schema 里"
  done
  ok "建表前后表清单全等，且 migration 声明的五张表都在"
  section_down
  echo "✅ A10 通过"
}

run_a11() {
  echo "== A11 单组织自检 fail-closed（启动期 + 请求期）=="
  section_up
  grep -q 'A11 single-org selfcheck passed' "$API_LOG" \
    || { tail -20 "$API_LOG"; fail "启动日志无 A11 自检通过标记 —— 自检根本没跑（只验端口通是假绿）"; }
  ok "正常态：服务起得来且启动日志含自检通过标记"

  # 制造多组织行 → 另起一个进程，它必须被拦在 listen 之前
  psql "$PGURL" -q -c "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id) VALUES ('$ORGB_TENANT_ID', '$ALICE_OPENID')" >/dev/null
  local mlog rc=0
  mlog="/tmp/wb-a11-mut.log"
  PORT="$MUT_PORT" timeout 40 node apps/api/dist/index.js > "$mlog" 2>&1 || rc=$?
  # rc=0 正常退出、rc=124 被 timeout 杀掉（说明它 listen 住了）—— 两种都是没拦住
  if [ "$rc" -eq 0 ] || [ "$rc" -eq 124 ]; then
    psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenant_members WHERE tenant_id = '$ORGB_TENANT_ID' AND feishu_user_id = '$ALICE_OPENID'" >/dev/null
    tail -20 "$mlog"
    fail "多组织行下进程仍起得来（exit=${rc}）—— 启动闸没拦住"
  fi
  grep -q 'A11-MULTI-ORG' "$mlog" || { tail -20 "$mlog"; psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenant_members WHERE tenant_id = '$ORGB_TENANT_ID' AND feishu_user_id = '$ALICE_OPENID'" >/dev/null; fail "进程退出但日志未点名 A11-MULTI-ORG"; }
  ok "多组织态：进程 exit=${rc}（∉{0,124}）且日志点名 A11-MULTI-ORG"

  # 请求期：同一情形必须 409，绝不静默取第一条
  local c409
  c409=$(curl -s -o /tmp/wb-a11-req.json -w '%{http_code}' -b "$COOKIE_A" "$API/tables")
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenant_members WHERE tenant_id = '$ORGB_TENANT_ID' AND feishu_user_id = '$ALICE_OPENID'" >/dev/null
  [ "$c409" = "409" ] || { cat /tmp/wb-a11-req.json; fail "请求期多组织返 ${c409}（应 409）"; }
  jq -e '.error.code == "MULTI_ORG_MEMBER" and .data == null' < /tmp/wb-a11-req.json >/dev/null \
    || fail "请求期错误码不是 MULTI_ORG_MEMBER 或 data 非 null"
  ok "请求期：409 MULTI_ORG_MEMBER 且 data 为 null"
  section_down
  echo "✅ A11 通过"
}

run_a4() {
  echo "== A4 / J7 五段 =="
  section_up
  local base="http://localhost:$API_PORT"

  # 段① 新表 org_id NOT NULL
  local nullable
  nullable=$(psql_q "SELECT is_nullable FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='db_fields' AND column_name='org_id'")
  [ "$nullable" = "NO" ] || fail "段①：db_fields.org_id 不是 NOT NULL（got=${nullable}）"
  ok "段①：db_fields.org_id NOT NULL"

  # 段② 旧四端点无身份 → 401
  local n401=0
  for u in "GET $base/api/fields" "POST $base/api/fields" "PUT $base/api/fields/$(psql_q 'SELECT gen_random_uuid()')" "DELETE $base/api/fields/$(psql_q 'SELECT gen_random_uuid()')"; do
    local m="${u%% *}" p="${u#* }" c
    c=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" -H 'Content-Type: application/json' -d '{}' "$p")
    [ "$c" = "401" ] || fail "段②：$m $p 无身份返 ${c}（应 401）"
    n401=$((n401 + 1))
  done
  [ "$n401" = "4" ] || fail "段②：只探测了 $n401 个端点"
  ok "段②：/api/fields 四端点无身份全 401"

  # 段③ 反向 + 正向对照
  local fa fb hb_before hb_after ids
  fa=$(psql_q "INSERT INTO zenithjoy.field_definitions (field_name, field_type, tenant_id) VALUES ('legacy_a_$SFX', 'text', '$ORGA_TENANT_ID') RETURNING id")
  fb=$(psql_q "INSERT INTO zenithjoy.field_definitions (field_name, field_type, tenant_id) VALUES ('legacy_b_$SFX', 'text', '$ORGB_TENANT_ID') RETURNING id")
  [ -n "$fa" ] && [ -n "$fb" ] || fail "段③：两家各种一行失败"
  hb_before=$(psql_q "SELECT md5(row(field_name, field_type, display_order, is_visible, tenant_id)::text) FROM zenithjoy.field_definitions WHERE id = '$fb'")
  ids=$(curl -sf -b "$COOKIE_A" "$base/api/fields" | jq -c 'if type == "array" then . else .data end | map(.id)')
  echo "$ids" | jq -e "index(\"$fb\") | not" >/dev/null || fail "段③ 反向：A 企业读到了 B 企业的行"
  echo "$ids" | jq -e "index(\"$fa\") != null" >/dev/null || fail "段③ 正向：A 读不到自己那一行（实现在一律返空）"
  local newname="fwd_a_renamed_$SFX"
  curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X PUT "$base/api/fields/$fa" \
    -d "{\"field_name\":\"$newname\"}" >/dev/null || fail "段③ 正向：A 改不动自己那一行（实现在一律 403）"
  psql_q "SELECT count(*) FROM zenithjoy.field_definitions WHERE id = '$fa' AND field_name = '$newname'" | grep -qx 1 \
    || fail "段③ 正向：PUT 返 2xx 但 field_name 没真落库"
  local cput cdel
  cput=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" -H 'Content-Type: application/json' \
    -X PUT "$base/api/fields/$fb" -d "{\"field_name\":\"hacked_$SFX\"}")
  case "$cput" in 403|404) :;; *) fail "段③ 反向：A 改 B 的行返 ${cput}（应 403/404）";; esac
  cdel=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" -X DELETE "$base/api/fields/$fb")
  case "$cdel" in 403|404) :;; *) fail "段③ 反向：A 删 B 的行返 ${cdel}（应 403/404）";; esac
  hb_after=$(psql_q "SELECT md5(row(field_name, field_type, display_order, is_visible, tenant_id)::text) FROM zenithjoy.field_definitions WHERE id = '$fb'")
  [ -n "$hb_after" ] && [ "$hb_before" = "$hb_after" ] || fail "段③ 反向：B 的行被改动了"
  ok "段③：反向读改删全被拒且 B 行 md5 未变；正向读得到、改得动、真落库"

  # 段④ 回归 spec 存在且零 page.route
  local spec="apps/dashboard/e2e/fields-auth-regression.spec.ts"
  [ -f "$spec" ] || fail "段④：dashboard 回归 spec 不存在 $spec"
  grep -qF 'page.route(' "$spec" && fail "段④：回归 spec 用了 page.route（变体C 死规则：必须打真后端）"
  ok "段④：回归 spec 存在且零 page.route"

  # 段⑤ 处置结果落 decisions（在 Brain/cecelia 库，不在 zenithjoy 库）
  local q c
  q="SELECT count(*) FROM public.decisions WHERE category IN ('rec','invariant') AND (to_jsonb(decisions.*)::text) LIKE '%1ae57f1a%' AND (to_jsonb(decisions.*)::text) LIKE '%field_definitions%'"
  if [ -n "${BRAIN_DATABASE_URL:-}" ]; then
    c=$(psql "$BRAIN_DATABASE_URL" -t -A -c "$q") || fail "段⑤：BRAIN_DATABASE_URL 连不上 Brain 库"
  else
    c=$(curl -sf "${BRAIN_API_BASE:-http://localhost:5221}/api/brain/decisions?limit=1000" \
      | jq '[.[] | select(.category == "rec" or .category == "invariant") | select((tostring | contains("1ae57f1a")) and (tostring | contains("field_definitions")))] | length') \
      || fail "段⑤：未设 BRAIN_DATABASE_URL 且 Brain API 不可达 —— decisions 在 Brain(cecelia) 库，不许拿 E2E_DATABASE_URL 兜"
  fi
  [ -n "$c" ] || fail "段⑤：decisions 查询无返回"
  [ "$c" -ge 1 ] || fail "段⑤：decisions 无该处置记录（需 category=rec|invariant 且正文同时含 1ae57f1a 与 field_definitions）"
  ok "段⑤：decisions 已落该处置记录（$c 条）"

  psql "$PGURL" -q -c "DELETE FROM zenithjoy.field_definitions WHERE id IN ('$fa','$fb')" >/dev/null 2>&1
  section_down
  echo "✅ A4 五段通过"
}

# ── INV 段 ───────────────────────────────────────────────────────────────────

run_inv_tenant_isolation() {
  echo "== INV-1 租户隔离：静态 SQL 带 org_id + 运行时跨企业不可达 =="
  # 静态：service 里每条触碰五表的 SQL 都要带 org_id。
  # 用 node 按模板字面量整块取（SQL 跨多行，行级 grep 会把一条语句拆成好几段各自判定，
  # 于是"WHERE org_id"在下一行的正确写法反而被判成违规）。
  node - "$SERVICE_FILE" <<'NODEEOF' || fail "INV-1 静态：存在不带 org_id 条件的五表 SQL"
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const TABLES = /zenithjoy\.(db_tables|db_fields|db_rows|db_view_prefs|db_audit)\b/;
// 取出所有反引号模板字面量与单引号字符串（SQL 都在里面）
const blocks = [...src.matchAll(/`([^`]*)`|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? '');
let bad = 0, checked = 0;
for (const b of blocks) {
  if (!TABLES.test(b)) continue;
  if (!/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(b)) continue;
  checked += 1;
  if (!/org_id/.test(b)) {
    console.error('  ❌ 无 org_id 的五表 SQL:', b.replace(/\s+/g, ' ').slice(0, 160));
    bad = 1;
  }
}
if (checked === 0) { console.error('  ❌ 一条五表 SQL 都没扫到 —— 扫描口径失效，零违规是假绿'); bad = 1; }
else if (!bad) console.log(`  ✅ 静态：${checked} 条五表 SQL 全带 org_id`);
process.exit(bad);
NODEEOF

  section_up
  local t
  t=$(create_table_as "$COOKIE_A" "WB-INV1-$SFX" 'org' | jq -r '.data.table_id')
  [ -n "$t" ] && [ "$t" != "null" ] || fail "INV-1 建表失败"
  local c
  c=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_B" "$API/tables/$t")
  [ "$c" = "404" ] || fail "INV-1 运行时：B 企业读 A 企业的表返 ${c}（应 404）"
  curl -sf -b "$COOKIE_B" "$API/tables" | jq -e "[.data.tables[].table_id] | index(\"$t\") | not" >/dev/null \
    || fail "INV-1 运行时：B 企业列表里出现 A 企业的表"
  ok "运行时：跨企业读返 404、列表空集"
  section_down
  echo "✅ INV-1 通过"
}

run_inv_endpoint_auth() {
  echo "== INV-2 端点鉴权：路③ 九端点 + 旧 fields 四端点无会话逐个 401 =="
  section_up
  local base="http://localhost:$API_PORT" rnd n=0
  rnd=$(psql_q "SELECT gen_random_uuid()")
  local eps=(
    "GET $API/tables" "GET $API/tables/$rnd" "GET $API/tables/$rnd/fields" "GET $API/trash" "GET $API/templates"
    "POST $API/tables" "POST $API/tables/$rnd/fields" "DELETE $API/tables/$rnd" "POST $API/trash/$rnd/restore"
    "GET $base/api/fields" "POST $base/api/fields" "PUT $base/api/fields/$rnd" "DELETE $base/api/fields/$rnd"
  )
  for u in "${eps[@]}"; do
    local m="${u%% *}" p="${u#* }" c
    c=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" -H 'Content-Type: application/json' -d '{}' "$p")
    [ "$c" = "401" ] || fail "INV-2：$m $p 无会话返 ${c}（应 401）"
    n=$((n + 1))
  done
  [ "$n" = "13" ] || fail "INV-2：只探测了 $n 个端点（应 13）"
  ok "13 个端点无会话全部 401"
  section_down
  echo "✅ INV-2 通过"
}

run_inv_two_tenant_seed() {
  echo "== INV-3 测试默认多租户：smoke 与 tests 都种 ≥2 企业 =="
  grep -q 'ORGB_TENANT_ID' "${BASH_SOURCE[0]}" || fail "smoke 自身未种第二家企业"
  local fx="$SPRINT_DIR/tests/_workbench-fixture.ts"
  [ -f "$fx" ] || fail "测试夹具不存在：$fx"
  grep -q 'orgBTenantId' "$fx" || fail "测试夹具未种第二家企业 —— 单租户种子会让隔离漏洞永远看不见"
  grep -qE 'INSERT INTO zenithjoy\.tenants' "$fx" || fail "测试夹具未真插 tenants 行"
  local n
  n=$(grep -c 'INSERT INTO zenithjoy.tenants' "$fx")
  [ "$n" -ge 1 ] || fail "夹具 tenants 插入语句数 $n"
  section_up
  [ -n "$ORGA_TENANT_ID" ] && [ -n "$ORGB_TENANT_ID" ] && [ "$ORGA_TENANT_ID" != "$ORGB_TENANT_ID" ] \
    || fail "运行时两家企业 id 相同或为空"
  ok "smoke 与 tests 均种两家企业且 id 互不相同"
  section_down
  echo "✅ INV-3 通过"
}

run_inv_log_redaction() {
  echo "== INV-5 日志脱敏：真跑一轮建表后日志无表名/字段名正文 =="
  section_up
  local secret="WB-SECRET-NAME-$SFX"
  curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X POST "$API/tables" \
    -d "{\"name\":\"$secret\",\"visibility\":\"org\",\"fields\":[{\"name\":\"$secret-field\",\"field_type\":\"text\",\"options\":[],\"display_order\":0}]}" >/dev/null \
    || fail "INV-5 建表失败"
  sleep 1
  if grep -qF "$secret" "$API_LOG"; then
    grep -nF "$secret" "$API_LOG" | head -5 | sed 's/^/     /'
    fail "INV-5：apps/api 日志里出现了表名/字段名正文（只许出现 id）"
  fi
  ok "建表后日志零表名/字段名正文"
  section_down
  echo "✅ INV-5 通过"
}

run_inv_seam_ledger() {
  echo "== INV-6 接缝台账：S1–S5 逐条有真目标证据或显式挂起标记 =="
  local ledger="$SPRINT_DIR/seam-ledger.md"
  [ -f "$ledger" ] || fail "接缝台账不存在：$ledger"
  for s in S1 S2 S3 S4 S5; do
    grep -qE "^\| $s \|" "$ledger" || fail "接缝台账缺 $s 行"
    local line status
    line=$(grep -E "^\| $s \|" "$ledger" | head -1)
    status=$(echo "$line" | awk -F'|' '{print $5}' | tr -d ' ')
    case "$status" in
      done|logic-done-pending|logic-done-pending-offsite) ok "$s 状态=$status";;
      *) fail "$s 状态非法（got='$status'）—— 未真验必须显式标 logic-done-pending，不得标 done";;
    esac
  done
  echo "✅ INV-6 通过"
}

# 本 feature 自己的合法写入方——必须排除在 INV-9 之外，理由见下方注释。
INV9_OWNER='apps/api/src/services/workbench.service.ts'

run_inv_table_claim() {
  echo "== INV-9 表名认领：五张新表在 origin/main 上零**第三方**写入方 =="
  # 这道闸问的是"这五个表名有没有被别人占用"，防的是 schema 撞车。
  #
  # ⚠️ 2026-08-20 修（PR#1684）：原版查的是"零写入方"且不排除自己。它在本 feature 的
  # PR 上通过，是因为那时 origin/main 还没有 workbench.service.ts；一旦合并进 main，
  # 自己就成了"既有写入方"，此后**每一个碰 smoke 目录的 PR 都会被它卡死**——一颗
  # 合并即引爆的自毁地雷（PR#1684 是第一个踩到的）。加 :!OWNER 排除后它继续能抓
  # 真正的第三方撞车（去掉排除项立刻报出那 3 处并 FAIL，变异验证过），只是不再拦自己人。
  #
  # 另修两处可移植性——**正是它们让这颗地雷在本地隐身**：
  #   1. `\s` 和 `\b` 都是 GNU 扩展，macOS 的 git grep -E 不认 → 本地跑永远 0 处（假绿），
  #      只有 Linux CI 会真报。改用 POSIX 的 [[:space:]] 与 ([^a-zA-Z0-9_]|$)
  #      （等价词边界，实测不会误伤 db_tables_backup 这类相似表名）
  #   2. `apps/**/*.ts` 这个 pathspec 两边 git 行为不一致（本地匹配不到
  #      apps/api/src/services/*.ts），改用目录前缀 `apps/` —— 两边都覆盖全子树
  # 改完后本地与 CI 结果一致：排除前 3 处、排除后 0 处。
  for t in db_tables db_fields db_rows db_view_prefs db_audit; do
    local n re
    re="(INSERT INTO|UPDATE|DELETE FROM)[[:space:]]+(zenithjoy\.)?${t}([^a-zA-Z0-9_]|\$)"
    n=$(git grep -InE "$re" origin/main -- 'apps/' ":!$INV9_OWNER" 2>/dev/null | wc -l | tr -d ' ')
    [ "$n" = "0" ] || { git grep -InE "$re" origin/main -- 'apps/' ":!$INV9_OWNER" | head -5; fail "INV-9：$t 在 origin/main 上已有 $n 处**第三方**写入方 —— schema 撞车"; }
    ok "$t 在 origin/main 上零第三方写入方"
  done
  echo "✅ INV-9 通过"
}

# ═══════════════════════════════════════════════════════════════════════════
# dispatch
# ═══════════════════════════════════════════════════════════════════════════

case "${1:-}" in
  --a2-print-scope)  run_a2_print_scope; exit 0;;
  --a2-only)         run_a2; exit 0;;
  --a35-only)        run_a35; exit 0;;
  --a33-only)        run_a33; exit 0;;
  --static-only)     run_static; exit 0;;
  --mutation-list)   mutation_list; exit 0;;
  --mutation-apply)  mutation_apply "${2:?缺变异名}"; exit 0;;
  --mutation-revert) mutation_revert "${2:?缺变异名}"; exit 0;;
  --fixture-up)      fixture_up; exit 0;;
  --fixture-down)    fixture_down; exit 0;;
esac

# 以下都需要 DB
resolve_pg

case "${1:-}" in
  --a1-a3-only)             run_a1_a3; exit 0;;
  --a4-only)                run_a4; exit 0;;
  --a7-only)                run_a7; exit 0;;
  --a8-only)                run_a8; exit 0;;
  --a9-only)                run_a9; exit 0;;
  --a10-only)               run_a10; exit 0;;
  --a11-only)               run_a11; exit 0;;
  --inv-tenant-isolation)   run_inv_tenant_isolation; exit 0;;
  --inv-endpoint-auth)      run_inv_endpoint_auth; exit 0;;
  --inv-two-tenant-seed)    run_inv_two_tenant_seed; exit 0;;
  --inv-log-redaction)      run_inv_log_redaction; exit 0;;
  --inv-seam-ledger)        run_inv_seam_ledger; exit 0;;
  --inv-table-claim)        run_inv_table_claim; exit 0;;
  '') ;;
  *) fail "未知参数：$1";;
esac

# ── 无参数：段1 + 段2 全跑（CI 棘轮闸走这条路径）──────────────────────────────
#
# 这里**不含**三段，它们的判据在 contract-dod.md 里各自用显式 flag 调用，由 evaluator
# 在宿主机跑。放进无参数全跑只会让 CI 的棘轮闸红在环境上，而不是红在业务上：
#
#   --a4-only          段⑤ 的 oracle 是 decisions 表，它在 **Brain(cecelia) 库**，
#                      GitHub Actions runner 上物理不可达（既不是 zenithjoy 库，
#                      也没有 localhost:5221）。段①②③④ 的等价判定已被 --inv-endpoint-auth
#                      与 --inv-tenant-isolation 覆盖在全跑里。
#   --a11-only         要真起第二个进程验"拦在 listen 之前"，含 40 秒 timeout 兜底，
#                      单这一段就吃掉棘轮闸给每个脚本的大半预算。
#   --inv-table-claim  要 `git grep origin/main`，而 glob runner 的 checkout 是 depth=1，
#                      根本没有那个 ref。e2e-knowledge-hub-path3.yml 里用 fetch-depth: 0 跑它。
#
# 共享一次 fixture：起一次 apps/api，十几个段复用，全跑约 40~60 秒。
SHARED_FIXTURE=1
run_static
run_a1_a3
run_a7
run_a8
run_a9
run_a10
run_inv_tenant_isolation
run_inv_endpoint_auth
run_inv_two_tenant_seed
run_inv_log_redaction
run_inv_seam_ledger
final_down
echo "✅ 路③ Sprint A smoke 全绿（静态守卫 + 真库真验全链 + INV）"
echo "   另有三段需显式调用（判据见 contract-dod.md）：--a4-only / --a11-only / --inv-table-claim"
