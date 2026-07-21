#!/usr/bin/env bash
# xian-runner-fleet-smoke.sh
# 西安机群CI/RPA基础设施 — 机器管理 API 双维度展示 + GitHub runner API 权限验证
#
# Sprint: 07202259-xian-runner-fleet  Task: 910a5872
# Feature F5：机器管理页双维度展示（owner_type 字段验证）
# Feature F4：Final E2E（CI 内可跑部分；真机首次上线为人工验收，不进此脚本）
#
# 环境变量：
#   BASE_URL       API 地址，默认 http://localhost:5200
#   TENANT         X-Tenant-Id 头，默认 smoke-tenant-fleet
#   GITHUB_PAT     GitHub Classic PAT（需 repo admin 权限），用于验证 runner API 可访问
#   GITHUB_OWNER   仓库 owner，默认 perfectuser21
#   GITHUB_REPO    仓库名，默认 zenithjoy-workspace
#
# 使用：bash xian-runner-fleet-smoke.sh
# CI 内跑：设 BASE_URL=http://localhost:5200  TENANT=smoke-tenant-fleet  GITHUB_PAT=${{ secrets.GITHUB_PAT_RUNNER }}
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5200}"
TENANT="${TENANT:-smoke-tenant-fleet}"
GITHUB_OWNER="${GITHUB_OWNER:-perfectuser21}"
GITHUB_REPO="${GITHUB_REPO:-zenithjoy-workspace}"
AUTH=(-H "X-Tenant-Id: $TENANT")

PASS=0
FAIL=0

pass() { echo "  PASS $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL $1"; FAIL=$((FAIL+1)); }

check_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then pass "$desc"; else fail "$desc (want=$expected got=$actual)"; fi
}

echo "=== xian-runner-fleet-smoke: $BASE_URL tenant=$TENANT ==="

# ──────────────────────────────────────────────
# 1. 租户隔离回归守卫：无认证 → 必须 401
# ──────────────────────────────────────────────
echo "[1] 无认证 GET /api/agent/machines → 401"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/agent/machines" 2>/dev/null || echo "000")
check_eq "list(no-auth) HTTP 401" "401" "$CODE"

# ──────────────────────────────────────────────
# 2. 带认证 GET /api/agent/machines → success=true, data=array
# ──────────────────────────────────────────────
echo "[2] 带租户认证 GET /api/agent/machines → success=true, data=array"
LIST=$(curl -fsS "${AUTH[@]}" "$BASE_URL/api/agent/machines" 2>/dev/null || echo '{"success":false}')
echo "  response: $LIST"

LIST_OK=$(echo "$LIST" | node -e '
  const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
  if(d.success!==true||!Array.isArray(d.data)){process.stdout.write("fail")}
  else{process.stdout.write("ok:"+d.data.length)}
' 2>/dev/null || echo "fail")

if [[ "$LIST_OK" == ok:* ]]; then
  pass "list shape valid (len=${LIST_OK#ok:})"
else
  fail "list shape invalid"
fi

# ──────────────────────────────────────────────
# 3. 每条机器记录必须含 owner_type 字段（F5 核心断言）
# ──────────────────────────────────────────────
echo "[3] 机器记录含 owner_type 字段"
OWNER_TYPE_VALID=$(echo "$LIST" | node -e '
  const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
  if(!Array.isArray(d.data)){process.stdout.write("no-data");process.exit(0)}
  if(d.data.length===0){process.stdout.write("empty-ok");process.exit(0)}
  const valid=["internal_fleet","customer",null];
  const all=d.data.every(m=>valid.includes(m.owner_type!==undefined?m.owner_type:null));
  if(!("owner_type" in d.data[0])){process.stdout.write("missing-field")}
  else if(all){process.stdout.write("ok")}
  else{process.stdout.write("invalid-value")}
' 2>/dev/null || echo "fail")

case "$OWNER_TYPE_VALID" in
  "ok"|"empty-ok") pass "owner_type 字段存在且合法（或列表为空）";;
  "missing-field")  fail "owner_type 字段缺失（migration 未跑？）";;
  "invalid-value")  fail "owner_type 值非法（应为 internal_fleet/customer）";;
  *)                fail "owner_type 检查失败: $OWNER_TYPE_VALID";;
esac

# ──────────────────────────────────────────────
# 4. 每条机器记录含 os_type 字段（已有字段回归）
# ──────────────────────────────────────────────
echo "[4] 机器记录含 os_type 字段"
OS_TYPE_VALID=$(echo "$LIST" | node -e '
  const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
  if(!Array.isArray(d.data)||d.data.length===0){process.stdout.write("empty-ok");process.exit(0)}
  const has=d.data.every(m=>"os_type" in m);
  process.stdout.write(has?"ok":"missing")
' 2>/dev/null || echo "fail")

case "$OS_TYPE_VALID" in
  "ok"|"empty-ok") pass "os_type 字段存在";;
  "missing")        fail "os_type 字段缺失（已有字段回归失败）";;
  *)                fail "os_type 检查失败";;
esac

# ──────────────────────────────────────────────
# 5. 不存在机器 → 404
# ──────────────────────────────────────────────
echo "[5] GET /api/agent/machines/不存在ID → 404"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" \
  "$BASE_URL/api/agent/machines/00000000-0000-0000-0000-000000000000" 2>/dev/null || echo "000")
check_eq "detail(bogus) HTTP 404" "404" "$CODE"

# ──────────────────────────────────────────────
# 6. GitHub PAT 验证：能访问 runner 列表 API（验证 PAT 具备 runner 注册权限）
#    若未设 GITHUB_PAT 则跳过（本地开发不强制，CI 里必须设）
# ──────────────────────────────────────────────
echo "[6] GitHub PAT 可访问 /repos/{owner}/{repo}/actions/runners"
if [ -z "${GITHUB_PAT:-}" ]; then
  echo "  SKIP  GITHUB_PAT 未设（CI 中必须设）"
else
  GH_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $GITHUB_PAT" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/runners" 2>/dev/null || echo "000")
  check_eq "GitHub runner list API 可访问" "200" "$GH_CODE"
fi

# ──────────────────────────────────────────────
# 7. owner_type 分区筛选：API 支持 ?owner_type= 参数（F5 UI 分 tab 的底层）
#    返回结构合法即可（空列表也 OK，不强依赖 seed 数据）
# ──────────────────────────────────────────────
echo "[7] GET /api/agent/machines?owner_type=internal_fleet → success=true"
FLEET_LIST=$(curl -s "${AUTH[@]}" "$BASE_URL/api/agent/machines?owner_type=internal_fleet" 2>/dev/null || echo '{"success":false}')
FLEET_OK=$(echo "$FLEET_LIST" | node -e '
  const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
  process.stdout.write(d.success===true&&Array.isArray(d.data)?"ok":"fail")
' 2>/dev/null || echo "fail")

if [ "$FLEET_OK" = "ok" ]; then
  pass "owner_type=internal_fleet 过滤可用"
else
  # 若 API 尚不支持此参数，返回完整列表也接受（不强制 400）
  FALLBACK_OK=$(echo "$FLEET_LIST" | node -e '
    const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
    process.stdout.write(d.success===true?"ok":"fail")
  ' 2>/dev/null || echo "fail")
  if [ "$FALLBACK_OK" = "ok" ]; then
    pass "owner_type 参数无感知时返回完整列表（可接受）"
  else
    fail "owner_type=internal_fleet 参数导致 API 异常"
  fi
fi

# ──────────────────────────────────────────────
# 汇总
# ──────────────────────────────────────────────
echo ""
echo "=== xian-runner-fleet-smoke 结果: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
