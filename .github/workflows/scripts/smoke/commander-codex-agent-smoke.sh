#!/usr/bin/env bash
# Commander 起 codex_agent 形态 workflow（任务 c0fe7e30；决策 2186700a / 26df670a）回归：
# 合同 commander_skill 字段与 Commander 运行时合同清单一致；wf-launch 分形态；wf-agent-run 外壳准备/收尾（trap 放锁）、
# 系统读回覆盖自报、五活动读回证据。只用假 ssh/openclaw/curl，不连手机、不连 Brain。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
node scripts/product-map/gen-commander-contracts.mjs --check
node --test scripts/product-map/__tests__/commander-skill-contracts.test.js
node --test services/phone-adb-controller/__tests__/commander-report.test.mjs services/phone-adb-controller/__tests__/commander-v2.test.mjs services/phone-adb-controller/__tests__/commander-codex-agent.test.mjs services/phone-adb-controller/__tests__/commander-handoff.test.mjs
bash -n services/phone-adb-controller/commander/wf-agent-run.sh
python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' services/phone-adb-controller/commander/wf-agent-lib.py
echo "commander-codex-agent-smoke: PASS"
