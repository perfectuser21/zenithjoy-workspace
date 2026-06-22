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
