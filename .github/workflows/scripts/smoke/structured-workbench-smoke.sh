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
#   bash structured-workbench-smoke.sh --a12-only|--a13-only|--a15-only|--a16-only|--a17-only|--a18-a19-only|--a1-a3-rows-only
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
ROWS_SERVICE_FILE="apps/api/src/services/workbench-rows.service.ts"
VIEWS_SERVICE_FILE="apps/api/src/services/workbench-views.service.ts"
KANBAN_FILE="apps/staff-hub/src/lib/workbenchKanban.ts"
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
DIST_ROWS_SERVICE="apps/api/dist/services/workbench-rows.service.js"
DIST_VIEWS_SERVICE="apps/api/dist/services/workbench-views.service.js"
DIST_SELFCHECK="apps/api/dist/startup/single-org-selfcheck.js"

INJECT_SECRET_FILE="apps/api/src/knowledge/.wb-mutation-secret.ts"

mutation_list() {
  # 每行：<变异名><空白><注入次数>。合计 20 开关（Sprint C 新增末尾七条）。
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
A13-version-nocheck	1
A16-row-hard-delete	1
A1R-row-org-bypass	2
A15-limit-off	1
A25-field-whitelist-off	1
A20-group-type-nocheck	1
A20-ungrouped-null-only	1
A1V-view-org-bypass	1
A1V-view-member-bypass	1
VIEW-lastview-off	1
A24-drag-wrong-row	1
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
    A13-version-nocheck)
      save_file "$ROWS_SERVICE_FILE"; save_file "$DIST_ROWS_SERVICE"
      # 把带条件 UPDATE 的 version 检查改成恒真（等价于"注掉 version 检查"）：
      # `AND r.version = $5` → `AND r.version = r.version AND 0 <> $5`，SQL 依然合法，
      # 参数一个不少，只是不再拿基线比对 —— 后到的那个 PATCH 会 200 并把先提交者的值盖掉。
      # perl 表达式一律用**单引号**：双引号里的 $5 会先被 bash 展开成空串，模式就永远匹配不上，
      # 变异静默失效、守卫看着"证明"过了（Sprint A 的 A8/A9 已经踩过这一脚）。
      perl -0pi -e 's/AND r\.version = /AND r.version = r.version AND 0 <> /g' "$ROWS_SERVICE_FILE"
      [ -f "$DIST_ROWS_SERVICE" ] && perl -0pi -e 's/AND r\.version = /AND r.version = r.version AND 0 <> /g' "$DIST_ROWS_SERVICE"
      echo "$ROWS_SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A16-row-hard-delete)
      save_file "$ROWS_SERVICE_FILE"; save_file "$DIST_ROWS_SERVICE"
      # 软删改成物理删：API 层看起来一模一样，只有查库（物理行计数）与"还原拿不拿得回来"分得出。
      # 整段 UPDATE...SET 换成 DELETE + 行注释，后面的 WHERE / RETURNING 原样留着，SQL 仍合法。
      perl -0pi -e 's/\QUPDATE zenithjoy.db_rows r SET deleted_at = NOW(), updated_at = NOW()\E/DELETE FROM zenithjoy.db_rows r --/g' "$ROWS_SERVICE_FILE"
      [ -f "$DIST_ROWS_SERVICE" ] && perl -0pi -e 's/\QUPDATE zenithjoy.db_rows r SET deleted_at = NOW(), updated_at = NOW()\E/DELETE FROM zenithjoy.db_rows r --/g' "$DIST_ROWS_SERVICE"
      echo "$ROWS_SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A1R-row-org-bypass)
      save_file "$ROWS_SERVICE_FILE"; save_file "$DIST_ROWS_SERVICE"
      # 行读写 SQL 的组织条件改成恒真（行侧 + 表侧各一处），B 企业会话就能读到 A 企业的行。
      # 不是直接删掉 `= $2`：删了参数个数对不上，PG 会报 bind 错，段红在"连不上"而不是隔离上。
      perl -0pi -e 's/AND r\.org_id = \$2/AND (r.org_id = \$2 OR \$2 IS NOT NULL)/g' "$ROWS_SERVICE_FILE"
      perl -0pi -e 's/AND t\.org_id = \$2/AND (t.org_id = \$2 OR \$2 IS NOT NULL)/g' "$ROWS_SERVICE_FILE"
      if [ -f "$DIST_ROWS_SERVICE" ]; then
        perl -0pi -e 's/AND r\.org_id = \$2/AND (r.org_id = \$2 OR \$2 IS NOT NULL)/g' "$DIST_ROWS_SERVICE"
        perl -0pi -e 's/AND t\.org_id = \$2/AND (t.org_id = \$2 OR \$2 IS NOT NULL)/g' "$DIST_ROWS_SERVICE"
      fi
      echo "$ROWS_SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A15-limit-off)
      save_file "$ROWS_SERVICE_FILE"; save_file "$DIST_ROWS_SERVICE"
      # 上限判定改成恒放行：超限批次会整批落库，"整批拒绝"那条断言必须当场红
      perl -0pi -e 's/return total \+ incoming > limit;/return false;/g' "$ROWS_SERVICE_FILE"
      [ -f "$DIST_ROWS_SERVICE" ] && perl -0pi -e 's/return total \+ incoming > limit;/return false;/g' "$DIST_ROWS_SERVICE"
      echo "$ROWS_SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A25-field-whitelist-off)
      save_file "$ROWS_SERVICE_FILE"; save_file "$DIST_ROWS_SERVICE"
      # 摘掉 field_id → 本表字段集的白名单成员判定：belongs 恒真，跨表 field_id 不再 404
      # （降级成 text 兜底字段照常排序返 200）。--a25-only 的「跨表 UUID → 404」当场红。
      perl -0pi -e 's/const belongs = known !== undefined;/const belongs = true;/g' "$ROWS_SERVICE_FILE"
      [ -f "$DIST_ROWS_SERVICE" ] && perl -0pi -e 's/const belongs = known !== undefined;/const belongs = true;/g' "$DIST_ROWS_SERVICE"
      echo "$ROWS_SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A20-group-type-nocheck)
      save_file "$VIEWS_SERVICE_FILE"; save_file "$DIST_VIEWS_SERVICE"
      # 分组字段类型闸摘掉：非单选类型不再 400，--a20-only 的「七类 → 400」当场红。
      # 锚在 `!== 'single_select'` 上追加 `&& false`，条件恒假 → 永不抛 GroupFieldTypeError。
      perl -0pi -e "s/!== 'single_select'/!== 'single_select' && false/g" "$VIEWS_SERVICE_FILE"
      [ -f "$DIST_VIEWS_SERVICE" ] && perl -0pi -e "s/!== 'single_select'/!== 'single_select' && false/g" "$DIST_VIEWS_SERVICE"
      echo "$VIEWS_SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A20-ungrouped-null-only)
      save_file "$KANBAN_FILE"
      # 未分组三态判据改成只判 null：缺键/空串的卡片凭空消失，--a20-only 的三态纯函数用例当场红。
      # 把「缺键」与「空串」两条 return true 摘掉（只留 null 那条）。
      perl -0pi -e "s/if \(!\(groupFieldId in row\.data\)\) return true; \/\/ 缺键/\/\/ 缺键判据被摘（变异）/g" "$KANBAN_FILE"
      perl -0pi -e "s/if \(typeof v === 'string' && v\.length === 0\) return true; \/\/ 空串/\/\/ 空串判据被摘（变异）/g" "$KANBAN_FILE"
      echo "$KANBAN_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A1V-view-org-bypass)
      save_file "$VIEWS_SERVICE_FILE"; save_file "$DIST_VIEWS_SERVICE"
      # 视图归属的 org 维条件改成恒真（读路径 resolveViewRow/listViews 的 v.org_id + 写路径 UPDATE/DELETE 的
      # 裸 org_id 两处都摘，否则纵深防御里另一层 org 闸会替它挡住、变异静默失效）：
      # 同 member 跨企业的孪生视图会被够到，--a1-a3-views-only 的 org 探针当场红。
      for f in "$VIEWS_SERVICE_FILE" "$DIST_VIEWS_SERVICE"; do
        [ -f "$f" ] || continue
        perl -0pi -e 's/v\.org_id = \$2/(v.org_id = \$2 OR \$2 IS NOT NULL)/g' "$f"
        perl -0pi -e 's/AND org_id = \$2 AND member_id = \$3/AND (org_id = \$2 OR \$2 IS NOT NULL) AND member_id = \$3/g' "$f"
      done
      echo "$VIEWS_SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A1V-view-member-bypass)
      save_file "$VIEWS_SERVICE_FILE"; save_file "$DIST_VIEWS_SERVICE"
      # 视图归属的 member 维条件改成恒真（读路径 v.member_id + 写路径裸 member_id 两处都摘）：
      # 同组织他人的视图列表会命中本人视图、也能读改本人视图，--a1-a3-views-only 的 member 探针当场红。
      for f in "$VIEWS_SERVICE_FILE" "$DIST_VIEWS_SERVICE"; do
        [ -f "$f" ] || continue
        perl -0pi -e 's/v\.member_id = \$3/(v.member_id = \$3 OR \$3 IS NOT NULL)/g' "$f"
        perl -0pi -e 's/AND member_id = \$3/AND (member_id = \$3 OR \$3 IS NOT NULL)/g' "$f"
      done
      echo "$VIEWS_SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    VIEW-lastview-off)
      save_file "$VIEWS_SERVICE_FILE"; save_file "$DIST_VIEWS_SERVICE"
      # 「至少保留一个视图」判据摘掉：删到最后一个不再 400，--view-delete-only 当场红。
      perl -0pi -e 's/Number\(c\.rows\[0\]\.n\) <= 1/Number(c.rows[0].n) <= 0/g' "$VIEWS_SERVICE_FILE"
      [ -f "$DIST_VIEWS_SERVICE" ] && perl -0pi -e 's/Number\(c\.rows\[0\]\.n\) <= 1/Number(c.rows[0].n) <= 0/g' "$DIST_VIEWS_SERVICE"
      echo "$VIEWS_SERVICE_FILE" > "$MUTATION_TARGET_FILE"
      ;;
    A24-drag-wrong-row)
      save_file "$KANBAN_FILE"
      # 拖卡落库映射恒返 rows[0]：拖到哪张卡都改第一行，--a24-pure-only 的「映射被拖那一行」单测当场红。
      perl -0pi -e "s/const row = rows\.find\(\(r\) => r\.row_id === activeCardId\);/const row = rows[0];/g" "$KANBAN_FILE"
      echo "$KANBAN_FILE" > "$MUTATION_TARGET_FILE"
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
    A13-version-nocheck)  restore_file "$ROWS_SERVICE_FILE"; restore_file "$DIST_ROWS_SERVICE";;
    A16-row-hard-delete)  restore_file "$ROWS_SERVICE_FILE"; restore_file "$DIST_ROWS_SERVICE";;
    A1R-row-org-bypass)   restore_file "$ROWS_SERVICE_FILE"; restore_file "$DIST_ROWS_SERVICE";;
    A15-limit-off)        restore_file "$ROWS_SERVICE_FILE"; restore_file "$DIST_ROWS_SERVICE";;
    A25-field-whitelist-off) restore_file "$ROWS_SERVICE_FILE"; restore_file "$DIST_ROWS_SERVICE";;
    A20-group-type-nocheck)  restore_file "$VIEWS_SERVICE_FILE"; restore_file "$DIST_VIEWS_SERVICE";;
    A20-ungrouped-null-only) restore_file "$KANBAN_FILE";;
    A1V-view-org-bypass)     restore_file "$VIEWS_SERVICE_FILE"; restore_file "$DIST_VIEWS_SERVICE";;
    A1V-view-member-bypass)  restore_file "$VIEWS_SERVICE_FILE"; restore_file "$DIST_VIEWS_SERVICE";;
    VIEW-lastview-off)       restore_file "$VIEWS_SERVICE_FILE"; restore_file "$DIST_VIEWS_SERVICE";;
    A24-drag-wrong-row)      restore_file "$KANBAN_FILE";;
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
# ⚠️ 用**前缀**而不是逐个文件名：PR#1684 只排了 workbench.service.ts，结果 #1685 新增
# workbench-rows.service.ts 一合并，这道闸立刻又把所有 PR 卡死一次（PR#1687 踩到）。
# 本 feature 后面还会继续拆文件，逐个补白名单等于把地雷重新埋一遍。
INV9_OWNER_PREFIX='apps/api/src/services/workbench'

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
    n=$(git grep -InE "$re" origin/main -- 'apps/' ":!${INV9_OWNER_PREFIX}*" 2>/dev/null | wc -l | tr -d ' ')
    [ "$n" = "0" ] || { git grep -InE "$re" origin/main -- 'apps/' ":!${INV9_OWNER_PREFIX}*" | head -5; fail "INV-9：$t 在 origin/main 上已有 $n 处**第三方**写入方 —— schema 撞车"; }
    ok "$t 在 origin/main 上零第三方写入方"
  done
  echo "✅ INV-9 通过"
}

# ═══════════════════════════════════════════════════════════════════════════
# 段2（Sprint B / S2）行层业务判定
#
# 七个段各自 section_up：变异证明会单独调它们，不能依赖外面先 fixture-up；
# 外面已经 --fixture-up 过时 section_up 会复用那个环境（REUSED_FIXTURE=1，段末不停它）。
# ═══════════════════════════════════════════════════════════════════════════

# $1=fields 响应体 $2=field_type —— 取稳定 field_id（PATCH 的 data key 一律是它）
field_id_of() { printf '%s' "$1" | jq -r --arg t "$2" '.data.fields[] | select(.field_type == $t) | .field_id'; }

# $1=cookie $2=table_id
create_row_as() { curl -sf -b "$1" -X POST "$API/tables/$2/rows" | jq -r '.data.row_id'; }

run_a12() {
  echo "== A12 行内改格：八类字段各一次逐字落库，version 1→9，类型不符 400 且零改动 =="
  section_up
  local tid fld rid ver=1 t fid val resp
  tid=$(create_table_as "$COOKIE_A" "WB-S2-A12-$SFX" 'org' | jq -r '.data.table_id')
  [ -n "$tid" ] && [ "$tid" != "null" ] || fail "A12 建表失败"
  fld=$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/fields") || fail "A12 取字段失败"
  rid=$(create_row_as "$COOKIE_A" "$tid")
  [ -n "$rid" ] && [ "$rid" != "null" ] || fail "A12 建行失败"

  for t in text long_text number date single_select multi_select person url; do
    fid=$(field_id_of "$fld" "$t")
    [ -n "$fid" ] && [ "$fid" != "null" ] || fail "A12 $t 字段缺 field_id"
    case "$t" in
      number)        val='12.5';;
      date)          val='"2026-08-20"';;
      single_select) val='"甲"';;
      multi_select)  val='["甲","乙"]';;
      person)        val="\"$ALICE_OPENID\"";;
      url)           val="\"https://example.com/$t\"";;
      *)             val="\"$t-值-$SFX\"";;
    esac
    resp=$(curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X PATCH "$API/rows/$rid" \
      -d "{\"version\":$ver,\"data\":{\"$fid\":$val}}") || fail "A12 $t PATCH 非 2xx"
    ver=$((ver + 1))
    printf '%s' "$resp" | jq -e ".data.version == $ver" >/dev/null || fail "A12 $t 之后 version 不是 $ver"
    # jsonb 全等回读：多选数组也能逐字比，字符串比对分辨不出 ["甲","乙"] 与 "甲、乙"
    psql_q "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.id = '$rid' AND r.data -> '$fid' = '$val'::jsonb" \
      | grep -qx 1 || fail "A12 $t 落库值与所打内容不逐字相等（期望 ${val}）"
  done
  [ "$ver" = "9" ] || fail "A12 八次 PATCH 后 version=${ver}（应为 9）"
  psql_q "SELECT r.version FROM zenithjoy.db_rows r WHERE r.id = '$rid'" | grep -qx 9 \
    || fail "A12 库中 version 不是 9"
  ok "八类字段逐字落库，version 1→9"

  local fnum before after code
  fnum=$(field_id_of "$fld" number)
  before=$(psql_q "SELECT r.data::text FROM zenithjoy.db_rows r WHERE r.id = '$rid'")
  code=$(curl -s -o /tmp/wb-a12-bad.json -w '%{http_code}' -b "$COOKIE_A" -H 'Content-Type: application/json' \
    -X PATCH "$API/rows/$rid" -d "{\"version\":9,\"data\":{\"$fnum\":\"12\"}}")
  [ "$code" = "400" ] || fail "A12 类型不符返 ${code}（应 400）"
  jq -e '.error.code == "VALIDATION_FAILED"' < /tmp/wb-a12-bad.json >/dev/null \
    || fail "A12 错误码不是 VALIDATION_FAILED"
  after=$(psql_q "SELECT r.data::text FROM zenithjoy.db_rows r WHERE r.id = '$rid'")
  [ "$before" = "$after" ] || fail "A12 校验失败却改了库（$before -> ${after}）"
  ok "类型不符 400 VALIDATION_FAILED 且该格逐字未变"
  section_down
  echo "✅ A12 通过"
}

run_a13() {
  echo "== A13 并发同格：恰一个 200 一个 409，库中值 = 先提交者 =="
  section_up
  local tid ft rid vn c1 c2 okc cfc loser winv got p1 p2
  tid=$(create_table_as "$COOKIE_A" "WB-S2-A13-$SFX" 'org' | jq -r '.data.table_id')
  ft=$(field_id_of "$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/fields")" text)
  rid=$(create_row_as "$COOKIE_A" "$tid")
  [ -n "$rid" ] && [ "$rid" != "null" ] || fail "A13 建行失败"
  vn=$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/rows" | jq -r ".data.rows[] | select(.row_id == \"$rid\") | .version")
  [ -n "$vn" ] || fail "A13 取不到基线 version"

  # 真并发：两个真会话、同一基线、后台并行发出，不串行（串行测的是分支不是竞态）。
  # 裸 `wait` 会连 fixture 起的 apps/api 那个后台子进程一起等 —— 它不会自己退出，段直接挂死。
  # 只等这两个 curl 的 PID。
  curl -s -o /tmp/wb-a13-1.json -w '%{http_code}' -b "$COOKIE_A" -H 'Content-Type: application/json' \
    -X PATCH "$API/rows/$rid" -d "{\"version\":$vn,\"data\":{\"$ft\":\"甲写的\"}}" > /tmp/wb-a13-1.code &
  p1=$!
  curl -s -o /tmp/wb-a13-2.json -w '%{http_code}' -b "$COOKIE_A2" -H 'Content-Type: application/json' \
    -X PATCH "$API/rows/$rid" -d "{\"version\":$vn,\"data\":{\"$ft\":\"乙写的\"}}" > /tmp/wb-a13-2.code &
  p2=$!
  wait "$p1"; wait "$p2"
  c1=$(cat /tmp/wb-a13-1.code); c2=$(cat /tmp/wb-a13-2.code)
  okc=$(printf '%s\n%s\n' "$c1" "$c2" | grep -c '^200$')
  cfc=$(printf '%s\n%s\n' "$c1" "$c2" | grep -c '^409$')
  [ "$okc" = "1" ] && [ "$cfc" = "1" ] \
    || fail "A13 并发结果不是恰一 200 一 409（$c1 / ${c2}）—— 静默覆盖或双双失败"
  if [ "$c1" = "200" ]; then loser=/tmp/wb-a13-2.json; winv="甲写的"; else loser=/tmp/wb-a13-1.json; winv="乙写的"; fi
  jq -e '.error.code == "ROW_VERSION_CONFLICT"' < "$loser" >/dev/null \
    || fail "A13 409 体的 error.code 不是 ROW_VERSION_CONFLICT"
  got=$(psql_q "SELECT r.data ->> '$ft' FROM zenithjoy.db_rows r WHERE r.id = '$rid'")
  [ "$got" = "$winv" ] || fail "A13 库中值=${got}，不等于先提交者的值 ${winv}（静默覆盖）"
  psql_q "SELECT r.version FROM zenithjoy.db_rows r WHERE r.id = '$rid'" | grep -qx "$((vn + 1))" \
    || fail "A13 version 未恰好 +1"
  ok "恰一 200 一 409、409 码正确、库值 = 先提交者、version 恰 +1"
  section_down
  echo "✅ A13 通过"
}

run_a15() {
  echo "== A15 行数上限：整批原子拒绝，库中零新增行零新建字段 =="
  # 上限必须是小值才验得动（真插 5000 行会把 CI 预算烧光，已在合同「未覆盖真实链路清单」登记）。
  # 外面没给就自己给一个，且必须在 section_up **之前** export —— 服务端每请求读 env，
  # 但进程是 section_up 里起的，起完再改就进不到那个进程了。
  export WORKBENCH_ROW_LIMIT="${WORKBENCH_ROW_LIMIT:-3}"
  section_up
  local tid lim batch r0 f0 r1 f1 code msg
  tid=$(create_table_as "$COOKIE_A" "WB-S2-A15-$SFX" 'org' | jq -r '.data.table_id')
  [ -n "$tid" ] && [ "$tid" != "null" ] || fail "A15 建表失败"
  lim=$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/rows" | jq -r '.data.row_limit')
  [ -n "$lim" ] && [ "$lim" != "null" ] || fail "A15 行列表未下发 row_limit"
  [ "$lim" -le 50 ] 2>/dev/null \
    || fail "A15 row_limit=$lim 太大：本段要求以小值起服务（export WORKBENCH_ROW_LIMIT=3 后再跑），否则只能靠真插几千行"
  [ "$lim" -ge 2 ] 2>/dev/null || fail "A15 row_limit=$lim 太小，凑不出「先合法再超限」两批"

  batch=$(jq -nc --argjson n "$((lim - 1))" '{header:["字段-text"], rows: [range(0; $n) | ["x\(.)"]]}')
  curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X POST "$API/tables/$tid/rows/paste" \
    -d "$batch" >/dev/null || fail "A15 首批 $((lim - 1)) 行粘贴应成功"
  r0=$(psql_q "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.table_id = '$tid'")
  f0=$(psql_q "SELECT count(*) FROM zenithjoy.db_fields f WHERE f.table_id = '$tid'")

  code=$(curl -s -o /tmp/wb-a15.json -w '%{http_code}' -b "$COOKIE_A" -H 'Content-Type: application/json' \
    -X POST "$API/tables/$tid/rows/paste" \
    -d '{"header":["字段-text","超限新列"],"rows":[["y1","z1"],["y2","z2"]]}')
  [ "$code" = "400" ] || fail "A15 超限批次返 ${code}（应 400）"
  jq -e '.error.code == "ROW_LIMIT_EXCEEDED"' < /tmp/wb-a15.json >/dev/null \
    || fail "A15 错误码不是 ROW_LIMIT_EXCEEDED"
  msg=$(jq -r '.error.message' < /tmp/wb-a15.json)
  printf '%s' "$msg" | grep -q "$lim" || fail "A15 提示未含当前上限：$msg"
  printf '%s' "$msg" | grep -q "已有" || fail "A15 提示未含已有行数：$msg"
  r1=$(psql_q "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.table_id = '$tid'")
  f1=$(psql_q "SELECT count(*) FROM zenithjoy.db_fields f WHERE f.table_id = '$tid'")
  [ "$r0" = "$r1" ] || fail "A15 超限批次落了行（$r0 -> ${r1}）—— 不是整批拒绝"
  [ "$f0" = "$f1" ] || fail "A15 超限批次建了字段（$f0 -> ${f1}）—— 表上留下孤儿列"

  # 达上限后连单条建行也必须被拒（UI 硬拦之外的服务端兜底）
  curl -sf -b "$COOKIE_A" -X POST "$API/tables/$tid/rows" >/dev/null || fail "A15 补到上限那一行应能建"
  code=$(curl -s -o /tmp/wb-a15b.json -w '%{http_code}' -b "$COOKIE_A" -X POST "$API/tables/$tid/rows")
  [ "$code" = "400" ] || fail "A15 达上限后单条建行返 ${code}（应 400）"
  jq -e '.error.code == "ROW_LIMIT_EXCEEDED"' < /tmp/wb-a15b.json >/dev/null \
    || fail "A15 单条建行错误码不是 ROW_LIMIT_EXCEEDED"
  ok "上限 ${lim}：超限批次 400 且行数/字段数前后完全相等；达上限单条建行同样被拒"
  section_down
  echo "✅ A15 通过"
}

run_a16() {
  echo "== A16 删行软删：物理行仍在 + 回收站 30 天 + 还原逐字回归 =="
  section_up
  local tid ft rid before after c0 c1 days
  tid=$(create_table_as "$COOKIE_A" "WB-S2-A16-$SFX" 'org' | jq -r '.data.table_id')
  ft=$(field_id_of "$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/fields")" text)
  rid=$(create_row_as "$COOKIE_A" "$tid")
  [ -n "$rid" ] && [ "$rid" != "null" ] || fail "A16 建行失败"
  curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X PATCH "$API/rows/$rid" \
    -d "{\"version\":1,\"data\":{\"$ft\":\"删前的值\"}}" >/dev/null || fail "A16 预置写入失败"
  before=$(psql_q "SELECT r.data::text FROM zenithjoy.db_rows r WHERE r.id = '$rid'")
  c0=$(psql_q "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.table_id = '$tid'")

  curl -sf -b "$COOKIE_A" -X DELETE "$API/rows/$rid" | jq -e '.data.deleted_at != null' >/dev/null \
    || fail "A16 删行非 2xx 或未返 deleted_at"
  c1=$(psql_q "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.table_id = '$tid'")
  [ "$c0" = "$c1" ] || fail "A16 物理行被删了（$c0 -> ${c1}）不是软删"
  curl -sf -b "$COOKIE_A" "$API/tables/$tid/rows" | jq -e '(.data.rows | length) == 0' >/dev/null \
    || fail "A16 软删行仍出现在表格视图"
  # jq 的 fromdate 不吃毫秒（ISO 里的 .123Z），先削掉再算，否则红在解析上而不是业务上
  days=$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/rows/trash" \
    | jq -r "[.data.rows[] | select(.row_id == \"$rid\")][0]
             | ((.restorable_until | sub(\"\\\\.[0-9]+Z$\"; \"Z\") | fromdate)
                - (.deleted_at | sub(\"\\\\.[0-9]+Z$\"; \"Z\") | fromdate)) / 86400 | round")
  [ "$days" = "30" ] || fail "A16 行回收站窗口不是 30 天（got=${days}）"

  curl -sf -b "$COOKIE_A" -X POST "$API/rows/$rid/restore" >/dev/null || fail "A16 还原非 2xx"
  after=$(psql_q "SELECT r.data::text FROM zenithjoy.db_rows r WHERE r.id = '$rid'")
  [ "$before" = "$after" ] || fail "A16 还原后数据不逐字相等（$before -> ${after}）"
  psql_q "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.id = '$rid' AND r.deleted_at IS NULL" | grep -qx 1 \
    || fail "A16 还原后 deleted_at 未清空"
  ok "deleted_at 非空而物理行不减；回收站 30 天；还原后 data 逐字相等"
  section_down
  echo "✅ A16 通过"
}

run_a17() {
  echo "== A17 单表导出：行数/字段数与库相等，导出体零他组织数据 =="
  section_up
  local secret bt bf br tid dbn dbf exp i
  secret="乙企业机密-$SFX"
  bt=$(create_table_as "$COOKIE_B" "WB-S2-A17B-$SFX" 'org' | jq -r '.data.table_id')
  bf=$(field_id_of "$(curl -sf -b "$COOKIE_B" "$API/tables/$bt/fields")" text)
  br=$(create_row_as "$COOKIE_B" "$bt")
  curl -sf -b "$COOKIE_B" -H 'Content-Type: application/json' -X PATCH "$API/rows/$br" \
    -d "{\"version\":1,\"data\":{\"$bf\":\"$secret\"}}" >/dev/null || fail "A17 B 企业预置失败"

  tid=$(create_table_as "$COOKIE_A" "WB-S2-A17-$SFX" 'org' | jq -r '.data.table_id')
  for i in 1 2; do create_row_as "$COOKIE_A" "$tid" >/dev/null || fail "A17 建行失败"; done
  exp=$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/export") || fail "A17 导出端点非 2xx"
  dbn=$(psql_q "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.table_id = '$tid' AND r.deleted_at IS NULL")
  dbf=$(psql_q "SELECT count(*) FROM zenithjoy.db_fields f WHERE f.table_id = '$tid'")
  printf '%s' "$exp" | jq -e --argjson n "$dbn" '(.data.rows | length) == $n' >/dev/null \
    || fail "A17 导出行数与库不等（库 ${dbn}）"
  printf '%s' "$exp" | jq -e --argjson m "$dbf" '(.data.fields | length) == $m' >/dev/null \
    || fail "A17 导出字段数与库不等（库 ${dbf}）"
  printf '%s' "$exp" | jq -e ".data.table_id == \"$tid\" and (.data.exported_at | type) == \"string\"" >/dev/null \
    || fail "A17 导出体缺 table_id/exported_at"
  printf '%s' "$exp" | grep -q "$ORGB_TENANT_ID" && fail "A17 导出体里出现他组织 org_id"
  printf '%s' "$exp" | grep -q "$secret" && fail "A17 导出体里出现他组织单元格值"
  ok "导出行数/字段数与库相等，他组织 org_id 与机密串零命中"
  section_down
  echo "✅ A17 通过"
}

run_a18_a19() {
  echo "== A18/A19 对抗输入一律作为数据值：零 5xx + 表清单前后全等 =="
  section_up
  local t0 t1 tid i p body code n m
  t0=$(psql_q "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'zenithjoy'")
  tid=$(create_table_as "$COOKIE_A" "WB-S2-A18-$SFX" 'org' | jq -r '.data.table_id')
  [ -n "$tid" ] && [ "$tid" != "null" ] || fail "A18 建表失败"
  for i in 1 2 3 4 5; do
    case "$i" in
      1) p='<img src=x onerror=alert(1)>';;
      2) p='__proto__';;
      3) p='constructor';;
      4) p='"; DROP TABLE db_rows; --';;
      5) p='🧨🧨🧨';;
    esac
    body=$(jq -nc --arg p "$p" '{header:[$p],rows:[[$p]]}')
    code=$(curl -s -o /tmp/wb-a18.json -w '%{http_code}' -b "$COOKIE_A" -H 'Content-Type: application/json' \
      -X POST "$API/tables/$tid/rows/paste" -d "$body")
    if [ "$i" = "1" ]; then
      # 上位合同 A19：一律作为数据值收下，不许拿 400 拒掉当合规
      [ "$code" = "201" ] || fail "A19 XSS 串必须原样作为数据值落库，实际返 $code"
    else
      case "$code" in 201|400) :;; *) fail "A18 对抗 payload 触发 ${code}（禁 5xx）：$p";; esac
    fi
  done
  n=$(psql_q "SELECT count(*) FROM zenithjoy.db_fields f WHERE f.table_id = '$tid' AND f.name LIKE '%onerror%'")
  [ "${n:-0}" -ge 1 ] || fail "A19 注入串未作为字段名（数据值）落库"
  m=$(psql_q "SELECT count(*) FROM zenithjoy.db_rows r WHERE r.table_id = '$tid' AND r.data::text LIKE '%onerror%'")
  [ "${m:-0}" -ge 1 ] || fail "A19 注入串未作为单元格值落库"
  t1=$(psql_q "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'zenithjoy'")
  [ "$t0" = "$t1" ] || fail "A18 information_schema 表清单变了 —— 用户输入进了标识符位/产生运行时 DDL"
  ok "五个 payload 零 5xx、注入串真作为字段名与单元格值落库、表清单前后全等"
  section_down
  echo "✅ A18/A19 通过"
}

run_a1_a3_rows() {
  echo "== 行层 A1/A3：跨组织五个操作全 404 同形 + 本组织正向 2xx（同一次运行内成对）=="
  section_up
  local tid ft rid before after rnd code h1 h2
  tid=$(create_table_as "$COOKIE_A" "WB-S2-ISO-$SFX" 'org' | jq -r '.data.table_id')
  ft=$(field_id_of "$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/fields")" text)
  rid=$(create_row_as "$COOKIE_A" "$tid")
  [ -n "$rid" ] && [ "$rid" != "null" ] || fail "行隔离段建行失败"
  curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X PATCH "$API/rows/$rid" \
    -d "{\"version\":1,\"data\":{\"$ft\":\"A 企业的值\"}}" >/dev/null || fail "行隔离段预置写入失败"
  before=$(psql_q "SELECT r.data::text FROM zenithjoy.db_rows r WHERE r.id = '$rid'")
  rnd=$(psql_q "SELECT gen_random_uuid()")

  # 反向五连：丙持真会话（不是没登录），测的是隔离不是鉴权
  code=$(curl -s -o /tmp/wb-iso-list.json -w '%{http_code}' -b "$COOKIE_B" "$API/tables/$tid/rows")
  [ "$code" = "404" ] || fail "跨组织读行列表返 ${code}（应 404）"
  code=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_B" -H 'Content-Type: application/json' \
    -X PATCH "$API/rows/$rid" -d "{\"version\":2,\"data\":{\"$ft\":\"越权写入\"}}")
  [ "$code" = "404" ] || fail "跨组织改行返 ${code}（应 404）"
  code=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_B" -X DELETE "$API/rows/$rid")
  [ "$code" = "404" ] || fail "跨组织删行返 ${code}（应 404）"
  code=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_B" -X POST "$API/rows/$rid/restore")
  [ "$code" = "404" ] || fail "跨组织还原返 ${code}（应 404）"
  code=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_B" "$API/tables/$tid/export")
  [ "$code" = "404" ] || fail "跨组织导出返 ${code}（应 404）"

  curl -s -b "$COOKIE_B" -o /tmp/wb-iso-rnd.json "$API/tables/$rnd/rows" >/dev/null
  h1=$(openssl dgst -md5 < /tmp/wb-iso-list.json | awk '{print $NF}')
  h2=$(openssl dgst -md5 < /tmp/wb-iso-rnd.json | awk '{print $NF}')
  [ "$h1" = "$h2" ] || fail "两个 404 体不同 —— 可靠比对字节分辨他企业有没有这张表（$h1 vs ${h2}）"
  after=$(psql_q "SELECT r.data::text FROM zenithjoy.db_rows r WHERE r.id = '$rid'")
  [ "$before" = "$after" ] || fail "跨组织写入生效了（$before -> ${after}）"
  ok "反向五连全 404 且与随机 uuid 逐字节同形；A 企业该行逐字未变"

  # 正向对照（同一次运行内）：一律拒绝的实现会在这里当场翻车
  curl -sf -b "$COOKIE_A" "$API/tables/$tid/rows" \
    | jq -e "[.data.rows[].row_id] | index(\"$rid\") != null" >/dev/null \
    || fail "正向对照：A 企业读不到自己的行"
  curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X PATCH "$API/rows/$rid" \
    -d "{\"version\":2,\"data\":{\"$ft\":\"自己写的\"}}" >/dev/null \
    || fail "正向对照：A 企业改不动自己的行"
  curl -sf -b "$COOKIE_A" "$API/tables/$tid/export" >/dev/null || fail "正向对照：A 企业导不出自己的表"
  curl -sf -b "$COOKIE_A" -X DELETE "$API/rows/$rid" >/dev/null || fail "正向对照：A 企业删不了自己的行"
  curl -sf -b "$COOKIE_A" -X POST "$API/rows/$rid/restore" >/dev/null || fail "正向对照：A 企业还原不了自己的行"
  ok "正向五连全部 2xx 且拿到自己的数据"
  section_down
  echo "✅ 行层 A1/A3 通过"
}

# ═══════════════════════════════════════════════════════════════════════════
# 段3（Sprint C / S3）视图层业务判定
#
# 六段各自 section_up（变异证明单独调它们）；--a24-pure-only 是纯前端单测，不碰 DB/服务。
# ═══════════════════════════════════════════════════════════════════════════

# $1=cookie $2=表名 → 建视图并返回 view_id（body 直接给 JSON）
create_view_as() { curl -sf -b "$1" -H 'Content-Type: application/json' -X POST "$API/tables/$2/views" -d "$3" | jq -r '.data.view_id'; }

run_a20() {
  echo "== A20 分组字段类型闸（七类 400 + single_select 200）+ 未分组三态纯函数 =="
  section_up
  local tid fld vid before after fid c fs
  tid=$(create_table_as "$COOKIE_A" "WB-C-A20-$SFX" 'org' | jq -r '.data.table_id')
  [ -n "$tid" ] && [ "$tid" != "null" ] || fail "A20 建表失败"
  fld=$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/fields")
  vid=$(create_view_as "$COOKIE_A" "$tid" '{"name":"闸","view_type":"grid","is_active":true}')
  [ -n "$vid" ] && [ "$vid" != "null" ] || fail "A20 建视图失败"
  before=$(psql_q "SELECT prefs::text FROM zenithjoy.db_view_prefs WHERE id = '$vid'")
  for T in text long_text number date multi_select person url; do
    fid=$(field_id_of "$fld" "$T")
    [ -n "$fid" ] && [ "$fid" != "null" ] || fail "A20 $T 字段缺 field_id"
    c=$(curl -s -o /tmp/wb-c-a20.json -w '%{http_code}' -b "$COOKIE_A" -H 'Content-Type: application/json' \
      -X PATCH "$API/views/$vid" -d "{\"view_type\":\"kanban\",\"group_field_id\":\"$fid\"}")
    [ "$c" = "400" ] || fail "A20 $T 做分组返 ${c}（应 400；controller C2：multi_select 也必须 400）"
    jq -e '.error.code == "GROUP_FIELD_TYPE_INVALID"' < /tmp/wb-c-a20.json >/dev/null || fail "A20 $T 错误码不是 GROUP_FIELD_TYPE_INVALID"
  done
  after=$(psql_q "SELECT prefs::text FROM zenithjoy.db_view_prefs WHERE id = '$vid'")
  [ "$before" = "$after" ] || fail "A20 400 却改了库（留半截状态）"
  fs=$(field_id_of "$fld" single_select)
  curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X PATCH "$API/views/$vid" \
    -d "{\"view_type\":\"kanban\",\"group_field_id\":\"$fs\"}" \
    | jq -e --arg fs "$fs" '.data.group_field_id == $fs' >/dev/null || fail "A20 single_select 正向未 200（一律 400 假绿）"
  ok "七类 400 + prefs 逐字未变 + single_select 正向 200"

  # 未分组三态纯函数（A20-ungrouped-null-only 应让它红）
  export E2E_DATABASE_URL="$PGURL"
  ( cd apps/api && npx vitest run --config vitest.workbench-views.config.ts -t "未分组三态" --reporter=dot ) \
    >/tmp/wb-c-a20-vitest.log 2>&1 || { tail -20 /tmp/wb-c-a20-vitest.log; fail "groupRowsByField 未分组三态用例未通过"; }
  ok "groupRowsByField 未分组三态纯函数用例通过"
  section_down
  echo "✅ A20 通过"
}

run_a21() {
  echo "== A21 视图配置持久化只存 field_id + 改显示名不失效 =="
  section_up
  local tid fld fs fn ft vid p v1 v2
  tid=$(create_table_as "$COOKIE_A" "WB-C-A21-$SFX" 'org' | jq -r '.data.table_id')
  fld=$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/fields")
  fs=$(field_id_of "$fld" single_select); fn=$(field_id_of "$fld" number); ft=$(field_id_of "$fld" text)
  vid=$(create_view_as "$COOKIE_A" "$tid" "{\"name\":\"我的视图\",\"view_type\":\"kanban\",\"group_field_id\":\"$fs\",\"sorts\":[{\"field_id\":\"$fn\",\"dir\":\"desc\"}],\"filters\":[{\"field_id\":\"$ft\",\"op\":\"contains\",\"value\":\"甲\"}],\"hidden_field_ids\":[\"$fn\"],\"is_active\":true}")
  [ -n "$vid" ] && [ "$vid" != "null" ] || fail "A21 建视图失败"
  p=$(psql_q "SELECT prefs::text FROM zenithjoy.db_view_prefs WHERE id = '$vid'")
  printf '%s' "$p" | grep -q "$fs" || fail "A21 prefs 里没有 field_id"
  printf '%s' "$p" | grep -q '字段-single_select' && fail "A21 prefs 里存了字段显示名（改名即失效）"
  v1=$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/views" | jq -S '.data.views')
  psql "$PGURL" -q -c "UPDATE zenithjoy.db_fields SET name = '改过名的单选' WHERE id = '$fs'" >/dev/null || fail "A21 改显示名失败"
  v2=$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/views" | jq -S '.data.views')
  [ "$v1" = "$v2" ] || fail "A21 改显示名后视图不逐项一致"
  printf '%s' "$v2" | jq -e --arg fs "$fs" '.[0].group_field_id == $fs and .[0].degraded == false and .[0].view_type == "kanban"' >/dev/null \
    || fail "A21 视图逐项未复原"
  ok "prefs 存 field_id 零显示名；改名后 group_field_id 不变、degraded false"
  section_down
  echo "✅ A21 通过"
}

run_a22() {
  echo "== A22 反查两分支：已删字段降级 degraded=true + 他企业 field_id 404 同形 =="
  section_up
  local tid fld fs fn vid bt bfid rnd c1 c2 g
  tid=$(create_table_as "$COOKIE_A" "WB-C-A22-$SFX" 'org' | jq -r '.data.table_id')
  fld=$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/fields")
  fs=$(field_id_of "$fld" single_select); fn=$(field_id_of "$fld" number)
  vid=$(create_view_as "$COOKIE_A" "$tid" "{\"name\":\"降级验\",\"view_type\":\"kanban\",\"group_field_id\":\"$fs\",\"sorts\":[{\"field_id\":\"$fs\",\"dir\":\"asc\"}],\"hidden_field_ids\":[\"$fs\",\"$fn\"],\"is_active\":true}")
  [ -n "$vid" ] && [ "$vid" != "null" ] || fail "A22 建视图失败"
  # 分支②先做（fs 还在）：他企业真实 field_id / 随机 uuid → 404 同形
  bt=$(create_table_as "$COOKIE_B" "WB-C-A22B-$SFX" 'org' | jq -r '.data.table_id')
  bfid=$(field_id_of "$(curl -sf -b "$COOKIE_B" "$API/tables/$bt/fields")" single_select)
  rnd=$(psql_q "SELECT gen_random_uuid()")
  c1=$(curl -s -b "$COOKIE_A" -o /tmp/wb-c-a22b.json -w '%{http_code}' -H 'Content-Type: application/json' -X PATCH "$API/views/$vid" -d "{\"group_field_id\":\"$bfid\"}")
  c2=$(curl -s -b "$COOKIE_A" -o /tmp/wb-c-a22r.json -w '%{http_code}' -H 'Content-Type: application/json' -X PATCH "$API/views/$vid" -d "{\"group_field_id\":\"$rnd\"}")
  [ "$c1" = "404" ] || fail "A22 他企业 field_id 写入返 ${c1}（应 404）"
  [ "$c2" = "404" ] || fail "A22 随机 uuid field_id 返 ${c2}（应 404）"
  [ "$(openssl dgst -md5 < /tmp/wb-c-a22b.json | awk '{print $NF}')" = "$(openssl dgst -md5 < /tmp/wb-c-a22r.json | awk '{print $NF}')" ] \
    || fail "A22 两个 404 体不同 —— 可比对字节分辨他企业 field 是否真实存在"
  # 分支①：删字段 → GET 200 降级
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.db_fields WHERE id = '$fs'" >/dev/null || fail "A22 删字段失败"
  g=$(curl -s -b "$COOKIE_A" -o /tmp/wb-c-a22g.json -w '%{http_code}' "$API/tables/$tid/views")
  [ "$g" = "200" ] || fail "A22 已删字段的视图反查返 ${g}（应 200 降级，非 5xx）"
  jq -e --arg v "$vid" --arg fs "$fs" --arg fn "$fn" \
    '.data.views[] | select(.view_id == $v) | .group_field_id == null and .degraded == true and ([.sorts[].field_id] | index($fs) | not) and ([.hidden_field_ids[]] | index($fs) | not) and ([.hidden_field_ids[]] | index($fn))' \
    < /tmp/wb-c-a22g.json >/dev/null || fail "A22 降级不彻底（失效 id 未剔除 / degraded 未置 true / 未失效被误删）"
  ok "degraded=true + 失效 id 剔除 + 未失效留存；他企业 field_id 404 同形"
  section_down
  echo "✅ A22 通过"
}

run_a25() {
  echo "== A25 field_id 白名单：SQL 片段/坏 dir/坏 op → 400，跨表 UUID → 404，表清单不变 =="
  section_up
  local tid ft t0 r0 t1 sp fp c rnd BAD BADD
  tid=$(create_table_as "$COOKIE_A" "WB-C-A25-$SFX" 'org' | jq -r '.data.table_id')
  ft=$(field_id_of "$(curl -sf -b "$COOKIE_A" "$API/tables/$tid/fields")" text)
  [ -n "$ft" ] && [ "$ft" != "null" ] || fail "A25 取 text field_id 失败"
  curl -sf -b "$COOKIE_A" -X POST "$API/tables/$tid/rows" >/dev/null || fail "A25 建行失败"
  t0=$(psql_q "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'zenithjoy'")
  r0=$(psql_q "SELECT count(*) FROM zenithjoy.db_rows")
  for BAD in "id; DROP TABLE zenithjoy.db_rows; --" "1) OR 1=1 --" "data->>'x'"; do
    sp=$(jq -nc --arg f "$BAD" '[{field_id:$f,dir:"asc"}]')
    c=$(curl -s -o /tmp/wb-c-a25.json -w '%{http_code}' -b "$COOKIE_A" --get "$API/tables/$tid/rows" --data-urlencode "sort=$sp")
    [ "$c" = "400" ] || fail "A25 sort.field_id SQL 片段返 ${c}（应 400）payload=$BAD"
    jq -e '.error.code == "VALIDATION_FAILED"' < /tmp/wb-c-a25.json >/dev/null || fail "A25 sort 片段错误码不是 VALIDATION_FAILED"
    fp=$(jq -nc --arg f "$BAD" '[{field_id:$f,op:"contains",value:"x"}]')
    c=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" --get "$API/tables/$tid/rows" --data-urlencode "filter=$fp")
    [ "$c" = "400" ] || fail "A25 filter.field_id SQL 片段返 ${c}（应 400）payload=$BAD"
  done
  for BADD in "asc; DROP TABLE zenithjoy.db_rows; --" "asc NULLS FIRST, 1" "ASC--"; do
    sp=$(jq -nc --arg f "$ft" --arg d "$BADD" '[{field_id:$f,dir:$d}]')
    c=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" --get "$API/tables/$tid/rows" --data-urlencode "sort=$sp")
    [ "$c" = "400" ] || fail "A25 dir 位 $BADD 返 ${c}（应 400 —— dir 直接落 ORDER BY 关键字位）"
  done
  c=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" --get "$API/tables/$tid/rows" \
    --data-urlencode "filter=$(jq -nc --arg f "$ft" '[{field_id:$f,op:"nosuchop",value:"x"}]')")
  [ "$c" = "400" ] || fail "A25 非白名单 op 返 ${c}（应 400）"
  rnd=$(psql_q "SELECT gen_random_uuid()")
  c=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_A" --get "$API/tables/$tid/rows" \
    --data-urlencode "sort=$(jq -nc --arg f "$rnd" '[{field_id:$f,dir:"asc"}]')")
  [ "$c" = "404" ] || fail "A25 跨表合法 UUID 返 ${c}（应 404）"
  t1=$(psql_q "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'zenithjoy'")
  [ "$t0" = "$t1" ] || fail "A25 information_schema 表清单变了 —— 用户输入进了标识符位"
  [ "$r0" -le "$(psql_q "SELECT count(*) FROM zenithjoy.db_rows")" ] || fail "A25 db_rows 行数减少了"
  ok "SQL 片段/坏 dir/坏 op 全 400，跨表 UUID 404，零 5xx，表清单前后全等"
  section_down
  echo "✅ A25 通过"
}

run_a1_a3_views() {
  echo "== 视图层 A1/A3：他企业(org维) + 同组织他人(member维) 各 404 同形 + 本人 2xx =="
  section_up
  local tid vid before after rnd c bt twinvid v2
  tid=$(create_table_as "$COOKIE_A" "WB-C-VISO-$SFX" 'org' | jq -r '.data.table_id')
  vid=$(create_view_as "$COOKIE_A" "$tid" '{"name":"我的视图","view_type":"grid","is_active":true}')
  [ -n "$vid" ] && [ "$vid" != "null" ] || fail "视图隔离段建视图失败"
  before=$(psql_q "SELECT prefs::text FROM zenithjoy.db_view_prefs WHERE id = '$vid'")
  rnd=$(psql_q "SELECT gen_random_uuid()")

  # ── org 维（丙 = 他企业）：表不可达 → GET views 404；PATCH/DELETE view 404，且与随机 uuid 同形
  c=$(curl -s -b "$COOKIE_B" -o /tmp/wb-viso-clist.json -w '%{http_code}' "$API/tables/$tid/views")
  [ "$c" = "404" ] || fail "他企业 GET table views 返 ${c}（应 404）"
  c=$(curl -s -b "$COOKIE_B" -o /tmp/wb-viso-cp.json -w '%{http_code}' -H 'Content-Type: application/json' -X PATCH "$API/views/$vid" -d '{"name":"越权"}')
  [ "$c" = "404" ] || fail "他企业 PATCH view 返 ${c}（应 404）"
  c=$(curl -s -b "$COOKIE_B" -o /dev/null -w '%{http_code}' -X DELETE "$API/views/$vid")
  [ "$c" = "404" ] || fail "他企业 DELETE view 返 ${c}（应 404）"
  curl -s -b "$COOKIE_B" -o /tmp/wb-viso-crnd.json -X PATCH "$API/views/$rnd" -H 'Content-Type: application/json' -d '{"name":"x"}' >/dev/null
  [ "$(openssl dgst -md5 < /tmp/wb-viso-cp.json | awk '{print $NF}')" = "$(openssl dgst -md5 < /tmp/wb-viso-crnd.json | awk '{print $NF}')" ] \
    || fail "他企业 404 体与随机 uuid 不同形"

  # ── org 维隔离探针：INSERT 一个 org=orgB / member=甲 的孪生视图行 —— 甲(orgA)必须够不到它
  bt=$(create_table_as "$COOKIE_B" "WB-C-VISO-B-$SFX" 'org' | jq -r '.data.table_id')
  twinvid=$(psql_q "INSERT INTO zenithjoy.db_view_prefs (table_id, org_id, member_id, prefs) VALUES ('$bt','$ORGB_TENANT_ID','$ALICE_OPENID','{\"name\":\"孪生\",\"view_type\":\"grid\",\"is_active\":false}'::jsonb) RETURNING id")
  [ -n "$twinvid" ] || fail "org 探针孪生行未建成"
  c=$(curl -s -b "$COOKIE_A" -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X PATCH "$API/views/$twinvid" -d '{"name":"跨企业越权"}')
  [ "$c" = "404" ] || fail "org 维探针：甲(orgA)够到了 orgB 的视图返 ${c}（应 404）—— org 维隔离是空的"

  # ── member 维（乙 = 同组织他人）：GET views 200 但零命中甲的视图；PATCH/DELETE view 404 同形
  c=$(curl -s -b "$COOKIE_A2" -o /tmp/wb-viso-blist.json -w '%{http_code}' "$API/tables/$tid/views")
  [ "$c" = "200" ] || fail "乙对本表有权访问，视图列表应 200 而不是 $c"
  jq -e --arg v "$vid" '[.data.views[] | select(.view_id == $v)] | length == 0' < /tmp/wb-viso-blist.json >/dev/null \
    || fail "member 维：甲的视图出现在乙的列表里 —— member 维隔离没立起来"
  c=$(curl -s -b "$COOKIE_A2" -o /tmp/wb-viso-bp.json -w '%{http_code}' -H 'Content-Type: application/json' -X PATCH "$API/views/$vid" -d '{"name":"同事越权"}')
  [ "$c" = "404" ] || fail "member 维：同组织他人 PATCH view 返 ${c}（应 404）"
  c=$(curl -s -b "$COOKIE_A2" -o /dev/null -w '%{http_code}' -X DELETE "$API/views/$vid")
  [ "$c" = "404" ] || fail "member 维：同组织他人 DELETE view 返 ${c}（应 404）"
  curl -s -b "$COOKIE_A2" -o /tmp/wb-viso-brnd.json -X PATCH "$API/views/$rnd" -H 'Content-Type: application/json' -d '{"name":"x"}' >/dev/null
  [ "$(openssl dgst -md5 < /tmp/wb-viso-bp.json | awk '{print $NF}')" = "$(openssl dgst -md5 < /tmp/wb-viso-brnd.json | awk '{print $NF}')" ] \
    || fail "member 维 404 体与随机 uuid 不同形"

  after=$(psql_q "SELECT prefs::text FROM zenithjoy.db_view_prefs WHERE id = '$vid'")
  [ "$before" = "$after" ] || fail "越权请求改动了甲的 prefs"

  # ── 正向对照（甲本人四端点 2xx）
  curl -sf -b "$COOKIE_A" "$API/tables/$tid/views" | jq -e --arg v "$vid" '[.data.views[] | select(.view_id == $v)] | length == 1' >/dev/null \
    || fail "正向：甲读不到自己的视图"
  curl -sf -b "$COOKIE_A" -H 'Content-Type: application/json' -X PATCH "$API/views/$vid" -d '{"name":"甲改名"}' >/dev/null \
    || fail "正向：甲改不动自己的视图"
  v2=$(create_view_as "$COOKIE_A" "$tid" '{"name":"第二视图"}')
  curl -sf -b "$COOKIE_A" -X DELETE "$API/views/$v2" >/dev/null || fail "正向：甲删不了自己的视图"
  ok "org 维 + member 维各 404 同形、正向 2xx；孪生行探针钉住 org 维、乙列表零命中钉住 member 维"
  section_down
  echo "✅ 视图层 A1/A3 通过"
}

run_view_delete() {
  echo "== 删视图：只删偏好三表 md5 不变 + 至少保留一个 =="
  section_up
  local tid v1 v2 snap0 snap1 c SNAP
  tid=$(create_table_as "$COOKIE_A" "WB-C-VDEL-$SFX" 'org' | jq -r '.data.table_id')
  curl -sf -b "$COOKIE_A" -X POST "$API/tables/$tid/rows" >/dev/null || fail "删视图段建行失败"
  SNAP="SELECT md5(string_agg(x, '|')) FROM (SELECT t.id::text || t.name AS x FROM zenithjoy.db_tables t WHERE t.org_id = '$ORGA_TENANT_ID' UNION ALL SELECT f.id::text || f.name FROM zenithjoy.db_fields f WHERE f.org_id = '$ORGA_TENANT_ID' UNION ALL SELECT r.id::text || r.data::text FROM zenithjoy.db_rows r WHERE r.org_id = '$ORGA_TENANT_ID' ORDER BY 1) s(x)"
  v1=$(create_view_as "$COOKIE_A" "$tid" '{"name":"视图一","view_type":"grid","is_active":true}')
  v2=$(create_view_as "$COOKIE_A" "$tid" '{"name":"视图二","view_type":"grid"}')
  [ -n "$v1" ] && [ -n "$v2" ] && [ "$v1" != "null" ] && [ "$v2" != "null" ] || fail "删视图段建视图失败"
  snap0=$(psql_q "$SNAP")
  curl -sf -b "$COOKIE_A" -X DELETE "$API/views/$v2" \
    | jq -e '(.data | keys) == ["deleted_view_id","remaining"] and .data.remaining == 1' >/dev/null || fail "删视图响应形状不符"
  snap1=$(psql_q "$SNAP")
  [ "$snap0" = "$snap1" ] || fail "删视图动了 db_tables / db_fields / db_rows"
  psql_q "SELECT count(*) FROM zenithjoy.db_view_prefs WHERE id = '$v2'" | grep -qx 0 || fail "偏好行未真删"
  c=$(curl -s -o /tmp/wb-c-vdel.json -w '%{http_code}' -b "$COOKIE_A" -X DELETE "$API/views/$v1")
  [ "$c" = "400" ] || fail "删最后一个视图返 ${c}（应 400）"
  jq -e '.error.code == "LAST_VIEW_PROTECTED"' < /tmp/wb-c-vdel.json >/dev/null || fail "错误码不是 LAST_VIEW_PROTECTED"
  psql_q "SELECT count(*) FROM zenithjoy.db_view_prefs WHERE id = '$v1'" | grep -qx 1 || fail "被拒的删除却把行删了"
  ok "删一个 200 三表 md5 前后全等；删最后一个 400 LAST_VIEW_PROTECTED 且行仍在"
  section_down
  echo "✅ 删视图段通过"
}

run_a24_pure() {
  echo "== A24 拖卡纯函数：resolveDropPatch 映射被拖那一行（staff-hub 单测，不碰 DB/服务）=="
  ( cd apps/staff-hub && npx vitest run src/lib/workbenchKanban.test.ts --reporter=dot ) \
    >/tmp/wb-c-a24.log 2>&1 || { tail -20 /tmp/wb-c-a24.log; fail "拖卡纯函数单测未过（A24-drag-wrong-row 应让它红）"; }
  echo "✅ A24 拖卡纯函数通过"
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
  --a24-pure-only)   run_a24_pure; exit 0;;
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
  --a12-only)               run_a12; exit 0;;
  --a13-only)               run_a13; exit 0;;
  --a15-only)               run_a15; exit 0;;
  --a16-only)               run_a16; exit 0;;
  --a17-only)               run_a17; exit 0;;
  --a18-a19-only)           run_a18_a19; exit 0;;
  --a1-a3-rows-only)        run_a1_a3_rows; exit 0;;
  --a20-only)               run_a20; exit 0;;
  --a21-only)               run_a21; exit 0;;
  --a22-only)               run_a22; exit 0;;
  --a25-only)               run_a25; exit 0;;
  --a1-a3-views-only)       run_a1_a3_views; exit 0;;
  --view-delete-only)       run_view_delete; exit 0;;
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
# Sprint B 的七个行层段（--a12/--a13/--a15/--a16/--a17/--a18-a19/--a1-a3-rows）同样不进无参数全跑：
#   * --a15-only 必须以小 WORKBENCH_ROW_LIMIT **起服务**才验得动上限闸，而全跑是一次共享 fixture，
#     把共享进程的上限压到 3 会让前面几段建行建到一半就撞上限，红在环境上而不是业务上；
#   * 其余六段是同一条 S2 链路上的段，与 --a15 放在一起才构成完整证明，拆一半进全跑没有意义。
# 它们由 e2e-knowledge-hub-path3.yml 的 linux job 逐个真跑（ARTIFACT「workflow 逐字接线」钉住），
# 变异证明也各自显式调用它们（判据见 contract-dod.md）。
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
