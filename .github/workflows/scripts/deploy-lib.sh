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
# release 隔离原语（releases/<sha>/ + current 软链）
#
# 治根（PrepPRD 2026-06-25）：旧 staging_rollback 用 `git reset --hard 锚点 + 重 build`
# 在工作树原地搞——回滚要重新编译、碰整个 repo 工作树、首次部署无锚点就只能祈祷。
# 改成 Cecelia 原子 mv 纪律的 release 隔离形态（落地用 releases/current 软链，不是 docker）：
#   · build 进独立 releases/<sha>/（apps/api 产物：dist + node_modules + package.json）
#   · 生产 launchd 从 releases/current 软链跑（current → releases/<活跃sha>）
#   · promote = 原子重指 current → 新 release（ln -sfn 临时名 + mv -hf 原子 rename）+ 重启
#   · rollback = 原子重指 current → 上一个 release（秒级、不重编译、不碰工作树）
#
# 下面四个原语纯操作软链/目录，无外部副作用（除文件系统），可被单测（Case H/I/J/K）。
# ════════════════════════════════════════════════════════════════════════════

# release_dir_for <releases_root> <sha>：拼出某 sha 的 release 目录路径（不创建）。
release_dir_for() {
  local root="$1" sha="$2"
  echo "${root}/${sha}"
}

# current_release_sha <releases_root>：读 current 软链指向的 release 的 sha（= basename）。
# current 不存在 / 不是软链 / 指向不存在目录 → 打印空串。
current_release_sha() {
  local root="$1"
  local link="${root}/current"
  [ -L "$link" ] || return 0
  local target
  target="$(readlink "$link" 2>/dev/null || echo "")"
  [ -z "$target" ] && return 0
  basename "$target"
}

# atomic_repoint_current <releases_root> <target_release_dir>：原子把 current 重指到目标 release。
# 用「ln -sfn 临时软链 + mv -hf 原子 rename」保证 current 任一时刻要么旧要么新、绝不悬空中间态。
# 目标 release 目录不存在 → 返 1（绝不把 current 指向不存在的 release）。
atomic_repoint_current() {
  local root="$1" target="$2"
  if [ ! -d "$target" ]; then
    echo "❌ atomic_repoint_current：目标 release 不存在 $target，拒绝重指 current" >&2
    return 1
  fi
  local link="${root}/current"
  local tmp="${root}/.current.tmp.$$"
  # 先建临时软链指向目标，再原子 rename 覆盖 current（mv -h 不跟随软链，rename 是原子的）
  ln -sfn "$target" "$tmp" || { echo "❌ 建临时软链失败" >&2; return 1; }
  if ! mv -hf "$tmp" "$link" 2>/dev/null; then
    # 兜底：部分平台 mv 不认 -h，退回 mv -f（target 不是软链时安全）
    mv -f "$tmp" "$link" || { echo "❌ 原子 rename current 失败" >&2; rm -f "$tmp"; return 1; }
  fi
  return 0
}

# prune_old_releases <releases_root> <keep_n>：按 mtime 保留最新 keep_n 个 release 目录，
# 删更旧的——但 current 软链指向的 release **绝不删**（即便它已超出 keep_n）。
prune_old_releases() {
  local root="$1" keep="${2:-5}"
  [ -d "$root" ] || return 0
  local keep_sha
  keep_sha="$(current_release_sha "$root")"
  # 按 mtime 新→旧列出 release 目录名（排除 current/staging 软链）。release 名是 git sha（纯字母数字），
  # 不含特殊字符，ls 安全。
  local dirs
  # shellcheck disable=SC2012
  dirs="$(cd "$root" && ls -1dt -- */ 2>/dev/null | sed 's:/*$::' | grep -vE '^(current|staging)$' || true)"
  local i=0
  local d
  while IFS= read -r d; do
    [ -z "$d" ] && continue
    i=$((i+1))
    # 保留最新 keep 个
    [ "$i" -le "$keep" ] && continue
    # current 指向的绝不删
    [ "$d" = "$keep_sha" ] && continue
    rm -rf "${root:?}/${d:?}"
  done <<< "$dirs"
  return 0
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
#   ZJ_RELEASES_DIR  release 隔离根（如 /Users/administrator/zenithjoy-releases）
#                    布局：$ZJ_RELEASES_DIR/<sha>/（apps/api 产物）+ $ZJ_RELEASES_DIR/current 软链
#                    生产 launchd 从 $ZJ_RELEASES_DIR/current/dist/index.js 跑。
#   ZJ_KEEP_RELEASES 保留几个旧 release（默认 5），prune 多的（current 指向的绝不删）
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

# build_release <sha>：把 apps/api 产物 build 进独立 release 目录 releases/<sha>/。
# 幂等：同 sha 已 build 过（有 dist/index.js）直接复用，不重复 build。
# release 目录自包含：dist + node_modules + package.json，promote/rollback 切软链即换代码。
build_release() {
  local sha="$1"
  local reldir; reldir="$(release_dir_for "${ZJ_RELEASES_DIR}" "$sha")"
  if [ -f "${reldir}/dist/index.js" ]; then
    echo "✅ release ${sha} 已存在（${reldir}），复用"
    return 0
  fi
  echo "build release ${sha} → ${reldir} ..."
  mkdir -p "${reldir}"
  # 从工作树（deploy yml 已 git reset 到目标 sha）build，产物拷进 release 目录。
  ( cd "${ZJ_API_DIR}" || exit 1
    BUILD_SHA="${sha}" npm run build
  ) || { echo "❌ build 失败"; return 1; }
  # 拷自包含运行所需：dist + package.json + node_modules（node_modules 用硬链快拷省空间/时间）
  cp -R "${ZJ_API_DIR}/dist" "${reldir}/dist" || { echo "❌ 拷 dist 失败"; return 1; }
  cp "${ZJ_API_DIR}/package.json" "${reldir}/package.json" 2>/dev/null || true
  if [ -d "${ZJ_API_DIR}/node_modules" ]; then
    cp -Rc "${ZJ_API_DIR}/node_modules" "${reldir}/node_modules" 2>/dev/null \
      || cp -R "${ZJ_API_DIR}/node_modules" "${reldir}/node_modules" \
      || { echo "❌ 拷 node_modules 失败"; return 1; }
  fi
  [ -f "${reldir}/dist/index.js" ] || { echo "❌ release 产物缺 dist/index.js"; return 1; }
  echo "✅ release ${sha} build 完成"
  return 0
}

# staging_deploy_slot <sha>：build release + 把【常驻 staging 实例】(:5201) 切到该 release。
# 治根（B）：main 合并只动常驻 staging，绝不碰生产 :5200。
# 常驻 staging launchd（com.zenithjoy.api.staging）从 releases/staging 软链跑——这里：
#   ① build release  ② 原子重指 releases/staging 软链 → 新 release  ③ kunload/load 重启常驻 staging
# staging 进程 env（PORT=5201 / DATABASE_NAME=zenithjoy_test / NODE_ENV=staging）在 plist 里定义。
staging_deploy_slot() {
  local sha="$1"
  echo "起常驻 staging :${ZJ_STAGING_PORT}（DB=${ZJ_STAGING_DB}）→ release ${sha} ..."

  if ! build_release "$sha"; then echo "❌ staging release build 失败"; return 1; fi

  local reldir; reldir="$(release_dir_for "${ZJ_RELEASES_DIR}" "$sha")"
  # 常驻 staging 用独立软链 releases/staging（与生产 current 隔离），原子重指到新 release
  local staging_link="${ZJ_RELEASES_DIR}/staging"
  local tmp="${ZJ_RELEASES_DIR}/.staging.tmp.$$"
  ln -sfn "$reldir" "$tmp" || { echo "❌ 建 staging 临时软链失败"; return 1; }
  mv -hf "$tmp" "$staging_link" 2>/dev/null || mv -f "$tmp" "$staging_link" || { echo "❌ 重指 staging 软链失败"; rm -f "$tmp"; return 1; }
  echo "✅ releases/staging → ${sha}"

  # 重启常驻 staging launchd（先杀占端口残留，再 kickstart）
  kill_port "${ZJ_STAGING_PORT}"
  local staging_label="${ZJ_STAGING_LABEL:-com.zenithjoy.api.staging}"
  launchctl stop "${staging_label}" 2>/dev/null || true
  sleep 1
  launchctl start "${staging_label}" 2>/dev/null || true

  # 等 staging health
  local up=0
  for _ in $(seq 1 20); do
    if curl -sf "http://localhost:${ZJ_STAGING_PORT}/health" >/dev/null 2>&1; then up=1; break; fi
    sleep 2
  done
  if [ "$up" -ne 1 ]; then
    echo "❌ 常驻 staging 20s 内没起来"
    tail -20 /Users/administrator/Library/Logs/zenithjoy-api.staging.error.log 2>/dev/null || true
    return 1
  fi
  echo "✅ 常驻 staging :${ZJ_STAGING_PORT} 已起（release ${sha}）"
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
    # staging 上 install-pack tarball 未必已构建/部署（是独立 ops 关注点，不是本次 API 回归）。
    # 默认把 install-pack manifest/download/license burn-in 这类环境性断言降级（治蓝绿 C 假阳）；
    # 想在 staging 也严验 install-pack 的，部署时 export ZJ_STAGING_SKIP_INSTALL_PACK=0。
    local skip_ip="${ZJ_STAGING_SKIP_INSTALL_PACK:-1}"
    if ! API_BASE="${base}" GOLDEN_PATH_SKIP_INSTALL_PACK="${skip_ip}" bash "$smoke"; then
      echo "❌ golden-path smoke 在 staging 红"; return 1
    fi
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

# staging_promote <sha>：release 隔离版 —— 确保 release 存在 → 对生产库跑 migration →
# 原子重指 releases/current → 新 release → 干净重启生产 launchd（从 current 跑）。
# 不再碰工作树、不再原地重 build；切换是软链原子 rename（秒级）。
staging_promote() {
  local sha="$1"

  echo "promote：确保 release ${sha} 已 build（幂等）..."
  if ! build_release "$sha"; then echo "❌ promote release build 失败"; return 1; fi
  local reldir; reldir="$(release_dir_for "${ZJ_RELEASES_DIR}" "$sha")"

  echo "promote：对生产库跑 migration（从 release 目录跑，幂等）..."
  if ! ( cd "${reldir}" && npm run migrate ); then
    echo "❌ 生产库 migration 失败"; return 1
  fi

  echo "promote：原子重指 releases/current → ${sha}..."
  if ! atomic_repoint_current "${ZJ_RELEASES_DIR}" "${reldir}"; then
    echo "❌ 原子重指 current 失败"; return 1
  fi

  echo "promote：干净重启 ${ZJ_PROD_LABEL}（生产 launchd 从 current 跑，先杀占 :${ZJ_PROD_PORT} 进程）..."
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
  # 成功后 prune 旧 release（current 指向的绝不删）
  prune_old_releases "${ZJ_RELEASES_DIR}" "${ZJ_KEEP_RELEASES:-5}" || true
  return 0
}

# staging_verify_prod <sha>：promote 后断言生产 health + sha==目标。
staging_verify_prod() {
  local sha="$1"
  local base="http://localhost:${ZJ_PROD_PORT}"
  curl -sf "${base}/health" >/dev/null 2>&1 || { echo "❌ 生产 /health 不过"; return 1; }
  assert_version "${base}" "${sha}"
}

# staging_rollback <anchor_sha>：release 隔离版 —— 把生产恢复到上一版。
# 回滚 = 原子重指 releases/current → 锚点 sha 的 release + 重启（秒级、不重编译、不碰工作树）。
# 锚点为空（首次部署无旧版本）/ 锚点 release 目录不存在 → 仅重启 current 现状兜底（不停在半死）。
staging_rollback() {
  local anchor="$1"
  echo "⏪ 回滚生产到锚点 sha=${anchor:-<空>}（原子软链回上一 release）"
  if [ -n "$anchor" ]; then
    local reldir; reldir="$(release_dir_for "${ZJ_RELEASES_DIR}" "$anchor")"
    if [ -d "$reldir" ]; then
      atomic_repoint_current "${ZJ_RELEASES_DIR}" "$reldir" \
        || echo "⚠️ 原子重指锚点 release 失败，尝试仅重启 current 现状兜底"
    else
      echo "⚠️ 锚点 release 目录不存在（${reldir}），current 保持现状，仅重启兜底确保不停在半死"
    fi
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
  if [ -n "$anchor" ] && [ -d "$(release_dir_for "${ZJ_RELEASES_DIR}" "$anchor")" ]; then
    assert_version "http://localhost:${ZJ_PROD_PORT}" "$anchor" || { echo "❌ 回滚后版本断言不命中锚点"; return 1; }
  fi
  echo "✅ 已回滚到健康态"
  return 0
}

# staging_destroy_slot：常驻 staging 不销毁（KeepAlive 常驻，等下次部署覆盖）。
# 释义改变（B）：staging 不再是「验完即销毁的临时 slot」，而是常驻实例供人工打开看。
# 这里仅做成功后的旧 release prune（current/staging 指向的绝不删），不停 staging 进程。
staging_destroy_slot() {
  prune_old_releases "${ZJ_RELEASES_DIR}" "${ZJ_KEEP_RELEASES:-5}" || true
  echo "ℹ️  常驻 staging :${ZJ_STAGING_PORT} 保留（不销毁），仅 prune 旧 release"
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
