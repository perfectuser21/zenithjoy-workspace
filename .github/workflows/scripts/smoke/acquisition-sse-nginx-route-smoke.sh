#!/usr/bin/env bash
# acquisition-sse-nginx-route-smoke.sh
#
# Bug: Agent 连的 SSE URL 是 /api/acquisition/agent/task-stream，
# 但 nginx 里专属 SSE location 的正则是 ^/api/acquisition/collect/[^/]+/sse$，
# 结构不匹配 → 落入通用 /api/ 兜底 location（30秒超时，无 proxy_buffering off）
# → SSE 长连接每 ~30 秒被 nginx 掐断，Stage 2 采集指令永远推不到 Agent。
#
# 本脚本静态解析 nginx 配置文件，断言 /api/acquisition/agent/task-stream
# 这条路径有一个专属 location 命中（proxy_buffering off + read/send timeout >= 3600s），
# 而不是落进通用 /api/ 兜底。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
FAIL=0

check_config() {
  local conf_file="$1"
  local label="$2"

  if [ ! -f "$conf_file" ]; then
    echo "❌ [$label] 配置文件不存在: $conf_file"
    FAIL=1
    return
  fi

  # 用 node 精确模拟 nginx 的 regex location 匹配（无需真的起 nginx）：
  # 抽取所有 `location ~ <regex> { ... }` 块，找第一个匹配 /api/acquisition/agent/task-stream 的块，
  # 断言该块含 proxy_buffering off 且 read/send timeout >= 3600s。
  node -e "
    const fs = require('fs');
    const conf = fs.readFileSync('$conf_file', 'utf-8');
    const targetPath = '/api/acquisition/agent/task-stream';

    const blocks = [];
    const re = /location\s*~\s*(\S+)\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(conf)) !== null) {
      blocks.push({ pattern: m[1], body: m[2] });
    }

    let matched = null;
    for (const b of blocks) {
      try {
        const regex = new RegExp(b.pattern);
        if (regex.test(targetPath)) {
          matched = b;
          break;
        }
      } catch (e) {
        // 忽略无法解析的正则
      }
    }

    if (!matched) {
      console.error('❌ [$label] 没有任何专属 SSE regex location 匹配 ' + targetPath + '（会落进通用 /api/ 兜底，30秒超时）');
      process.exit(1);
    }

    const hasBuffering = /proxy_buffering\s+off/.test(matched.body);
    const readMatch = matched.body.match(/proxy_read_timeout\s+(\d+)s?/);
    const sendMatch = matched.body.match(/proxy_send_timeout\s+(\d+)s?/);
    const readTimeout = readMatch ? parseInt(readMatch[1], 10) : 0;
    const sendTimeout = sendMatch ? parseInt(sendMatch[1], 10) : 0;

    if (!hasBuffering) {
      console.error('❌ [$label] 匹配到的 location 缺少 proxy_buffering off: ' + matched.pattern);
      process.exit(1);
    }
    if (readTimeout < 3600 || sendTimeout < 3600) {
      console.error('❌ [$label] 匹配到的 location 超时不足 3600s (read=' + readTimeout + ' send=' + sendTimeout + '): ' + matched.pattern);
      process.exit(1);
    }

    console.log('✅ [$label] ' + targetPath + ' 命中 SSE 专属 location: ' + matched.pattern + ' (buffering off, timeout ' + readTimeout + 's)');
  " || FAIL=1
}

echo "=== acquisition-sse-nginx-route-smoke ==="
check_config "$REPO_ROOT/deploy/nginx.staging.conf" "staging"
check_config "$REPO_ROOT/deploy/nginx.conf" "production"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "FAILED"
  exit 1
fi

echo ""
echo "=== acquisition-sse-nginx-route-smoke PASSED ==="
