---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 1: kuaishou-publish.ts handler 重写 + unit tests

**范围**: 重写 `kuaishou-publish.ts`，提取 `resolveKuaishouScriptPath(type, env)` 函数（image/video type 路由，未知 type 显式抛 Error 含 'no script for type'），加 `ZENITHJOY_AGENT_REAL_PUBLISH` 环境变量开关（默认 dryrun），新建 `services/agent/src/handlers/__tests__/kuaishou-publish.test.ts` 覆盖所有 type 路由路径
**大小**: M（~150 行，两文件）
**依赖**: 无

> **测试路径说明**：`sprints/tests/ws1/` = Proposer TDD 红绿测试（已存在）；`services/agent/src/handlers/__tests__/` = Generator 在 WS1 中新建的 unit test（WS1 产物）

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/src/handlers/kuaishou-publish.ts` 包含 `resolveKuaishouScriptPath` 导出函数
  Test: node -e "const c=require('fs').readFileSync('/workspace/services/agent/src/handlers/kuaishou-publish.ts','utf8');if(!c.includes('resolveKuaishouScriptPath'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `services/agent/src/handlers/__tests__/kuaishou-publish.test.ts` 文件存在，覆盖 type 路由测试
  Test: node -e "const c=require('fs').readFileSync('/workspace/services/agent/src/handlers/__tests__/kuaishou-publish.test.ts','utf8');if(!c.includes('resolveKuaishouScriptPath'))process.exit(1);if(!c.includes('image'))process.exit(1);if(!c.includes('video'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] handler 含 `resolveKuaishouScriptPath` 函数且按 type 路由 image 脚本
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/src/handlers/kuaishou-publish.ts'"'"','"'"'utf8'"'"');if(!c.includes('"'"'resolveKuaishouScriptPath'"'"')){console.error('"'"'FAIL: 缺 resolveKuaishouScriptPath'"'"');process.exit(1);}if(!c.includes('"'"'kuaishou-image'"'"')){console.error('"'"'FAIL: 缺 image 路由'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] handler 含 video type 路由逻辑（kuaishou-video 关键字）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/src/handlers/kuaishou-publish.ts'"'"','"'"'utf8'"'"');if(!c.includes('"'"'kuaishou-video'"'"')){console.error('"'"'FAIL: 缺 video 路由'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] handler 含未知 type 显式抛错逻辑（no script for type）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/src/handlers/kuaishou-publish.ts'"'"','"'"'utf8'"'"');if(!c.includes('"'"'no script for type'"'"')){console.error('"'"'FAIL: 缺未知 type 抛错'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] handler 含 ZENITHJOY_AGENT_REAL_PUBLISH 环境变量开关
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/src/handlers/kuaishou-publish.ts'"'"','"'"'utf8'"'"');if(!c.includes('"'"'ZENITHJOY_AGENT_REAL_PUBLISH'"'"')){console.error('"'"'FAIL: 缺 REAL_PUBLISH 开关'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] TDD vitest 测试全 PASS（防字符串注释绕过 — 比 readFileSync 更强的 machineability gate）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/tests/ws1/kuaishou-publish.test.ts --reporter=verbose 2>&1 | tail -15; [ ${PIPESTATUS[0]} -eq 0 ] || exit 1'
  期望: 所有 test cases PASS（WS1 实现后 vitest 为 Green）

- [ ] [BEHAVIOR] unit test 文件覆盖 type 路由（image + video + 未知 type 三条路径）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/src/handlers/__tests__/kuaishou-publish.test.ts'"'"','"'"'utf8'"'"');if(!c.includes('"'"'image'"'"')||!c.includes('"'"'video'"'"')||!c.includes('"'"'no script for type'"'"')){console.error('"'"'FAIL: 测试缺覆盖'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

> **假绿自查**：WS1 未实现时，旧 `kuaishou-publish.ts` 不含 `resolveKuaishouScriptPath` 字符串 → BEHAVIOR 1/2/3/4 均 exit 1 → 真红 ✅。`kuaishou-publish.test.ts`（handler __tests__）不存在 → ENOENT → exit 1 ✅。vitest BEHAVIOR：旧文件不含 resolveKuaishouScriptPath → vitest 断言 `toContain` 失败 → exit 1 → 真红 ✅（不可被注释绕过）。
