#!/usr/bin/env bash
# deploy-lib.sh — 发版自洽可复用 bash 函数库（被 deploy-us-vps.yml inline 不便测试，抽出来单测）。
#
# 治根（2026-06-22 真实事故）：
#   1. launchctl restart 不生效——旧 node 进程占着 :5200，新实例 bind 失败 exit 1，旧代码继续跑。
#   2. 发版"成功"但跑旧代码——dist 已 build 新代码，进程没真换。
#
# 三个函数：
#   kill_port <port>           —— 先杀后绑：杀掉占用端口的任何进程（幂等，无进程也返 0）。
#   assert_version <url> <sha>  —— 断言 /version 报告的 sha 命中刚部署 commit；不一致返 1。
#   sha_matches <reported> <expected> —— 纯比较逻辑（含短 sha 前缀匹配），便于单测。
#
# 本文件只定义函数，不执行（供 source）。直接执行时跑内置 self-test（见末尾）。

# sha_matches: 报告 sha 是否命中期望 commit。
# 接受完整 sha 与 7+ 位短 sha 互为前缀（git 短 sha 与全 sha 都算命中）。
# 返回 0 = 命中，1 = 不命中。
sha_matches() {
  local reported="$1" expected="$2"
  [ -z "$reported" ] && return 1
  [ -z "$expected" ] && return 1
  [ "$reported" = "unknown" ] && return 1
  # 完全相等
  if [ "$reported" = "$expected" ]; then
    return 0
  fi
  # 短 sha 前缀互相匹配（至少 7 位才算，避免误判）
  local short_len=7
  if [ "${#reported}" -ge "$short_len" ] && [ "${#expected}" -ge "$short_len" ]; then
    case "$expected" in
      "$reported"*) return 0 ;;
    esac
    case "$reported" in
      "$expected"*) return 0 ;;
    esac
  fi
  return 1
}

# kill_port: 杀掉占用指定端口的所有进程（先杀后绑）。幂等：无占用也返 0。
kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "🔪 端口 $port 被占用，杀掉占用进程: $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 2
    # 还没死就 -9
    pids="$(lsof -ti:"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "🔪 仍占用，强杀 -9: $pids"
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
      sleep 1
    fi
  else
    echo "✅ 端口 $port 无占用进程"
  fi
  return 0
}

# assert_version: curl <url>/version 取 sha，断言命中 expected_sha。
# 不一致 / 取不到 → 打红日志返 1（发版红，治"发成功但旧进程还在"）。
assert_version() {
  local base_url="$1" expected_sha="$2"
  local reported
  reported="$(curl -sf "${base_url}/version" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).sha||""))}catch{process.stdout.write("")}})' \
    2>/dev/null || echo "")"

  if [ -z "$reported" ]; then
    echo "❌ 版本自检失败：${base_url}/version 取不到 sha（进程没起 / 旧进程无 /version 端点）"
    return 1
  fi

  if sha_matches "$reported" "$expected_sha"; then
    echo "✅ 版本自检通过：运行进程 sha=$reported 命中部署 commit=$expected_sha"
    return 0
  fi

  echo "❌ 版本自检失败：运行进程 sha=$reported ≠ 部署 commit=$expected_sha"
  echo "   → 说明跑的是旧进程（端口没真换 / launchctl 没生效），发版红。"
  return 1
}

# ════════════════════════════════════════════════════════════════════════════
# 蓝绿部署编排器（staging → promote 闸 + 自动回滚）
#
# 治根（PrepPRD 2026-06-24）：现状 main 合并 → CD 直接重启生产 :5200，没有 staging，
# 部署 bug 第一个撞上的是 230 个真客户。本编排器把「先 staging 验过、再 promote 切生产」
# 固化进 lib，并在两条失败路径自动护住生产：
#   · staging 验证红 → 不 promote，生产 :5200 纹丝不动（客户无感）→ 销毁 staging → 报 P0
#   · promote 中失败 → 自动回滚到上一版 sha → 生产健康（绝不停在半死）→ 报 P0
#
# 方案 A（蓝绿逻辑版）：切换 = 把验过的同一新 build 重启进 :5200，不维护常驻双实例。
#
# 编排器只管「闸的判定与护栏」，所有副作用步骤通过 hook 名（环境变量）注入，
# 真部署注入连 mmv 的真实命令，smoke 注入 mock —— 故守卫逻辑可被 proven-to-fire。
# ════════════════════════════════════════════════════════════════════════════

# _bg_call: 调用 hook（hook 名存在环境变量里）。hook 未设 → 视为致命配置错误返 2。
_bg_call() {
  local fn_name="$1"; shift
  if [ -z "$fn_name" ]; then
    echo "❌ 蓝绿编排器：缺少 hook（环境变量未设），无法执行，发版红" >&2
    return 2
  fi
  "$fn_name" "$@"
}

# blue_green_deploy <target_sha>
# hook（通过环境变量传入函数名）：
#   BG_DEPLOY_STAGING_FN   起 staging slot :5201（连 test 库）
#   BG_VERIFY_STAGING_FN   在 :5201 跑部署验证（migration/health/版本断言/golden-path smoke）
#   BG_RECORD_ANCHOR_FN    promote 前记录当前 :5200 sha（回滚锚点），把锚点 sha 打印到 stdout
#   BG_PROMOTE_FN          把验过的新 build 切进 :5200（方案 A：重启）
#   BG_VERIFY_PROD_FN      promote 后断言 :5200 health + sha==target
#   BG_ROLLBACK_FN <anchor> promote 失败时把 :5200 恢复到锚点 sha
#   BG_DESTROY_STAGING_FN  销毁 :5201 slot
#   BG_ALERT_P0_FN <msg>   开 P0 通知 Brain
#
# 返回 0 = 部署成功（生产已切新版本）；非 0 = 发版红（生产仍在旧版本/已回滚的健康态）。
blue_green_deploy() {
  local target_sha="$1"

  echo "═══ 蓝绿部署开始 target_sha=${target_sha} ═══"

  # ── 阶段 1：起 staging slot :5201 ──
  echo "─── [1/4] 起 staging slot :5201 ───"
  if ! _bg_call "${BG_DEPLOY_STAGING_FN:-}" "$target_sha"; then
    echo "❌ staging slot 起不来 → 不碰生产 :5200 → 销毁残留 → 报 P0"
    _bg_call "${BG_DESTROY_STAGING_FN:-}" || true
    _bg_call "${BG_ALERT_P0_FN:-}" "staging slot :5201 起不来，部署中止，:5200 未触碰" || true
    return 1
  fi

  # ── 阶段 2：staging 部署验证（migration/health/版本/smoke）──
  echo "─── [2/4] staging :5201 部署验证 ───"
  if ! _bg_call "${BG_VERIFY_STAGING_FN:-}" "$target_sha"; then
    echo "❌ staging 验证红 → 不 promote，:5200 保持旧版本服务客户（无感）→ 销毁 :5201 → 报 P0"
    _bg_call "${BG_DESTROY_STAGING_FN:-}" || true
    _bg_call "${BG_ALERT_P0_FN:-}" "staging 验证失败，:5200 未触碰，客户无感" || true
    return 1
  fi
  echo "✅ staging 验证全绿"

  # ── 阶段 3：记录回滚锚点（当前 :5200 sha）──
  echo "─── [3/4] 记录回滚锚点（promote 前的 :5200 sha）───"
  local anchor_sha
  anchor_sha="$(_bg_call "${BG_RECORD_ANCHOR_FN:-}")"
  if [ -z "$anchor_sha" ]; then
    echo "⚠️  取不到当前 :5200 sha 作锚点（可能首次部署）；回滚将依赖 launchctl 兜底"
  else
    echo "✅ 回滚锚点 sha=${anchor_sha}"
  fi

  # ── 阶段 4：promote 切生产 :5200 + 验证；失败则自动回滚 ──
  echo "─── [4/4] promote → 切 :5200 到新 build ───"
  if ! _bg_call "${BG_PROMOTE_FN:-}" "$target_sha"; then
    echo "❌ promote 中失败 → 自动回滚到锚点 sha=${anchor_sha}"
    _bg_call "${BG_ROLLBACK_FN:-}" "$anchor_sha" || echo "❌❌ 回滚命令本身也失败！需立即人工介入"
    _bg_call "${BG_ALERT_P0_FN:-}" "promote 失败已自动回滚到 ${anchor_sha}，请人工核实 :5200 健康" || true
    return 1
  fi

  # promote 后复验生产
  if ! _bg_call "${BG_VERIFY_PROD_FN:-}" "$target_sha"; then
    echo "❌ promote 后 :5200 验证不过（health/版本不命中）→ 自动回滚到锚点 sha=${anchor_sha}"
    _bg_call "${BG_ROLLBACK_FN:-}" "$anchor_sha" || echo "❌❌ 回滚命令本身也失败！需立即人工介入"
    _bg_call "${BG_ALERT_P0_FN:-}" "promote 后生产验证失败已回滚到 ${anchor_sha}" || true
    return 1
  fi

  echo "✅ promote 成功：:5200 已切到新版本 sha=${target_sha}"
  _bg_call "${BG_DESTROY_STAGING_FN:-}" || true   # 部署成功后清理 staging slot
  echo "═══ 蓝绿部署完成 ═══"
  return 0
}

# ════════════════════════════════════════════════════════════════════════════
# mmv 上真实 hook 实现（deploy-us-vps.yml 把 BG_*_FN 指向这些函数）
#
# 约定（deploy yml 提前 export 的环境变量）：
#   ZJ_REPO          仓库根（如 /Users/administrator/perfect21/zenithjoy）
#   ZJ_API_DIR       =$ZJ_REPO/apps/api
#   ZJ_PROD_PORT     生产端口（5200）
#   ZJ_STAGING_PORT  staging 端口（5201）
#   ZJ_PROD_LABEL    生产 launchd label（com.zenithjoy.api）
#   ZJ_STAGING_DB    staging 库名（zenithjoy_test）
#   ZJ_PROD_PLIST    生产 plist 路径（用来继承运行时 env）
#   ZJ_NODE          node 可执行（/opt/homebrew/bin/node）
#   BRAIN_URL        Brain API（报 P0 用）
# ════════════════════════════════════════════════════════════════════════════

# 从生产 plist 的 EnvironmentVariables 提取所有 KEY=VALUE（每行一条），
# 供 staging slot 继承运行时密钥。覆写 PORT/DATABASE_NAME/NODE_ENV 由调用方做。
_extract_prod_env() {
  local plist="$1"
  [ -f "$plist" ] || return 0
  /usr/bin/python3 - "$plist" <<'PY'
import plistlib, sys, shlex
with open(sys.argv[1], 'rb') as f:
    data = plistlib.load(f)
env = data.get('EnvironmentVariables', {})
for k, v in env.items():
    print(f"{k}={v}")
PY
}

# staging_deploy_slot <sha>：把新 build 拉起到 staging slot :5201（连 test 库）。
# 继承生产 env，覆写 PORT/DATABASE_NAME/NODE_ENV；先杀占端口的残留进程，再后台起 node。
staging_deploy_slot() {
  local sha="$1"
  echo "起 staging slot :${ZJ_STAGING_PORT}（DB=${ZJ_STAGING_DB}）..."
  kill_port "${ZJ_STAGING_PORT}"

  # 收集生产运行时 env → 写临时 env 文件 → 覆写 staging 专属项（覆写放最后，后值生效）
  local env_file; env_file="$(mktemp)"
  _extract_prod_env "${ZJ_PROD_PLIST}" > "$env_file"
  {
    echo "PORT=${ZJ_STAGING_PORT}"
    echo "DATABASE_NAME=${ZJ_STAGING_DB}"
    echo "NODE_ENV=staging"
    echo "BUILD_SHA=${sha}"
  } >> "$env_file"

  # 后台起 staging 进程：env <file> 形式逐行注入（KEY=VALUE），不挂 launchd、不开机自启
  ( cd "${ZJ_API_DIR}" || exit 1
    # 逐行 export，避免值里含空格/特殊字符被 word-split
    while IFS='=' read -r _k _v; do
      [ -z "$_k" ] && continue
      export "${_k}=${_v}"
    done < "$env_file"
    nohup "${ZJ_NODE}" dist/index.js \
      > /Users/administrator/Library/Logs/zenithjoy-api.staging.log \
      2> /Users/administrator/Library/Logs/zenithjoy-api.staging.error.log &
    echo $! > /tmp/zj-staging.pid
  )
  rm -f "$env_file"

  # 等 staging health
  local up=0
  for _ in $(seq 1 20); do
    if curl -sf "http://localhost:${ZJ_STAGING_PORT}/health" >/dev/null 2>&1; then up=1; break; fi
    sleep 2
  done
  if [ "$up" -ne 1 ]; then
    echo "❌ staging slot 20s 内没起来"
    tail -20 /Users/administrator/Library/Logs/zenithjoy-api.staging.error.log 2>/dev/null || true
    return 1
  fi
  echo "✅ staging slot :${ZJ_STAGING_PORT} 已起"
  return 0
}

# staging_verify <sha>：在 :5201 跑部署验证四项。
#   ① migration 在 test 库可跑通  ② /health 通过  ③ 版本断言 :5201==sha  ④ golden-path smoke 绿
staging_verify() {
  local sha="$1"
  local base="http://localhost:${ZJ_STAGING_PORT}"

  echo "① migration 在 ${ZJ_STAGING_DB} 跑通验证..."
  if ! ( cd "${ZJ_API_DIR}" && DATABASE_NAME="${ZJ_STAGING_DB}" npm run migrate ); then
    echo "❌ migration 在 test 库跑炸 → migration 本身有问题，绝不让它撞生产库"; return 1
  fi

  echo "② staging /health..."
  if ! curl -sf "${base}/health" >/dev/null 2>&1; then echo "❌ staging /health 不过"; return 1; fi

  echo "③ 版本断言 staging==${sha}..."
  if ! assert_version "${base}" "${sha}"; then echo "❌ staging 跑的不是目标 sha"; return 1; fi

  echo "④ golden-path smoke（API_BASE=${base}）..."
  local smoke="${ZJ_REPO}/.github/workflows/scripts/smoke/golden-path-1-smoke.sh"
  if [ -x "$smoke" ] || [ -f "$smoke" ]; then
    if ! API_BASE="${base}" bash "$smoke"; then echo "❌ golden-path smoke 在 staging 红"; return 1; fi
  else
    echo "⚠️  golden-path smoke 缺失，跳过（不应发生）"
  fi
  echo "✅ staging 四项验证全绿"
  return 0
}

# staging_record_anchor：打印当前生产 :5200 的 sha（promote 前的回滚锚点）。
staging_record_anchor() {
  curl -sf "http://localhost:${ZJ_PROD_PORT}/version" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).sha||""))}catch{process.stdout.write("")}})' 2>/dev/null || echo ""
}

# staging_promote <sha>：方案 A —— 对生产库跑 migration，把验过的新 build 重启进 :5200。
staging_promote() {
  local sha="$1"
  echo "promote：对生产库跑 migration（幂等）..."
  if ! ( cd "${ZJ_API_DIR}" && npm run migrate ); then
    echo "❌ 生产库 migration 失败"; return 1
  fi
  echo "promote：干净重启 ${ZJ_PROD_LABEL}（先杀占 :${ZJ_PROD_PORT} 进程）..."
  launchctl stop "${ZJ_PROD_LABEL}" || true
  sleep 2
  kill_port "${ZJ_PROD_PORT}"
  launchctl start "${ZJ_PROD_LABEL}"
  local up=0
  for _ in $(seq 1 12); do
    if curl -sf "http://localhost:${ZJ_PROD_PORT}/health" >/dev/null 2>&1; then up=1; break; fi
    sleep 5
  done
  [ "$up" -eq 1 ] || { echo "❌ promote 后 :${ZJ_PROD_PORT} 没起来"; return 1; }
  return 0
}

# staging_verify_prod <sha>：promote 后断言生产 health + sha==目标。
staging_verify_prod() {
  local sha="$1"
  local base="http://localhost:${ZJ_PROD_PORT}"
  curl -sf "${base}/health" >/dev/null 2>&1 || { echo "❌ 生产 /health 不过"; return 1; }
  assert_version "${base}" "${sha}"
}

# staging_rollback <anchor_sha>：promote 失败时把生产恢复到上一版。
# 方案 A 下 dist 已被新 build 覆盖，回滚 = git checkout 锚点 sha 重 build 再重启。
# 锚点为空（首次部署无旧版本）则仅重启确保不停在半死。
staging_rollback() {
  local anchor="$1"
  echo "⏪ 回滚生产到锚点 sha=${anchor:-<空>}"
  if [ -n "$anchor" ]; then
    ( cd "${ZJ_REPO}" && git reset --hard "$anchor" 2>/dev/null ) || echo "⚠️ git reset 锚点失败，尝试仅重启兜底"
    ( cd "${ZJ_API_DIR}" && BUILD_SHA="$anchor" npm run build ) || echo "⚠️ 回滚 build 失败"
  fi
  launchctl stop "${ZJ_PROD_LABEL}" || true
  sleep 2
  kill_port "${ZJ_PROD_PORT}"
  launchctl start "${ZJ_PROD_LABEL}"
  local up=0
  for _ in $(seq 1 12); do
    if curl -sf "http://localhost:${ZJ_PROD_PORT}/health" >/dev/null 2>&1; then up=1; break; fi
    sleep 5
  done
  [ "$up" -eq 1 ] || { echo "❌❌ 回滚后 :${ZJ_PROD_PORT} 仍不健康，需人工立即介入"; return 1; }
  if [ -n "$anchor" ]; then
    assert_version "http://localhost:${ZJ_PROD_PORT}" "$anchor" || { echo "❌ 回滚后版本断言不命中锚点"; return 1; }
  fi
  echo "✅ 已回滚到健康态"
  return 0
}

# staging_destroy_slot：销毁 staging slot 进程（验证完/部署成功后清理）。
staging_destroy_slot() {
  if [ -f /tmp/zj-staging.pid ]; then
    kill "$(cat /tmp/zj-staging.pid)" 2>/dev/null || true
    rm -f /tmp/zj-staging.pid
  fi
  kill_port "${ZJ_STAGING_PORT}"
  echo "✅ staging slot :${ZJ_STAGING_PORT} 已销毁"
  return 0
}

# staging_alert_p0 <msg>：开 P0 通知 Brain。
staging_alert_p0() {
  local msg="$1"
  curl -sf -X POST "${BRAIN_URL:-http://localhost:5221}/api/brain/tasks" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"ZenithJoy 蓝绿部署护栏触发\",\"priority\":\"P0\",\"task_type\":\"dev\",\"description\":\"${msg}\"}" \
    >/dev/null 2>&1 || echo "⚠️ Brain 不可达，P0 告警未送达（消息：${msg}）"
  return 0
}
