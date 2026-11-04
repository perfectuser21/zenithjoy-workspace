#!/usr/bin/env bash
# deploy-lib.sh — 共享前端原子发版原语与历史 Mac release 恢复。
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

# Historical Mac release recovery remains callable from rollback.sh.
# Active API staging/promotion uses scripts/deploy/hk-api-{staging,release}.sh.
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
