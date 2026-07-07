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
# 先建临时软链指向目标，再原子 rename 覆盖 current，保证 current 任一时刻要么旧要么新、绝不悬空。
# 跨平台坑：current 已存在且是软链时，裸 `mv -f tmp current` 在 Lin/GNU 会**跟随** current 软链
# 把 tmp 塞进它指向的目录（不是替换 current）。所以必须用「不跟随目标软链」的 rename：
#   · GNU/Linux：mv -fT（--no-target-directory，把目标当普通文件原子覆盖）
#   · BSD/macOS：mv -hf（-h 不跟随软链目标）
#   · 都不认时：rm -f current 后再 mv（非原子，但语义正确，兜底）
# 目标 release 目录不存在 → 返 1（绝不把 current 指向不存在的 release）。
# _atomic_swap_symlink <target> <link>：把 <link> 原子重指到 <target>（跨平台不跟随旧软链）。
_atomic_swap_symlink() {
  local target="$1" link="$2"
  local tmp="${link}.tmp.$$"
  ln -sfn "$target" "$tmp" || { echo "❌ 建临时软链失败" >&2; return 1; }
  if mv -fT "$tmp" "$link" 2>/dev/null; then return 0; fi   # GNU/Linux 原子覆盖
  if mv -hf "$tmp" "$link" 2>/dev/null; then return 0; fi   # BSD/macOS 原子覆盖
  # 兜底（非原子）：先删旧软链本身（不跟随），再 mv 进去
  rm -f "$link" 2>/dev/null || true
  mv -f "$tmp" "$link" || { echo "❌ 重指软链 ${link} 失败" >&2; rm -f "$tmp"; return 1; }
  return 0
}

atomic_repoint_current() {
  local root="$1" target="$2"
  if [ ! -d "$target" ]; then
    echo "❌ atomic_repoint_current：目标 release 不存在 $target，拒绝重指 current" >&2
    return 1
  fi
  _atomic_swap_symlink "$target" "${root}/current"
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
  local dirs=""
  if cd "$root" 2>/dev/null; then
    # shellcheck disable=SC2012
    dirs="$(ls -1dt -- */ 2>/dev/null | sed 's:/*$::' | grep -vE '^(current|staging)$')"
    cd - >/dev/null 2>&1 || true
  fi
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

# list_releases <releases_root>：按 mtime 新→旧逐行打印 release 目录名（即 git sha），
# 排除 current/staging 软链。供人工回滚入口列出留存的可回退版本。
# 与 prune_old_releases 同一套排序口径（ls -1dt + 排除软链），保证"留存5份"和"挑哪个"一致。
list_releases() {
  local root="$1"
  [ -d "$root" ] || return 0
  if cd "$root" 2>/dev/null; then
    # shellcheck disable=SC2012
    ls -1dt -- */ 2>/dev/null | sed 's:/*$::' | grep -vE '^(current|staging)$'
    cd - >/dev/null 2>&1 || true
  fi
  return 0
}

# previous_release <releases_root>：打印「current 指向的 release 的上一个」release sha。
# 上一个 = list_releases（mtime 新→旧）里紧跟在 current sha 之后的那个。
# current 不存在 / current 是列表里最老的一个（没有更旧的可回退）→ 打印空串。
# 这是人工 rollback 无参时的回退目标（退到上一版）。
previous_release() {
  local root="$1"
  local cur
  cur="$(current_release_sha "$root")"
  [ -z "$cur" ] && return 0
  local found_cur=0 d
  while IFS= read -r d; do
    [ -z "$d" ] && continue
    if [ "$found_cur" -eq 1 ]; then
      echo "$d"      # current 之后紧邻的那个 = 上一版
      return 0
    fi
    [ "$d" = "$cur" ] && found_cur=1
  done <<< "$(list_releases "$root")"
  return 0           # 没有更旧的可回退 → 空串
}

# ════════════════════════════════════════════════════════════════════════════
# HK Dashboard release 隔离（静态 dist + 软链）—— 复用上面的 sha-keyed 原语，不另发明 tag。
#
# 治根（2026-06-25）：promote-dashboard-prod.yml 是 `cp -r dist/. .../dist/` 原地覆盖、零留存、
# 零回档——是整条部署线最后一个"炸了回不来"的点。改成与 API 同款 sha-keyed release 隔离：
#
# 布局（HK 上 /opt/zenithjoy/autopilot-dashboard/）：
#   releases/<sha>/            每次 build 的 dist 实体（自包含静态文件）
#   releases/current           软链 → releases/<活跃sha>（用现有 current_release_sha/atomic_repoint_current）
#   dist                       软链 → releases/current（容器 bind-mount 的就是它）
#
# ⚠️ docker bind-mount 在容器启动时解析软链到真实 inode，活体换软链不会切已跑容器的挂载，
#    所以 promote/rollback 切完软链都必须 `docker restart` 让容器重解析（与现状 promote 一样要 restart）。
#    nginx 不用改（root /usr/share/nginx/html 就是挂进来的 dist 内容）。
#
# 两个编排函数纯操作目录/软链（无 docker/ssh 副作用），可在本地临时目录单测（Case R/S）。
# ════════════════════════════════════════════════════════════════════════════

# dashboard_release_promote <dashboard_dir> <sha> <built_dist_dir> [keep_n]
#   把 built_dist_dir 的内容落进 <dashboard_dir>/releases/<sha>/ → 原子重指 releases/current → <sha>
#   → 确保 <dashboard_dir>/dist 软链 → releases/current → prune 到最近 keep_n（默认 5，current 指向的不删）。
#   幂等：同 sha 再来一次覆盖该 release 目录内容、指针不变。built_dist_dir 不存在/为空 → 返 1。
dashboard_release_promote() {
  local dash_dir="$1" sha="$2" built="$3" keep="${4:-5}"
  if [ -z "$dash_dir" ] || [ -z "$sha" ]; then
    echo "❌ dashboard_release_promote：缺 dashboard_dir / sha" >&2; return 1
  fi
  if [ ! -d "$built" ] || [ -z "$(ls -A "$built" 2>/dev/null)" ]; then
    echo "❌ dashboard_release_promote：build 产物目录不存在或为空（${built}）" >&2; return 1
  fi
  local rels="${dash_dir}/releases"
  local reldir; reldir="$(release_dir_for "$rels" "$sha")"
  # 幂等：同 sha 重来先整目录删掉再建，避免残留旧文件（不用 dir/* glob，空目录会报 no match）。
  rm -rf "${reldir:?}" 2>/dev/null || true
  mkdir -p "$reldir" || { echo "❌ 建 release 目录失败 $reldir" >&2; return 1; }
  # 实体落静态文件（自包含）。
  cp -R "${built%/}/." "$reldir/" || { echo "❌ cp dist → release 失败" >&2; return 1; }
  # 原子重指 releases/current → 新 release
  if ! atomic_repoint_current "$rels" "$reldir"; then
    echo "❌ 原子重指 releases/current 失败" >&2; return 1
  fi
  # 确保 dist 软链 → releases/current（容器挂载点）。用同款不跟随旧软链的原子换链。
  if ! _atomic_swap_symlink "${rels}/current" "${dash_dir}/dist"; then
    echo "❌ 重指 dist → releases/current 失败" >&2; return 1
  fi
  prune_old_releases "$rels" "$keep"
  echo "✅ dashboard release promote：current → ${sha}，dist → releases/current"
  return 0
}

# dashboard_release_rollback <dashboard_dir> <target_sha>
#   把 releases/current 原子重指回 <target_sha>（必须是留存的 release，不在则返 1）。
#   dist 软链恒指 releases/current（promote 已建），故只需切 current。调用方负责 docker restart。
dashboard_release_rollback() {
  local dash_dir="$1" target="$2"
  if [ -z "$dash_dir" ] || [ -z "$target" ]; then
    echo "❌ dashboard_release_rollback：缺 dashboard_dir / target_sha" >&2; return 1
  fi
  local rels="${dash_dir}/releases"
  local reldir; reldir="$(release_dir_for "$rels" "$target")"
  if [ ! -d "$reldir" ]; then
    echo "❌ dashboard_release_rollback：目标 release 不在留存里（${reldir}）" >&2; return 1
  fi
  if ! atomic_repoint_current "$rels" "$reldir"; then
    echo "❌ 原子重指 releases/current → ${target} 失败" >&2; return 1
  fi
  # dist 软链兜底（首次/异常时可能未建）：确保它指向 releases/current。
  if [ ! -L "${dash_dir}/dist" ] || [ "$(readlink "${dash_dir}/dist")" != "${rels}/current" ]; then
    _atomic_swap_symlink "${rels}/current" "${dash_dir}/dist" || true
  fi
  echo "✅ dashboard release rollback：current → ${target}（dist 软链恒指 releases/current）"
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

# ════════════════════════════════════════════════════════════════════════════
# ensure_staging_plist —— 确保部署机有常驻 staging plist（自愈 provisioning）。
#
# 治根（2026-06-25 真实事故）：部署机只有生产 com.zenithjoy.api.plist，**staging label 没注册**
# （CI 干净环境无此 label）。staging_deploy_slot 用 `launchctl start com.zenithjoy.api.staging`
# 起 slot，但 launchctl start 对没注册的 label 是**静默空操作**（那行还带 ||true）→ :5201 永不
# listen → 20s 超时 → 部署判失败。蓝绿从启用起从没成功一次的根因就是它。
#
# 优先级（lead 2026-06-25 精炼）：
#   ① 仓库有 committed 模板 infrastructure/launchagents/com.zenithjoy.api.staging.plist →
#      以它为基（已含 Label/PORT/DB/ProgramArguments→releases/staging/dist/index.js/日志，不含密钥），
#      **合并注入**生产 plist 的密钥 env（登录/LLM 等要用）。优先既有模板、避免维护两套派生逻辑。
#      模板已声明的 PORT/DATABASE_*/NODE_ENV 以模板为准，再用 staging_overrides 收口，
#      绝不让生产值（:5200/cecelia/production）漏进 staging。
#   ② 仓库无模板（异常退路）→ 从生产 plist 程序化派生（覆写 PORT/DB/Label/Program/日志）。
# 两条都用 python plistlib：密钥只在机器上、绝不进 repo、绝不 echo。生产 plist 不存在 → 返非0。幂等。
#
# 约定环境变量（调用方/单测注入）：
#   ZJ_PROD_PLIST       生产 plist 路径（密钥来源，只读）
#   ZJ_STAGING_TEMPLATE committed 模板路径（默认 $ZJ_REPO/infrastructure/launchagents/com.zenithjoy.api.staging.plist）
#   ZJ_STAGING_PLIST    写出的 staging plist 路径（默认 ~/Library/LaunchAgents/com.zenithjoy.api.staging.plist）
#   ZJ_STAGING_PORT/ZJ_STAGING_DB/ZJ_STAGING_LABEL/ZJ_RELEASES_DIR/ZJ_NODE/ZJ_STAGING_LOG_DIR  覆写/派生值
ensure_staging_plist() {
  local prod_plist="${ZJ_PROD_PLIST:-}"
  local template="${ZJ_STAGING_TEMPLATE:-${ZJ_REPO:-}/infrastructure/launchagents/com.zenithjoy.api.staging.plist}"
  local out_plist="${ZJ_STAGING_PLIST:-$HOME/Library/LaunchAgents/com.zenithjoy.api.staging.plist}"
  local port="${ZJ_STAGING_PORT:-5201}"
  local db="${ZJ_STAGING_DB:-zenithjoy_test}"
  local label="${ZJ_STAGING_LABEL:-com.zenithjoy.api.staging}"
  local releases="${ZJ_RELEASES_DIR:?ZJ_RELEASES_DIR 未设}"
  local node="${ZJ_NODE:-/opt/homebrew/bin/node}"
  local logdir="${ZJ_STAGING_LOG_DIR:-$HOME/Library/Logs}"

  if [ ! -f "$prod_plist" ]; then
    echo "❌ ensure_staging_plist：生产 plist 不存在（${prod_plist}），无密钥来源，拒绝造残废 plist" >&2
    return 1
  fi

  mkdir -p "$(dirname "$out_plist")" "$logdir" 2>/dev/null || true

  PROD_PLIST="$prod_plist" TEMPLATE="$template" OUT_PLIST="$out_plist" \
  STAGING_PORT="$port" STAGING_DB="$db" STAGING_LABEL="$label" RELEASES_DIR="$releases" \
  NODE_BIN="$node" LOG_DIR="$logdir" \
  /usr/bin/python3 - <<'PY'
import plistlib, os, sys
prod     = os.environ["PROD_PLIST"]
template = os.environ["TEMPLATE"]
out      = os.environ["OUT_PLIST"]
port     = os.environ["STAGING_PORT"]
db       = os.environ["STAGING_DB"]
label    = os.environ["STAGING_LABEL"]
rels     = os.environ["RELEASES_DIR"]
node     = os.environ["NODE_BIN"]
logdir   = os.environ["LOG_DIR"]

with open(prod, "rb") as f:
    prod_data = plistlib.load(f)
prod_env = dict(prod_data.get("EnvironmentVariables", {}))

# staging 自身权威 env（绝不被生产值覆盖回 :5200/cecelia/production）。
# better-auth 两个 key 必须收口到 staging 域名：否则 merged.update(prod_env) 会把生产的
# BETTER_AUTH_URL/TRUSTED_ORIGINS=autopilot.zenjoymedia.media 抄进 staging，导致从
# staging-autopilot.zenjoymedia.media 登录被 better-auth 判 invalid origin（403）。
# auth.ts 已读这两个 env（trustedOrigins/baseURL），无需改代码（2026-06-25 真实事故）。
staging_overrides = {
    "PORT": str(port),
    "ZENITHJOY_API_URL": f"http://localhost:{port}",
    "DATABASE_NAME": db,
    "NODE_ENV": "staging",
    "BETTER_AUTH_URL": "https://staging-autopilot.zenjoymedia.media",
    "BETTER_AUTH_TRUSTED_ORIGINS": "https://staging-autopilot.zenjoymedia.media,http://localhost:5173",
    # agent→staging 隔离：install-pack 下载按本实例对外地址烧 agent 连接 URL（apps/api agent-install-pack.ts
    # 读这两个 env 烧进 agent .env 的 ZENITHJOY_API_URL/ZENITHJOY_API_BASE）。staging 必须收口到 staging 域名，
    # 否则 merged.update(prod_env) 会把生产 AGENT_PUBLIC_*=autopilot 抄进 staging → 从 staging 下载的 agent 连生产，
    # 隔离失效（2026-06-25 真实事故：staging slot 一度被填成生产值）。生产 slot 在生产 plist 各配生产值。
    "AGENT_PUBLIC_WS_URL": "wss://staging-autopilot.zenjoymedia.media/agent-ws",
    "AGENT_PUBLIC_BASE_URL": "https://staging-autopilot.zenjoymedia.media",
    # 微信客服模型：staging 固定 gpt-5.4-mini，避免每次 ensure_staging_plist 重生 plist 时被生产值冲掉。
    # 生产 plist 无此 key（wechat-draft.ts 默认 deepseek-v3.2），仅 staging 专属（2026-06-30）。
    "WECHAT_CS_MODEL": "gpt-5.4-mini",
}

if os.path.isfile(template):
    # ① 模板优先：以 committed 模板为基（结构 + DB env），合并注入生产密钥。
    with open(template, "rb") as f:
        data = plistlib.load(f)
    tmpl_env = dict(data.get("EnvironmentVariables", {}))
    merged = {}
    merged.update(prod_env)           # 生产密钥 + 其余 env 打底
    merged.update(tmpl_env)           # 模板显式声明的（PORT/DATABASE_*/NODE_ENV 等）盖回 staging 安全值
    merged.update(staging_overrides)  # 强制收口，杜绝任何生产值漏进
    data["EnvironmentVariables"] = merged
    # 模板已带 Label/ProgramArguments/WorkingDirectory/日志/KeepAlive/RunAtLoad，照用；缺失才兜底。
    data.setdefault("Label", label)
    data.setdefault("ProgramArguments", [node, f"{rels}/staging/dist/index.js"])
    data.setdefault("WorkingDirectory", f"{rels}/staging")
    data.setdefault("StandardOutPath", f"{logdir}/zenithjoy-api.staging.log")
    data.setdefault("StandardErrorPath", f"{logdir}/zenithjoy-api.staging.error.log")
    data.setdefault("KeepAlive", True)
    data.setdefault("RunAtLoad", True)
    src = "committed 模板 + 生产密钥注入"
else:
    # ② 无模板（异常退路）：从生产 plist 派生。
    data = dict(prod_data)
    env = dict(prod_env)
    env.update(staging_overrides)
    data["EnvironmentVariables"] = env
    data["Label"] = label
    data["ProgramArguments"] = [node, f"{rels}/staging/dist/index.js"]
    data["WorkingDirectory"] = f"{rels}/staging"
    data["StandardOutPath"]  = f"{logdir}/zenithjoy-api.staging.log"
    data["StandardErrorPath"] = f"{logdir}/zenithjoy-api.staging.error.log"
    data["KeepAlive"] = True
    data["RunAtLoad"] = True
    src = "生产 plist 派生（仓库无模板）"

with open(out, "wb") as f:
    plistlib.dump(data, f)

# 不打印任何密钥值，只确认结构
n = len(data.get("EnvironmentVariables", {}))
sys.stderr.write(f"✅ staging plist 就绪（{src}）: {out} (Label={data.get('Label')} PORT={port} DB={db} env_keys={n})\n")
PY
  local rc=$?
  [ "$rc" -eq 0 ] || { echo "❌ ensure_staging_plist：写出失败（rc=$rc）" >&2; return 1; }
  return 0
}

# ════════════════════════════════════════════════════════════════════════════
# ensure_prod_plist_points_to_current —— 让生产 plist 从 releases/current 软链跑（promote 真生效）。
#
# 治根（2026-06-25 勘察缺口）：生产 com.zenithjoy.api 的 ProgramArguments 写死指主 checkout
# `apps/api/dist/index.js`，而 staging_promote 是"原子重指 releases/current 软链 + 重启"。
# **重指 current 对生产实际跑什么零效果**——launchctl 还是按 plist 写死的主 checkout 路径起，
# promote 不真生效。要让 release 隔离的 promote/rollback 真生效，生产 plist 的 Program/WorkingDir
# 必须指向 releases/current/dist/index.js（与 staging 指 releases/staging 对称）。
#
# 本函数（同 ensure_staging_plist 套路，plistlib 程序化、幂等）：
#   · 读生产 plist → ProgramArguments[1] 改 releases/current/dist/index.js、WorkingDirectory 改 releases/current
#   · 注入 prod_overrides（固定必要 env，如 WECHAT_CS_MODEL）——仅补写，其余 env/密钥/Label/日志/KeepAlive 原样保留
#   · 已指向 current 且 overrides 已写 则幂等（结果一致）
# **安全纪律**：本函数只改 plist 文件本身（写到 ZJ_PROD_PLIST 指定路径），**不 unload/load/kickstart
#   任何 launchd 服务**——重启副作用由调用方（staging_promote）显式控制，便于 dry-run 单测。
#
# 约定环境变量：
#   ZJ_PROD_PLIST    生产 plist 路径（读+写回同一文件）
#   ZJ_RELEASES_DIR  release 隔离根（current 软链在此下）
#   ZJ_NODE          node 可执行路径（仅当原 plist 无 ProgramArguments 时兜底 [0]）
ensure_prod_plist_points_to_current() {
  local prod_plist="${ZJ_PROD_PLIST:-}"
  local releases="${ZJ_RELEASES_DIR:?ZJ_RELEASES_DIR 未设}"
  local node="${ZJ_NODE:-/opt/homebrew/bin/node}"

  if [ ! -f "$prod_plist" ]; then
    echo "❌ ensure_prod_plist_points_to_current：生产 plist 不存在（${prod_plist}）" >&2
    return 1
  fi

  PROD_PLIST="$prod_plist" RELEASES_DIR="$releases" NODE_BIN="$node" \
  /usr/bin/python3 - <<'PY'
import plistlib, os, sys
prod = os.environ["PROD_PLIST"]
rels = os.environ["RELEASES_DIR"]
node = os.environ["NODE_BIN"]

with open(prod, "rb") as f:
    data = plistlib.load(f)

want_index = f"{rels}/current/dist/index.js"
want_wd    = f"{rels}/current"

# ProgramArguments[0] 保留原 node 路径（有就用原来的，没有才兜底 NODE_BIN）。
args = list(data.get("ProgramArguments", []))
node_bin = args[0] if args else node
new_args = [node_bin, want_index]

# 生产必须固定的 env overrides（每次 ensure_prod_plist_points_to_current 都补写，
# 避免 plist 重生时 key 丢失→回落代码默认值导致生产功能静默失效）。
# 只 update 固定必要 key，其余 env/密钥/Label/日志/KeepAlive/RunAtLoad 全部原样保留。
prod_overrides = {
    "WECHAT_CS_MODEL": "gpt-5.4-mini",  # 防 plist 重生后回落 deepseek-v3.2（toapis 死渠道）（2026-06-30）
}
orig_env = dict(data.get("EnvironmentVariables", {}))

# 幂等判断：在修改前检查当前 plist 是否已是期望状态
already = (data.get("ProgramArguments") == new_args and data.get("WorkingDirectory") == want_wd
           and all(orig_env.get(k) == v for k, v in prod_overrides.items()))

data["ProgramArguments"] = new_args
data["WorkingDirectory"] = want_wd
new_env = dict(orig_env)
new_env.update(prod_overrides)
data["EnvironmentVariables"] = new_env

with open(prod, "wb") as f:
    plistlib.dump(data, f)

state = "已是 current（幂等）" if already else "已改指 releases/current"
sys.stderr.write(f"✅ 生产 plist {state}: ProgramArguments[1]={want_index} WorkingDirectory={want_wd}\n")
PY
  local rc=$?
  [ "$rc" -eq 0 ] || { echo "❌ ensure_prod_plist_points_to_current：写出失败（rc=$rc）" >&2; return 1; }
  return 0
}

# ════════════════════════════════════════════════════════════════════════════
# ensure_release_node_modules —— monorepo hoist 兜底（让 release 自包含可跑）。
#
# 治根（2026-06-25 真实事故）：依赖被 npm hoist 到 repo 根 node_modules，apps/api/node_modules
# 是**空目录**，build_release 的 `cp -Rc apps/api/node_modules` 拷进来还是空 → release 跑
# `node dist/index.js` 报 `Cannot find module 'dotenv'` → :5201/promote 后 :5200 都起不来。
# （生产 :5200 没撞上是因为它从 repo 树内 apps/api/dist 跑，node 向上走能找到根 node_modules；
#  release 目录在 repo 树外，向上走找不到根 → 必须自带或兜底。）
#
# 规则（方案 A，lead 2026-06-25 决策）：release node_modules 缺哨兵模块（dotenv）时，
# 从 hoisted 根 node_modules **实体拷贝**填充，让 release 真正自包含——**绝不 symlink 到根**。
# 为何不 symlink（否决方案 C）：① symlink 后 deploy 时 `npm ci` 改根 node_modules 会改到
# **正在跑的生产/旧 release**（它们共享同一份）；② 跨依赖变更 rollback 不干净（回到旧 release
# 仍用当前根 deps）。实体拷 = dist 与 node_modules 都按 sha 冻结，promote/rollback 切软链即换。
# 拷贝成本：macOS/APFS 用 `cp -c -R`（clonefile / CoW，近零磁盘 + 秒级）；非 APFS/Linux 回退
# `cp -R`（较慢但正确，CI 可接受）。磁盘由 prune_old_releases 控（只留最近 N 个 release）。
# 参数：<release_dir> <hoisted_root_node_modules>
ensure_release_node_modules() {
  local reldir="$1" root_nm="$2"
  local rel_nm="${reldir}/node_modules"
  # 已自带可解析的 dotenv（哨兵）且是真目录（非软链）→ 已自包含，不动
  if [ -e "${rel_nm}/dotenv/package.json" ] && [ ! -L "$rel_nm" ]; then
    return 0
  fi
  # 根 node_modules 自己可能是软链（如开发 worktree 把 node_modules 软链到主 checkout）；
  # 拷前先解引用到真实路径，保证 cp 复制的是真目录内容而非把软链本身拷过去。
  if [ -L "$root_nm" ]; then
    local resolved; resolved="$(cd "$root_nm" 2>/dev/null && pwd -P || echo "")"
    [ -n "$resolved" ] && root_nm="$resolved"
  fi
  if [ ! -e "${root_nm}/dotenv/package.json" ]; then
    echo "❌ ensure_release_node_modules：hoisted 根 node_modules 也缺 dotenv（${root_nm}），无法兜底" >&2
    return 1
  fi
  # release 自带的 node_modules 是空目录 / 软链 / 缺哨兵 → 移除后从根**实体拷贝**（CoW 优先）
  rm -rf "$rel_nm" 2>/dev/null || true
  if cp -c -R "$root_nm" "$rel_nm" 2>/dev/null; then
    echo "ℹ️  release node_modules 缺依赖，已从 hoisted 根 **CoW 实体拷贝**（cp -c，${root_nm}）"
  elif cp -R "$root_nm" "$rel_nm" 2>/dev/null; then
    echo "ℹ️  release node_modules 缺依赖，已从 hoisted 根 **实体拷贝**（cp -R 回退，${root_nm}）"
  else
    echo "❌ 实体拷贝 release node_modules 失败（${root_nm} → ${rel_nm}）" >&2
    return 1
  fi
  # 自包含校验：拷完哨兵必须可解析、且 rel_nm 是真目录（不是软链）
  if [ -L "$rel_nm" ] || [ ! -e "${rel_nm}/dotenv/package.json" ]; then
    echo "❌ 拷贝后 release node_modules 仍非自包含（软链=$([ -L "$rel_nm" ] && echo y || echo n) / dotenv 缺失）" >&2
    return 1
  fi
  return 0
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
  # 拷自包含运行所需：dist + package.json + node_modules（CoW 优先 cp -c，回退 cp -R）。
  cp -R "${ZJ_API_DIR}/dist" "${reldir}/dist" || { echo "❌ 拷 dist 失败"; return 1; }
  cp "${ZJ_API_DIR}/package.json" "${reldir}/package.json" 2>/dev/null || true
  if [ -d "${ZJ_API_DIR}/node_modules" ] && [ ! -L "${ZJ_API_DIR}/node_modules" ]; then
    cp -c -R "${ZJ_API_DIR}/node_modules" "${reldir}/node_modules" 2>/dev/null \
      || cp -R "${ZJ_API_DIR}/node_modules" "${reldir}/node_modules" \
      || { echo "❌ 拷 node_modules 失败"; return 1; }
  fi
  # monorepo hoist 兜底（方案 A 自包含）：依赖 hoist 到 repo 根时 apps/api/node_modules 是空的/软链，
  # 拷进来还是空 → release 跑 node 报 Cannot find module 'dotenv'。缺哨兵模块时从 hoisted 根
  # **实体拷贝**（绝不 symlink，见 ensure_release_node_modules 注释）。
  # 根 node_modules = $ZJ_REPO/node_modules（ZJ_API_DIR = $ZJ_REPO/apps/api）。
  local root_nm="${ZJ_REPO:-$(cd "${ZJ_API_DIR}/../.." && pwd)}/node_modules"
  if ! ensure_release_node_modules "${reldir}" "${root_nm}"; then
    echo "❌ release node_modules 自包含填充失败（dotenv 不可解析）"; return 1
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
  if ! _atomic_swap_symlink "$reldir" "${ZJ_RELEASES_DIR}/staging"; then
    echo "❌ 重指 staging 软链失败"; return 1
  fi
  echo "✅ releases/staging → ${sha}"

  # 自愈 provisioning：确保部署机有常驻 staging plist（优先 committed 模板 + 注入生产密钥，
  # 无模板才从生产 plist 派生；幂等每轮重生）。治根：部署机只有生产 plist、staging label 没注册，
  # launchctl start 不存在的 label 是静默空操作（那行还带 ||true）→ :5201 永不起。
  local staging_label="${ZJ_STAGING_LABEL:-com.zenithjoy.api.staging}"
  local staging_plist="${ZJ_STAGING_PLIST:-$HOME/Library/LaunchAgents/${staging_label}.plist}"
  export ZJ_PROD_PLIST ZJ_STAGING_PLIST="${staging_plist}" ZJ_STAGING_PORT ZJ_STAGING_DB \
         ZJ_STAGING_LABEL="${staging_label}" ZJ_RELEASES_DIR ZJ_NODE ZJ_REPO
  if ! ensure_staging_plist; then
    echo "❌ 确保常驻 staging plist 失败（生产 plist 缺失？）"; return 1
  fi

  # mmv: launchctl bootstrap gui/UID 在 SSH 会话里访问不到 GUI domain（与 production promote 同根因）。
  # fix: kill + python3 读 plist EnvironmentVariables + start_new_session，不依赖 launchctl。
  kill_port "${ZJ_STAGING_PORT}"
  local _stg_log="${ZJ_STAGING_LOG_DIR:-$HOME/Library/Logs}"
  local _stg_out="${_stg_log}/zenithjoy-api.staging.log"
  local _stg_err="${_stg_log}/zenithjoy-api.staging.error.log"
  local _stg_py; _stg_py="$(mktemp /tmp/zj-staging-start.XXXXXX.py)"
  cat > "${_stg_py}" << 'ZJ_START_PY'
import plistlib, subprocess, os, sys
plist_path, log_out, log_err = sys.argv[1], sys.argv[2], sys.argv[3]
with open(plist_path, "rb") as f:
    d = plistlib.load(f)
env = dict(os.environ)
env.update(d.get("EnvironmentVariables", {}))
prog = d["ProgramArguments"]
work = d.get("WorkingDirectory", os.path.dirname(prog[-1]))
with open(log_out, "a") as fo, open(log_err, "a") as fe:
    proc = subprocess.Popen(prog, env=env, cwd=work, stdout=fo, stderr=fe, start_new_session=True)
    print(f"staging PID={proc.pid}")
ZJ_START_PY
  if ! python3 "${_stg_py}" "${staging_plist}" "${_stg_out}" "${_stg_err}"; then
    rm -f "${_stg_py}"
    echo "❌ 启动 staging 进程失败（python3 plist-env）"; return 1
  fi
  rm -f "${_stg_py}"

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

  # 对生产库跑 migration。治根（promote run 28148797888 实证）：从 release 目录跑
  # `ts-node db/migrations/run-migration.ts` 报 Cannot find module './run-migration.ts'——
  # release 是 build 产物（只有 dist，没有 db/migrations 的 .ts 源 + 没有 ts-node/tsconfig），
  # ts-node 项目解析不到源文件，**每次 promote 都卡在这一步**，走不到后面的 plist 切 current + 重启。
  # 改成从【主 checkout】跑（deploy yml 已 git-sync 到目标 sha、有 ts-node/tsconfig/db/migrations 源），
  # 显式连生产库（ZJ_PROD_DB 默认 cecelia）。这与 staging_verify 那步迁移同样的 cwd/调用方式（已跑通）。
  # 幂等：已 applied 就 no-op（"All migrations already applied"）。
  echo "promote：对生产库（${ZJ_PROD_DB:-cecelia}）跑 migration（从主 checkout 跑，幂等）..."
  if ! ( cd "${ZJ_API_DIR}" && DATABASE_NAME="${ZJ_PROD_DB:-cecelia}" npm run migrate ); then
    echo "❌ 生产库 migration 失败"; return 1
  fi

  # 安全顺序：先把 current 原子重指到【已验过的】release（current 此刻一定指向真实存在的 release），
  # 再改生产 plist 指 current，最后才重启——任一前置失败都不碰运行中的生产进程。
  echo "promote：原子重指 releases/current → ${sha}..."
  if ! atomic_repoint_current "${ZJ_RELEASES_DIR}" "${reldir}"; then
    echo "❌ 原子重指 current 失败"; return 1
  fi

  # 让生产 plist 从 releases/current 跑（治"重指 current 对生产零效果"缺口）。幂等、只改路径不碰密钥。
  echo "promote：确保生产 plist 指向 releases/current（重启前）..."
  export ZJ_PROD_PLIST ZJ_RELEASES_DIR ZJ_NODE
  if ! ensure_prod_plist_points_to_current; then
    echo "❌ 生产 plist 改指 current 失败，放弃 promote（不重启，生产仍跑旧进程不受影响）"; return 1
  fi

  echo "promote：干净重启生产进程（kill + nohup node，launchctl 在 mmv 不可用）..."
  # mmv 上 launchctl bootstrap/kickstart 失败→触发 rollback，改用 kill+nohup 直启（与手动 promote 一致）。
  kill_port "${ZJ_PROD_PORT}"
  local _pw=0
  while lsof -i ":${ZJ_PROD_PORT}" -t >/dev/null 2>&1 && [ $_pw -lt 5 ]; do
    sleep 1; _pw=$((_pw+1))
  done
  # source 持久 env（HOME/ 优先 /tmp/ 兜底；source 仅补凭据，ZJ_* 变量由调用方已 export）
  local _penv="${HOME}/zenithjoy-prod-env.sh"
  [ -f "$_penv" ] || _penv="/tmp/prod-env.sh"
  if [ -f "$_penv" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$_penv" 2>/dev/null || true
    set +a
  fi
  local _node="${ZJ_NODE:-/opt/homebrew/bin/node}"
  nohup "$_node" "${ZJ_RELEASES_DIR}/current/dist/index.js" >> /tmp/prod-main.log 2>&1 &
  echo "promote：新进程 PID=$! 已启动，等待 :${ZJ_PROD_PORT} 健康..."
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
  # 回滚 = current 重指到锚点 + 用同样的 kill+nohup 方式重启（launchctl 在 mmv 不可用）。
  kill_port "${ZJ_PROD_PORT}"
  local _rw=0
  while lsof -i ":${ZJ_PROD_PORT}" -t >/dev/null 2>&1 && [ $_rw -lt 5 ]; do
    sleep 1; _rw=$((_rw+1))
  done
  local _rpenv="${HOME}/zenithjoy-prod-env.sh"
  [ -f "$_rpenv" ] || _rpenv="/tmp/prod-env.sh"
  if [ -f "$_rpenv" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$_rpenv" 2>/dev/null || true
    set +a
  fi
  local _rnode="${ZJ_NODE:-/opt/homebrew/bin/node}"
  nohup "$_rnode" "${ZJ_RELEASES_DIR}/current/dist/index.js" >> /tmp/prod-main.log 2>&1 &
  echo "rollback：新进程 PID=$! 已启动，等待 :${ZJ_PROD_PORT} 健康..."
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
