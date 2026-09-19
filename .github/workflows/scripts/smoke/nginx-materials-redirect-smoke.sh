#!/usr/bin/env bash
# nginx-materials-redirect-smoke.sh
#
# Regression guard for: GET /api/materials（listMaterials() 发的、不带尾斜杠）
# 命中 location /api/materials/（带尾斜杠）触发 nginx 自动 301 补斜杠，
# Location 头 scheme 降级为 http（该 nginx 层只 listen 80，不知道外层是 https），
# 浏览器当 mixed content 拦截，axios 端表现为无信息量的 "Network Error"。
#
# 这是环境接缝守卫（真实 nginx 容器加载真实配置文件），不是逻辑单测——
# 纯配置文件语法检查测不出这种"匹配到了但重定向"的运行时行为。
set -euo pipefail

CONF_FILE="${1:-deploy/nginx.staging.conf}"
CONTAINER_NAME="nginx-materials-redirect-smoke-$$"
TEST_PORT=18099
DUMMY_UPSTREAM_PORT=19998

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

WORKDIR="$(mktemp -d)"
# proxy_pass 目标换成一个必然拒绝连接的本机端口——只关心 nginx 自己是否重定向，
# 不依赖真实后端是否存活。
sed -E 's#http://[a-zA-Z0-9_.-]+:5200#http://host.docker.internal:'"$DUMMY_UPSTREAM_PORT"'#g' \
  "$CONF_FILE" > "$WORKDIR/default.conf"

docker run -d --name "$CONTAINER_NAME" \
  -p "${TEST_PORT}:80" \
  --add-host=host.docker.internal:host-gateway \
  -v "$WORKDIR/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:1.27-alpine >/dev/null

# 等 nginx 真正起来（轮询而非固定 sleep）
for _ in $(seq 1 20); do
  if curl -s -o /dev/null "http://localhost:${TEST_PORT}/" 2>/dev/null; then break; fi
  sleep 0.5
done

FAIL=0

check_no_http_redirect() {
  local path="$1"
  local status location
  status="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${TEST_PORT}${path}")"
  location="$(curl -sI "http://localhost:${TEST_PORT}${path}" | grep -i '^location:' || true)"

  if [[ "$status" == 3* ]] && [[ "$location" == *"http://"* ]]; then
    echo "❌ FAIL: GET ${path} 返回 ${status} 且 Location 降级为 http（${location}）——这正是浏览器 mixed-content 拦截、axios 报 Network Error 的根因"
    FAIL=1
    return
  fi
  echo "✅ OK: GET ${path} -> ${status}（无 http 降级重定向）"
}

check_no_http_redirect "/api/materials"
check_no_http_redirect "/api/materials/"
check_no_http_redirect "/api/materials/some-id"

exit "$FAIL"
