#!/usr/bin/env bash
# Run on hk-vps (the only allowed client). No credentials, no paid submissions.
set -euo pipefail
RELAY=${ALI_VIDEO_HTTPS_PROXY:-http://100.69.180.117:18241}
probe() {
  local url=$1 expected=$2 code
  code=$(curl --silent --show-error --noproxy '' --proxy "$RELAY" \
    --connect-timeout 10 --max-time 20 --output /dev/null --write-out '%{http_code}' "$url")
  [[ "$code" == "$expected" ]] || { echo "Unexpected relay HTTP status: $code (expected $expected)" >&2; return 1; }
}
probe https://dashscope.aliyuncs.com/api/v1/tasks/video-tools-connectivity-probe 401
probe https://videoenhan.cn-shanghai.aliyuncs.com/ 400
probe https://viapiutils.cn-shanghai.aliyuncs.com/ 404
# CONNECT to an unrelated destination or port must fail at the relay.
for url in https://example.com/ https://dashscope.aliyuncs.com:8443/; do
  set +e
  output=$(curl --silent --show-error --noproxy '' --proxy "$RELAY" \
    --connect-timeout 5 --max-time 10 --output /dev/null "$url" 2>&1)
  status=$?
  set -e
  [[ "$status" != 0 && ( "$output" == *'CONNECT tunnel failed, response 403'* || "$output" == *'HTTP code 403 from proxy after CONNECT'* ) ]] || { echo 'Relay destination restriction failed' >&2; exit 1; }
done
probe http://dashscope.aliyuncs.com/ 403
echo 'Video API relay: official endpoints reachable; unrelated hosts and ports rejected'
