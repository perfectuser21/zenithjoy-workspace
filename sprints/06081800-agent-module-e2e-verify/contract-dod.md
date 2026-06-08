---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Sprint: Agent 模块化架构 E2E 验证（Round 3）

**范围**: `.github/workflows/agent-module-e2e.yml`（新增）+ `agent-module-e2e-smoke.sh`（新增）+ `services/agent/modules/line04/preflight.ts`（MOCK_WECHAT_VERSION 支持 + version-only warning 路径）+ `services/agent/vitest.config.ts`（加入 sprint test 路径）
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `.github/workflows/agent-module-e2e.yml` 存在，含 windows-latest job + xian-rog wechat-capable job
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/agent-module-e2e.yml','utf8');if(!c.includes('windows-latest'))process.exit(1);if(!c.includes('wechat-capable'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/agent-module-e2e-smoke.sh` 存在，包含实质 curl 内容且覆盖 module-health 端点
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/agent-module-e2e-smoke.sh','utf8');const lines=c.split('\n').filter(l=>l.trim()&&!l.startsWith('#'));if(lines.length<5){process.exit(1);}if(!c.includes('curl'))process.exit(1);if(!c.includes('module-health'))process.exit(1);console.log('OK lines='+lines.length)"

- [ ] [ARTIFACT] `services/agent/modules/line04/preflight.ts` 内含 `MOCK_WECHAT_VERSION` env 读取逻辑 + version-only warning 路径（ok:true 当仅 wechat_version 失败）
  Test: node -e "const c=require('fs').readFileSync('services/agent/modules/line04/preflight.ts','utf8');if(!c.includes('MOCK_WECHAT_VERSION'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] preflight 非 Windows 输出合法 JSON：ok:true，含 checks，无 fixGuide，无 skipped（schema 字段 + 禁用字段反向检查）
  Test: manual:bash -c 'cd services/agent && npm ci --prefer-offline 2>/dev/null | tail -1; OUT=$(npx tsx modules/line04/preflight.ts 2>/dev/null); echo "$OUT" | jq -e ".ok == true" || { echo "FAIL: ok 非 true"; exit 1; }; echo "$OUT" | jq -e "has(\"checks\")" || { echo "FAIL: 缺 checks 字段"; exit 1; }; echo "$OUT" | jq -e "has(\"fixGuide\") | not" || { echo "FAIL: ok:true 时 fixGuide 不应出现"; exit 1; }; echo "$OUT" | jq -e "has(\"skipped\") | not" || { echo "FAIL: 顶层输出含 skipped（CheckOutcome 内部字段泄漏）"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] MOCK_WECHAT_VERSION=4.2.0.0 → version-only warning：exit 0，ok:true，checks.wechat_version:false，无 fixGuide，无 skipped（PRD 边界情况：version 类失败只告警不判红）
  Test: manual:bash -c 'cd services/agent && MOCK_WECHAT_VERSION=4.2.0.0 npx tsx modules/line04/preflight.ts > /tmp/pf-mock.json 2>/dev/null; CODE=$?; [ "$CODE" -eq 0 ] || { echo "FAIL: exit $CODE 应为 0（version-only 告警不判红）"; exit 1; }; cat /tmp/pf-mock.json | jq -e ".ok == true" || { echo "FAIL: ok 应为 true（version-only warning）"; exit 1; }; cat /tmp/pf-mock.json | jq -e ".checks.wechat_version == false" || { echo "FAIL: checks.wechat_version 应为 false"; exit 1; }; cat /tmp/pf-mock.json | jq -e "has(\"fixGuide\") | not" || { echo "FAIL: version-only 路径不应有 fixGuide"; exit 1; }; cat /tmp/pf-mock.json | jq -e "has(\"skipped\") | not" || { echo "FAIL: 顶层输出不应含 skipped"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] MOCK 输出 checks 字段完整性（schema 字段类型 + keys 覆盖）
  Test: manual:bash -c 'cd services/agent && MOCK_WECHAT_VERSION=4.2.0.0 npx tsx modules/line04/preflight.ts > /tmp/pf-t.json 2>/dev/null; cat /tmp/pf-t.json | jq -e ".checks | type == \"object\"" || { echo "FAIL: checks 非 object"; exit 1; }; cat /tmp/pf-t.json | jq -e ".checks | has(\"wechat_version\")" || { echo "FAIL: checks 缺 wechat_version 字段"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] ok:true 时 fixGuide + skipped 均不出现（禁用字段反向检查 — 非 Windows 全通路径）
  Test: manual:bash -c 'cd services/agent && OUT=$(npx tsx modules/line04/preflight.ts 2>/dev/null); echo "$OUT" | jq -e "has(\"fixGuide\") | not" || { echo "FAIL: ok:true 时 fixGuide 不应出现"; exit 1; }; echo "$OUT" | jq -e "has(\"skipped\") | not" || { echo "FAIL: ok:true 时 skipped 不应出现"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] syncModules 收到 active module → downloadImpl 被调用恰好 1 次（PRD 场景A Step 2）
  Test: manual:bash -c 'cd services/agent && npm ci --prefer-offline 2>/dev/null | tail -1; npx tsx -e "import { ModuleManager } from \"./src/module-manager.js\"; import fs from \"node:fs\"; import os from \"node:os\"; const root = fs.mkdtempSync(os.tmpdir() + \"/zj-b5-\"); let called = 0; const mm = new ModuleManager({ modulesRoot: root, downloadImpl: async () => { called++; }, preflightImpl: async () => ({ ok: false, reason: \"skip\" }) }); await mm.syncModules({ \"line04-wechat-cs\": { status: \"active\", required_version: \"1.0.0\" } }); fs.rmSync(root, { recursive: true, force: true }); if (called !== 1) { console.error(\"FAIL: downloadImpl called \" + called + \" times\"); process.exit(1); } console.log(\"OK downloadImpl called once\");" 2>&1 || { echo "FAIL"; exit 1; }'
  期望: OK downloadImpl called once

- [ ] [BEHAVIOR] activateModule → forkImpl 被调用 + config 消息发送 + getActiveModules() 含 lineId（PRD 场景A Step 4）
  Test: manual:bash -c 'cd services/agent && npx tsx -e "import { ModuleManager } from \"./src/module-manager.js\"; import fs from \"node:fs\"; import path from \"node:path\"; import os from \"node:os\"; import { EventEmitter } from \"node:events\"; const root = fs.mkdtempSync(os.tmpdir() + \"/zj-b6-\"); const modDir = path.join(root, \"line04-wechat-cs-1.0.0\"); fs.mkdirSync(modDir, { recursive: true }); fs.writeFileSync(path.join(modDir, \"manifest.json\"), JSON.stringify({ lineId: \"line04-wechat-cs\", version: \"1.0.0\", entry: \"index.js\" })); let sentConfig = false; const fc = new EventEmitter(); fc.send = (m) => { if (m?.type === \"config\") sentConfig = true; }; const mm = new ModuleManager({ modulesRoot: root, forkImpl: () => fc }); const p = mm.activateModule(\"line04-wechat-cs\"); setTimeout(() => fc.emit(\"message\", { type: \"ready\" }), 50); await p; fs.rmSync(root, { recursive: true, force: true }); if (!sentConfig) { console.error(\"FAIL: config 未发送\"); process.exit(1); } if (!mm.getActiveModules().includes(\"line04-wechat-cs\")) { console.error(\"FAIL: 模块未进入 active\"); process.exit(1); } console.log(\"OK active\");" 2>&1 || { echo "FAIL"; exit 1; }'
  期望: OK active

- [ ] [BEHAVIOR] GET /api/agent/module-health data[0].module_status["line04-wechat-cs"].ok == true（PRD 场景A Step 5；需 API 可用）
  Test: manual:bash -c 'API_BASE="${API_BASE:-http://localhost:3000}"; curl -sf "$API_BASE/api/agent/health" > /dev/null 2>&1 || { echo "SKIP: API 未启动"; exit 0; }; curl -sf -X POST "$API_BASE/api/agent/heartbeat" -H "Content-Type: application/json" -d "{\"license\":\"test-lic\",\"version\":\"1.0.0\",\"hostname\":\"dod-check\",\"module_status\":{\"line04-wechat-cs\":{\"ok\":true}}}" | jq -e ".ok == true" || { echo "FAIL: 上报失败"; exit 1; }; H=$(curl -sf "$API_BASE/api/agent/module-health" -H "Authorization: Bearer test-lic") || { echo "FAIL: module-health 非 200"; exit 1; }; echo "$H" | jq -e ".ok == true" || { echo "FAIL: ok 非 true"; exit 1; }; echo "$H" | jq -e ".data | length >= 1" || { echo "FAIL: data 为空"; exit 1; }; echo "$H" | jq -e ".data[0].agent_id | type == \"string\"" || { echo "FAIL: agent_id 非 string"; exit 1; }; echo "$H" | jq -e ".data[0].module_status[\"line04-wechat-cs\"].ok == true" || { echo "FAIL: module_status 未持久化"; exit 1; }; echo OK'
  期望: OK（API 不可用时打印 SKIP，evaluator 视 SKIP 为通过）

- [ ] [BEHAVIOR] CI workflow 真正调用 smoke 脚本 + npx tsx + 两个 runner（ci_workflow_alignment）
  Test: manual:bash -c 'grep -q "windows-latest" .github/workflows/agent-module-e2e.yml || { echo "FAIL: 缺 windows-latest"; exit 1; }; grep -q "wechat-capable" .github/workflows/agent-module-e2e.yml || { echo "FAIL: 缺 wechat-capable"; exit 1; }; grep -q "agent-module-e2e-smoke.sh" .github/workflows/agent-module-e2e.yml || { echo "FAIL: workflow 未调用 smoke 脚本"; exit 1; }; grep -q "npx tsx" .github/workflows/agent-module-e2e.yml || { echo "FAIL: windows-latest job 缺 npx tsx 调用"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] smoke 脚本存在，≥5 行实质内容，含 curl 调用，含 module-health（非 exit 0 占位）
  Test: manual:bash -c 'LINES=$(grep -v "^#" .github/workflows/scripts/smoke/agent-module-e2e-smoke.sh | grep -v "^[[:space:]]*$" | wc -l); [ "$LINES" -ge 5 ] || { echo "FAIL: smoke 实质内容仅 $LINES 行（需≥5）"; exit 1; }; grep -q "curl" .github/workflows/scripts/smoke/agent-module-e2e-smoke.sh || { echo "FAIL: smoke 无 curl 命令"; exit 1; }; grep -q "module-health" .github/workflows/scripts/smoke/agent-module-e2e-smoke.sh || { echo "FAIL: smoke 未覆盖 module-health"; exit 1; }; echo OK'
  期望: OK
