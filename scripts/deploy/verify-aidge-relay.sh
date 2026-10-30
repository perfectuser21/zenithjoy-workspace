#!/usr/bin/env bash
set -euo pipefail
code=$(curl --silent --show-error --noproxy '*' \
  --resolve aidge.cn-beijing.aliyuncs.com:18443:100.79.41.61 \
  --head --connect-timeout 10 --max-time 25 \
  --output /dev/null --write-out '%{http_code}' \
  https://aidge.cn-beijing.aliyuncs.com:18443/)
[[ "$code" == 200 ]] || { echo "Aidge relay endpoint returned $code" >&2; exit 1; }
echo 'Aidge TLS relay: Beijing endpoint reachable with valid certificate'
