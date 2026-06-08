---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Sprint: Agent 模块化架构 E2E 验证

**范围**: `.github/workflows/agent-module-e2e.yml`（新增）+ `agent-module-e2e-smoke.sh`（新增）+ `services/agent/modules/line04/preflight.ts`（MOCK_WECHAT_VERSION 支持）+ `services/agent/vitest.config.ts`（加入 sprint test 路径）
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `.github/workflows/agent-module-e2e.yml` 存在，含 windows-latest job + xian-rog wechat-capable job
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/agent-module-e2e.yml','utf8');if(!c.includes('windows-latest'))process.exit(1);if(!c.includes('wechat-capable'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/agent-module-e2e-smoke.sh` 存在，包含实质 curl 内容
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/agent-module-e2e-smoke.sh','utf8');const lines=c.split('\n').filter(l=>l.trim()&&!l.startsWith('#'));if(lines.length<5){process.exit(1);}if(!c.includes('curl'))process.exit(1);console.log('OK lines='+lines.length)"

- [ ] [ARTIFACT] `services/agent/modules/line04/preflight.ts` 内 `checkWechatVersion()` 含 `MOCK_WECHAT_VERSION` env 读取逻辑
  Test: node -e "const c=require('fs').readFileSync('services/agent/modules/line04/preflight.ts','utf8');if(!c.includes('MOCK_WECHAT_VERSION'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] preflight 非 Windows 输出合法 JSON，ok:true，含 checks，无 fixGuide（schema 字段验证）
  Test: manual:bash -c 'cd services/agent && npm ci --prefer-offline 2>/dev/null | tail -1; OUT=$(npx tsx modules/line04/preflight.ts 2>/dev/null); echo "$OUT" | jq -e ".ok == true" || { echo "FAIL: ok 非 true（非 Windows 应跳过所有检测）"; exit 1; }; echo "$OUT" | jq -e "has(\"checks\")" || { echo "FAIL: 缺 checks 字段"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] MOCK_WECHAT_VERSION=4.2.0.0 → exit 1，ok:false，fixGuide 含 WeChatWin_4.1.8.exe（error path）
  Test: manual:bash -c 'cd services/agent && MOCK_WECHAT_VERSION=4.2.0.0 npx tsx modules/line04/preflight.ts > /tmp/pf-mock.json 2>/dev/null; CODE=$?; [ "$CODE" -eq 1 ] || { echo "FAIL: exit $CODE 应为 1"; exit 1; }; cat /tmp/pf-mock.json | jq -e ".ok == false" || { echo "FAIL: ok 应为 false"; exit 1; }; cat /tmp/pf-mock.json | jq -e ".fixGuide | contains(\"WeChatWin_4.1.8.exe\")" || { echo "FAIL: fixGuide 缺 COS URL"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] MOCK 输出 fixGuide 字段类型为 string（schema 字段类型）
  Test: manual:bash -c 'cd services/agent && MOCK_WECHAT_VERSION=4.2.0.0 npx tsx modules/line04/preflight.ts > /tmp/pf-t.json 2>/dev/null; cat /tmp/pf-t.json | jq -e ".fixGuide | type == \"string\"" || { echo "FAIL: fixGuide 非 string"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] ok:true 时 fixGuide 字段不出现（禁用字段反向检查）
  Test: manual:bash -c 'cd services/agent && OUT=$(npx tsx modules/line04/preflight.ts 2>/dev/null); echo "$OUT" | jq -e "has(\"fixGuide\") | not" || { echo "FAIL: ok:true 时 fixGuide 不应出现"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] workflow 文件含正确的两个 runner 声明（CI 结构完整性）
  Test: manual:bash -c 'grep -q "windows-latest" .github/workflows/agent-module-e2e.yml || { echo "FAIL: 缺 windows-latest job"; exit 1; }; grep -q "wechat-capable" .github/workflows/agent-module-e2e.yml || { echo "FAIL: 缺 xian-rog wechat-capable runner"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] smoke 脚本存在且含实质 curl 调用（非 exit 0 占位）
  Test: manual:bash -c 'LINES=$(grep -v "^#" .github/workflows/scripts/smoke/agent-module-e2e-smoke.sh | grep -v "^[[:space:]]*$" | wc -l); [ "$LINES" -ge 5 ] || { echo "FAIL: smoke 实质内容仅 $LINES 行（需≥5）"; exit 1; }; grep -q "curl" .github/workflows/scripts/smoke/agent-module-e2e-smoke.sh || { echo "FAIL: smoke 无 curl 命令"; exit 1; }; echo OK'
  期望: OK
