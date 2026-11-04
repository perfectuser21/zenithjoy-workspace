#!/usr/bin/env bash
# Commander 起 codex_agent 形态 workflow（任务 c0fe7e30；决策 2186700a / 26df670a）回归：
# 本入口只守固定技能源恢复与生成合同一致性。执行器、收尾、反自报、
# lease、部署准备的行为回归由 required L3 的 phone __tests__/*.test.mjs 跑一次。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
# 对象缓存不是生成文档；先按固定中央源安装并核验，再运行原完整回归。
node scripts/ci/implementation-skill-source.mjs --install-regression-skills "$REPO_ROOT"
node scripts/product-map/gen-commander-contracts.mjs --check
node --test scripts/product-map/__tests__/commander-skill-contracts.test.js
bash -n services/phone-adb-controller/commander/wf-agent-run.sh
python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' services/phone-adb-controller/commander/wf-agent-lib.py
echo "commander-codex-agent-smoke: pinned-source/bootstrap contract PASS; execution regressions run in required L3"
