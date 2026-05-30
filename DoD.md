contract_branch: cp-harness-propose-r2-74b485f3
---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: Lane0 小红书 QR Bind Session 存储

**范围**: 修复 qr-bind-operator.ts/.cjs 的 xiaohongshu cookie 名 + CDP 端口注入
**大小**: S（< 30 行改动）

## ARTIFACT 条目

- [ ] [ARTIFACT] services/agent/src/handlers/qr-bind-operator.ts 含 `galaxy_creator_session_info`
  Test: node -e "const s=require('fs').readFileSync('services/agent/src/handlers/qr-bind-operator.ts','utf8');if(!s.includes('galaxy_creator_session_info'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] services/agent/publishers/qr-bind-operator.cjs 含 `galaxy_creator_session_info`
  Test: node -e "const s=require('fs').readFileSync('services/agent/publishers/qr-bind-operator.cjs','utf8');if(!s.includes('galaxy_creator_session_info'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] sprints/line00-xiaohongshu-qr-bind/tests/ws1/xhs-qr-bind.test.ts 存在且含 xiaohongshu 断言
  Test: node -e "const s=require('fs').readFileSync('sprints/line00-xiaohongshu-qr-bind/tests/ws1/xhs-qr-bind.test.ts','utf8');if(!s.includes('galaxy_creator_session_info'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] .ts xiaohongshu cookie 行：含 galaxy_creator_session_info，不含 webId
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-operator.ts\",\"utf8\");const l=s.split(\"\n\").find(x=>x.includes(\"xiaohongshu\")&&x.includes(\"web_session\"));if(!l||l.includes(\"webId\")||!l.includes(\"galaxy_creator_session_info\")){console.error(\"FAIL\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] .cjs xiaohongshu cookie 行：含 galaxy_creator_session_info，不含 webId
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"services/agent/publishers/qr-bind-operator.cjs\",\"utf8\");const l=s.split(\"\n\").find(x=>x.includes(\"xiaohongshu\")&&x.includes(\"web_session\"));if(!l||l.includes(\"webId\")||!l.includes(\"galaxy_creator_session_info\")){console.error(\"FAIL\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] .ts 含 ZENITHJOY_CHROME_DEBUG_PORT 注入 + 19224 端口值
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-operator.ts\",\"utf8\");if(!s.includes(\"19224\")||!s.includes(\"ZENITHJOY_CHROME_DEBUG_PORT\")){console.error(\"FAIL\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 小红书新单元测试全绿（xhs-qr-bind.test.ts ≥ 3 个测试通过）
  Test: manual:bash -c 'npx vitest run sprints/line00-xiaohongshu-qr-bind/tests/ws1/xhs-qr-bind.test.ts --reporter=verbose 2>&1; exit $?'
  期望: exit 0

- [ ] [BEHAVIOR] 现有 qr-bind-operator 测试回归通过
  Test: manual:bash -c 'cd /Users/administrator/perfect21/zenithjoy && npx vitest run services/agent/src/handlers/__tests__/qr-bind-operator.test.ts --reporter=verbose 2>&1; exit $?'
  期望: exit 0

- [ ] [BEHAVIOR] error path — 不支持的平台返回 ok:false（回归防护）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-operator.ts\",\"utf8\");if(!s.includes(\"不支持的平台\")){console.error(\"FAIL\");process.exit(1)}console.log(\"OK\")"'
  期望: OK
