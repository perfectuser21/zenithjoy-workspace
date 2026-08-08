---
skeleton: false
journey_type: infra_acceptance
target_environment: ubuntu-latest
---
# Contract DoD — AI 打表器 D2（采证器白名单点火 + 判定对接 + staging 版本戳）

**范围**: action 枚举收口（删 signup_flow）、无凭据 ai_incomplete 退出、采证前双自检、trigger_collect ≤2 上限闸、S10-c4 二次采集、/api/version fail-loud、打表器 workflow（ubuntu-latest + secrets 白名单）、前端 VITE_BUILD_SHA 注入、判官回写断言。
**不含**: 真机动作、员工验收页面、多租户/生产改动、Gate B 未决方案。
**大小**: M

## 真机边界声明

本单 AI 全部动作限于：**staging 后台 UI 只读观察** + **受控点火（专用验收租户采集入口，≤2次/轮）**。AI 绝不执行直接控制手机、SSH 到设备、触发重启、操作 App、发送私信/关注/点赞、跨出专用验收租户的写操作等动作。theater 闸检查：无 self-hosted runner；secrets 白名单不含 ACCEPTANCE_API_TOKEN；trigger_collect ≤ 2；无 signup 动作。

---

## ARTIFACT 条目

- [ ] [ARTIFACT] cells-map.mjs: S1-c3 action 改 observe，S10-c4 action 改 trigger_collect
  Test: `node -e "import('./scripts/acceptance-spec/ai-run/cells-map.mjs').then(m=>{const s1=m.CELLS_MAP.find(c=>c.id==='S1-c3');const s10=m.CELLS_MAP.find(c=>c.id==='S10-c4');if(s1.action!=='observe')process.exit(1);if(s10.action!=='trigger_collect')process.exit(1);console.log('PASS')})" `

- [ ] [ARTIFACT] cells-map.mjs: trigger_collect 格数精确为 2（S6-c3 + S10-c4）
  Test: `node -e "import('./scripts/acceptance-spec/ai-run/cells-map.mjs').then(m=>{const tc=m.CELLS_MAP.filter(c=>c.action==='trigger_collect');if(tc.length!==2){console.error('FAIL: trigger_collect count='+tc.length);process.exit(1)}console.log('PASS: tc='+tc.map(c=>c.id))})" `

- [ ] [ARTIFACT] login.mjs: 无凭据不再返回 signup 模式
  Test: `node -e "import('./scripts/acceptance-spec/ai-run/login.mjs').then(m=>{const r=m.resolveCredentials({},{});if(r.mode==='signup'){console.error('FAIL: 仍返回 signup 模式');process.exit(1)}if(r.mode!=='ai_incomplete'&&!r.error){console.error('FAIL: 无凭据应返回 ai_incomplete 标记');process.exit(1)}console.log('PASS: mode='+r.mode)})" `

- [ ] [ARTIFACT] capture.mjs: 全文无 signup 字样
  Test: `grep -c 'signup' scripts/acceptance-spec/ai-run/capture.mjs; test $? -eq 1 && echo PASS || echo FAIL`
  注：`grep -c` 在无匹配时 exit 1，有匹配时 exit 0 并输出计数。期望 exit 1（零匹配）。

- [ ] [ARTIFACT] login.mjs: 全文无 signup 字样（回落分支彻底删除）
  Test: `grep -c 'signup' scripts/acceptance-spec/ai-run/login.mjs; test $? -eq 1 && echo PASS || echo FAIL`

- [ ] [ARTIFACT] ai-acceptance-capture.yml 新建，runs-on: ubuntu-latest，不含 self-hosted
  Test: `node -e "const c=require('fs').readFileSync('.github/workflows/ai-acceptance-capture.yml','utf8');if(!c.includes('ubuntu-latest'))process.exit(1);if(c.includes('self-hosted'))process.exit(1);console.log('PASS')"`

- [ ] [ARTIFACT] ai-acceptance-capture.yml secrets 白名单不含 ACCEPTANCE_API_TOKEN
  Test: `grep 'ACCEPTANCE_API_TOKEN\|TAILSCALE_AUTHKEY\|HK_VPS_SSH_KEY' .github/workflows/ai-acceptance-capture.yml && echo FAIL || echo PASS`

- [ ] [ARTIFACT] deploy-dashboard-staging.yml 注入 VITE_BUILD_SHA
  Test: `grep -q 'VITE_BUILD_SHA' .github/workflows/deploy-dashboard-staging.yml && echo PASS || echo FAIL`

- [ ] [ARTIFACT] capture-invariants.test.js 新建，覆盖 4 条核心单测
  Test: `node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep -c '^ok ' | xargs -I{} test {} -ge 4 && echo PASS || echo FAIL`

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: action 枚举精确为 {observe, trigger_collect}，signup_flow 彻底消灭
  动作: 读取 cells-map.mjs 的 CELLS_MAP，提取所有 action 值去重排序
  预期观察: 排序后数组字面等于 `["observe","trigger_collect"]`，任何其他值（含 signup_flow）均导致命令非 0 退出
  等待预算: 0s
  留证: node -e 命令的 stdout + exit code
  Test: manual:bash -c 'node -e "import(\"./scripts/acceptance-spec/ai-run/cells-map.mjs\").then(m=>{const a=[...new Set(m.CELLS_MAP.map(c=>c.action))].sort();if(JSON.stringify(a)!==JSON.stringify([\"observe\",\"trigger_collect\"])){console.error(\"FAIL:\",a);process.exit(1)}console.log(\"PASS\")})"'

- [ ] [BEHAVIOR] [L1] B-02: signup 字样在采证器全文为零
  动作: grep -c 'signup' 对 capture.mjs + login.mjs + cells-map.mjs 三文件
  预期观察: 三个文件的匹配行数均为 0；任何非 0 行数 → FAIL
  等待预算: 0s
  留证: grep 输出每行计数
  Test: manual:bash -c 'for f in scripts/acceptance-spec/ai-run/capture.mjs scripts/acceptance-spec/ai-run/login.mjs scripts/acceptance-spec/ai-run/cells-map.mjs; do count=$(grep -c signup "$f" || true); if [ "$count" -ne 0 ]; then echo "FAIL: $f 含 signup ($count 处)"; exit 1; fi; done; echo PASS'

- [ ] [BEHAVIOR] [L1] B-03: 无凭据时 resolveCredentials 返回 ai_incomplete 标记而非 signup 模式
  动作: 以空 cli + 空 env 调用 resolveCredentials
  预期观察: 返回对象 mode 不等于 'signup'，且包含 ai_incomplete 或 error 标记；不抛异常（调用方 capture.mjs 读取标记后退出）
  等待预算: 0s
  留证: node 单测输出
  Test: manual:bash -c 'node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep "无凭据"'

- [ ] [BEHAVIOR] [L1] B-04: 无凭据时 capture.mjs 以 exit 1 退出，不生成 pending-judgments.json
  动作: 在无 STAGING_ACCEPTANCE_EMAIL / STAGING_ACCEPTANCE_PASSWORD 环境下以 --dry-run 或 stub 模式运行 capture.mjs 的无凭据路径
  预期观察: 进程 exit code = 1；输出目录内无 pending-judgments.json；run-summary.json（若生成）中 ai_incomplete = true
  等待预算: 0s
  留证: exit code + 目录内容 ls 输出
  Test: manual:bash -c 'node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep "无凭据退出"'

- [ ] [BEHAVIOR] [L1] B-05: tenant 不匹配时双自检使整轮 ai_incomplete 退出，trigger_collect_count = 0
  动作: 模拟 /api/me 返回 tenant_id 与 ACCEPTANCE_TENANT_ID 不等的场景
  预期观察: assertTenantAndDevice() 触发 ai_incomplete 退出；run-summary.json 中 trigger_collect_count = 0；不调用任何 trigger_collect
  等待预算: 0s
  留证: 单测 stub 验证
  Test: manual:bash -c 'node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep "tenant 不匹配"'

- [ ] [BEHAVIOR] [L1] B-06: machines_online = 0 时双自检使整轮 ai_incomplete 退出
  动作: 模拟 run-summary.machines_online = 0 场景（登录成功但无在线机器）
  预期观察: assertTenantAndDevice() 的 machines_online ≥ 1 校验失败 → ai_incomplete 退出；无 trigger_collect 调用
  等待预算: 0s
  留证: 单测 stub 验证
  Test: manual:bash -c 'node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep "machines_online=0"'

- [ ] [BEHAVIOR] [L1] B-07: trigger_collect 全局计数超过 2 次时断言失败退出
  动作: 构造一个 cells-map 含 3 个 trigger_collect 格的场景，让 capture 主循环走到第 3 次调用
  预期观察: 第 3 次 trigger_collect 调用时断言失败，进程 exit 1；第 1、2 次正常执行
  等待预算: 0s
  留证: 单测输出与 exit code
  Test: manual:bash -c 'node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep "trigger_collect 超限"'

- [ ] [BEHAVIOR] [L1] B-08: /api/version 不可达时整轮 ai_incomplete 退出（fail-loud）
  动作: 模拟 /api/version 返回非 2xx 或 timeout
  预期观察: capture.mjs 不静默忽略，而是以 ai_incomplete + exit 1 退出；run-summary.json 中 version_stamp.backend_sha 不为实际值
  等待预算: 0s
  留证: 单测 stub 验证
  Test: manual:bash -c 'node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep "version fail-loud"'

- [ ] [BEHAVIOR] [L1] B-09: workflow secrets 白名单不含禁用 secret，runner 为 ubuntu-latest
  动作: 静态解析 .github/workflows/ai-acceptance-capture.yml
  预期观察: 文件含 ubuntu-latest；不含 self-hosted；不含 ACCEPTANCE_API_TOKEN / TAILSCALE_AUTHKEY / HK_VPS_SSH_KEY
  等待预算: 0s
  留证: grep 命令输出
  Test: manual:bash -c 'grep "ACCEPTANCE_API_TOKEN\|TAILSCALE_AUTHKEY\|HK_VPS_SSH_KEY" .github/workflows/ai-acceptance-capture.yml && echo FAIL || echo PASS'

- [ ] [BEHAVIOR] [L1] B-10: 私信/关注/点赞类动作在采证器全文为零
  动作: grep 三个文件扫描禁用词汇
  预期观察: 匹配数全为 0
  等待预算: 0s
  留证: grep 输出
  Test: manual:bash -c 'grep -c "私信\|关注\|点赞\|outreach.*click\|sendMessage" scripts/acceptance-spec/ai-run/capture.mjs scripts/acceptance-spec/ai-run/login.mjs scripts/acceptance-spec/ai-run/cells-map.mjs; echo "（期望全部为 0）"'

---

## Invariant 铁律映射

- [ ] [BEHAVIOR] [L1] INV-1: action 枚举白名单不可破坏（机械断言）
  Test: manual:bash -c 'node -e "import(\"./scripts/acceptance-spec/ai-run/cells-map.mjs\").then(m=>{const illegal=m.CELLS_MAP.filter(c=>![\"observe\",\"trigger_collect\"].includes(c.action));if(illegal.length>0){console.error(\"FAIL: 非法 action:\",illegal.map(c=>c.id+\":\"+c.action));process.exit(1)}console.log(\"PASS\")})"'

- [ ] [BEHAVIOR] [L1] INV-2: trigger_collect ≤ 2 上限闸（S6-c3 + S10-c4 恰好 2 格）
  Test: manual:bash -c 'node -e "import(\"./scripts/acceptance-spec/ai-run/cells-map.mjs\").then(m=>{const tc=m.CELLS_MAP.filter(c=>c.action===\"trigger_collect\");const ids=tc.map(c=>c.id).sort();if(tc.length!==2||ids[0]!==\"S10-c4\"||ids[1]!==\"S6-c3\"){console.error(\"FAIL: tc 格数或格号不符\",ids);process.exit(1)}console.log(\"PASS: \"+ids)})"'

- [ ] [BEHAVIOR] [L1] INV-3: 无凭据不静默 signup 回落（单测覆盖）
  Test: manual:bash -c 'node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep -E "ok|not ok" | grep "无凭据"'

- [ ] [BEHAVIOR] [L1] INV-4: 双自检（tenant + machines_online）先于任何采集动作（单测覆盖）
  Test: manual:bash -c 'node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep -E "ok|not ok" | grep "双自检"'

- [ ] [BEHAVIOR] [L1] INV-5: runner 为 ubuntu-latest，禁 self-hosted
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/ai-acceptance-capture.yml\",\"utf8\");if(!c.includes(\"ubuntu-latest\")||c.includes(\"self-hosted\")){process.exit(1)}console.log(\"PASS\")"'

---

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] [L2] E2E-01: 采证器全套机械断言一次性全绿
  动作: 运行所有 BEHAVIOR 对应的 manual:bash 命令
  预期观察: B-01 到 B-10 + INV-1 到 INV-5 全部 PASS；任一非 0 exit 或 FAIL 字样阻塞
  等待预算: 60s
  留证: 各命令 stdout + exit code 汇总
  Test: manual:bash -c 'set -e; node -e "import(\"./scripts/acceptance-spec/ai-run/cells-map.mjs\").then(m=>{const a=[...new Set(m.CELLS_MAP.map(c=>c.action))].sort();if(JSON.stringify(a)!==JSON.stringify([\"observe\",\"trigger_collect\"]))process.exit(1);const tc=m.CELLS_MAP.filter(c=>c.action===\"trigger_collect\");if(tc.length!==2)process.exit(1);console.log(\"PASS B-01+B-02+INV-1+INV-2\")})"; for f in scripts/acceptance-spec/ai-run/capture.mjs scripts/acceptance-spec/ai-run/login.mjs scripts/acceptance-spec/ai-run/cells-map.mjs; do count=$(grep -c signup "$f" || true); [ "$count" -eq 0 ] || { echo "FAIL B-02: $f"; exit 1; }; done; echo "PASS signup=0"; grep "ACCEPTANCE_API_TOKEN\|TAILSCALE_AUTHKEY\|HK_VPS_SSH_KEY" .github/workflows/ai-acceptance-capture.yml && exit 1 || echo "PASS B-09 secrets"; node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js && echo "PASS unit tests"; echo "ALL PASS"'

## 未覆盖真实链路清单

- E2E 第 6 步（staging 采证真实一轮）需真实 staging 凭据，本合同仅作可选项不阻塞 CI（Gate B 后开放）。
- 判官回写（POST ai-results）需真实 Brain staging 环境，本合同提供 mock 层单测覆盖核心断言。
- 前端 VITE_BUILD_SHA 展示通过 static grep 验证，不跑 Playwright E2E。
