#!/usr/bin/env bash
# require-core-2023-smoke.sh
# 中台兜底 required core 必须 >= 2.0.23（含 #826 module-manager→模块 config IPC 的 machineId
# 透传）。真客户机自升 2.0.23 后 listen_chat 直接拿 machineId 拉每客服配置，不再靠手设 env。
# 无网络/无 DB，CI 任意环境可跑（纯 node 解析源码断言）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SVC="$ROOT/apps/api/src/services/walking-skeleton.service.ts"
RTE="$ROOT/apps/api/src/routes/walking-skeleton.ts"

echo "── ① 兜底常量 DEFAULT_REQUIRED_AGENT_VERSION >= 2.0.23 ──"
DEF=$(grep -oE "DEFAULT_REQUIRED_AGENT_VERSION = '[0-9]+\.[0-9]+\.[0-9]+'" "$SVC" | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
node -e "const v='$DEF'.split('.').map(Number);const c=v[0]*1e6+v[1]*1e3+v[2];if(!('$DEF'.length)||c<2*1e6+23){console.error('FAIL: DEFAULT_REQUIRED_AGENT_VERSION='+'$DEF'+' < 2.0.23（machineId IPC 在 2.0.23）');process.exit(1)}console.log('  PASS: 兜底常量 '+'$DEF'+' >= 2.0.23')"

echo "── ② 心跳响应真挂 required_agent_version（单一来源 getRequiredAgentVersion）──"
node -e "const fs=require('fs');const s=fs.readFileSync('$RTE','utf8');if(!/required_agent_version: getRequiredAgentVersion\(\)/.test(s)){console.error('FAIL: 心跳未下发 required_agent_version');process.exit(1)}console.log('  PASS: 心跳下发 getRequiredAgentVersion()')"

echo "✅ require-core-2023 smoke 全过：客户机收到 required>=2.0.23 → 按约定下 COS 包自升 → machineId 自动透传"
