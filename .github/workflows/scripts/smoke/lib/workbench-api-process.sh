#!/usr/bin/env bash
WORKBENCH_PORT_TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/workbench-port.mjs"

workbench_wait_port_available() {
  node "$WORKBENCH_PORT_TOOL" wait "$1" >/dev/null
}

workbench_child_matches() {
  local actual parent rest
  actual=$(ps -p "$API_PID" -o ppid= -o lstart= 2>/dev/null) || return 1
  read -r parent rest <<< "$actual"
  [ "$parent" = "$API_OWNER_PID" ] && [ -n "$API_START_ID" ] && [ "$actual" = "$API_START_ID" ]
}

workbench_stop_started_child() {
  if ! kill -0 "$API_PID" 2>/dev/null; then wait "$API_PID" 2>/dev/null || true; return 0; fi
  workbench_child_matches || { echo 'WORKBENCH_CHILD_STOP_IDENTITY_UNKNOWN' >&2; return 1; }
  kill -TERM "$API_PID" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 "$API_PID" 2>/dev/null || { wait "$API_PID" 2>/dev/null || true; return 0; }
    sleep 0.1
  done
  workbench_child_matches || { echo 'WORKBENCH_CHILD_STOP_IDENTITY_UNKNOWN' >&2; return 1; }
  kill -KILL "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
}

start_api() {
  local port="$1" log="$2" up=0 deadline remaining request_budget
  # Check only the port this child uses; allocation separately checks the pair.
  # 上一段刚停止 API 时，runner 可能尚未释放 0.0.0.0/:: socket；最多等 2s。
  # 外来进程持续占用仍硬失败，绝不杀端口上的未知进程。
  workbench_wait_port_available "$port" || fail "端口 $port 等待 2s 后仍被占用/无法核验"
  API_OWNER_PID=${BASHPID:-$$}
  PORT="$port" node apps/api/dist/index.js > "$log" 2>&1 &
  API_PID=$!
  API_START_ID=$(ps -p "$API_PID" -o ppid= -o lstart= 2>/dev/null) || API_START_ID=''
  deadline=$((SECONDS+40))
  for _ in $(seq 1 40); do
    remaining=$((deadline-SECONDS)); [ "$remaining" -gt 0 ] || break
    request_budget=$remaining; [ "$request_budget" -le 2 ] || request_budget=2
    workbench_child_matches || break
    grep -q 'EADDRINUSE' "$log" && break
    if grep -Fq "Works Management API + Agent WS running on port $port" "$log" && curl --max-time "$request_budget" -sf "http://localhost:$port/api/health" >/dev/null 2>&1; then
      workbench_child_matches || break
      [ "$SECONDS" -lt "$deadline" ] || break
      up=1; break
    fi
    workbench_child_matches || break
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep 1
  done
  if [ "$up" != 1 ]; then
    tail -30 "$log" >&2
    workbench_stop_started_child || echo 'WORKBENCH_CHILD_CLEANUP_UNVERIFIED' >&2
    fail "apps/api 未在 40s 内就绪（端口 ${port}）"
  fi
}
