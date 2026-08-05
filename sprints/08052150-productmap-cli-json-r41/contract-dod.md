---
skeleton: false
journey_type: autonomous
---
# Contract DoD — product-map CLI `check --json`

**范围**: 仅 `scripts/product-map/` CLI 与单测；分类数据、其他子命令不改。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/product-map/cli.mjs` 实现 `check --json`，测试文件保留真实子进程覆盖
  Test: node -e "const fs=require('node:fs');const c=fs.readFileSync('scripts/product-map/cli.mjs','utf8');const t=fs.readFileSync('sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js','utf8');if(!c.includes('--json')||!t.includes('spawnSync'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Golden Path 成功时调用方读到精确 JSON schema
  动作: 执行 `node scripts/product-map/cli.mjs check --json`
  预期观察: stdout 仅一个对象，ok=true、errors=[]，进程退出 0
  等待预算: 0s
  留证: 命令 stdout 与 exit code
  Test: manual:bash -c 'OUT=$(node scripts/product-map/cli.mjs check --json); CODE=$?; [ "$CODE" -eq 0 ] && printf "%s" "$OUT" | jq -e '\''type=="object" and keys==["errors","ok"] and .ok==true and (.ok|type)=="boolean" and (.errors|type)=="array" and (.errors|length)==0'\'''

- [ ] [BEHAVIOR] [L2] B-02: 漂移失败时仍返回具体 errors 与非零退出
  动作: 在隔离副本篡改 generated digest 后执行 `check --json`
  预期观察: stdout 是 ok=false 的单 JSON，errors 含 digest 原因，被测 CLI 退出非 0
  等待预算: 0s
  留证: node:test TAP 输出
  Test: manual:bash -c 'node --test sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js --test-name-pattern="漂移失败时"'

- [ ] [BEHAVIOR] [L2] B-03: 投影缺失或损坏不泄漏非 JSON stdout
  动作: 分别在隔离副本删除与破坏 `product-map.json` 后执行 `check --json`
  预期观察: 两次 stdout 均可解析，ok=false、errors 为非空字符串数组，退出非 0
  等待预算: 0s
  留证: node:test TAP 输出
  Test: manual:bash -c 'node --test sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js --test-name-pattern="缺失或不可解析"'

- [ ] [BEHAVIOR] [L2] B-04: JSON 顶层 keys 完整且无额外字段
  动作: 对真实 `check --json` stdout 执行 jq keys 精确匹配
  预期观察: keys 恰为 errors、ok，且 errors 每项均为 string
  等待预算: 0s
  留证: jq exit code
  Test: manual:bash -c 'node scripts/product-map/cli.mjs check --json | jq -e '\''keys==["errors","ok"] and all(.errors[]; type=="string")'\'''

- [ ] [BEHAVIOR] [L2] B-05: 普通 check 人类文本逐字零回归
  动作: 在隔离副本执行不带 `--json` 的 `check`
  预期观察: stdout 与当前 digest 构成的既有 PASS 行逐字一致，退出 0
  等待预算: 0s
  留证: node:test TAP 输出
  Test: manual:bash -c 'node --test sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js --test-name-pattern="逐字一致"'

- [ ] [BEHAVIOR] [L2] B-06: 产品分类合同原入口继续通过
  动作: 执行仓库既有 `npm run product-map:check`
  预期观察: 显示既有 PASS 文本且退出 0
  等待预算: 0s
  留证: npm 命令输出与 exit code
  Test: manual:bash -c 'npm run product-map:check'

## Invariant 覆盖

- INV-1 适用：分类事实仍只来自 `product-map/product-map.yaml`；本 Sprint 禁止改该文件，由 `git diff --name-only 2678dd2b687ea40bed6cf482b8480ccefc8af6d4 -- product-map/` 应为空机检。
- INV-2 适用：smoke 铁律与 Test Contract 四列格式由本合同及 `npm run product-map:check` 覆盖。
- INV-3 适用：Red 测试只落 Sprint 精确路径，不改共享 CI；Generator 禁改 `.github/workflows/` 与共享 allowlist。
- INV-4 适用：catch/错误码必须统一转为 `ok=false` + errors + 非零 exit，不得 warning 降级或吞错。
- INV-5 适用：secrets/PII 不进入输出、测试或日志。
- INV-6 适用：合同批准前记录真实解释器 `node --test` 的 exit code 与 Red 日志。
- INV-7 N/A：本 Sprint 不涉及服务、launchd、端口、后台 job、scheduler、状态枚举、DB、租户、API/auth、通知、PR merge、relay、真机、部署、付费第三方、时间窗口或跨模块时间常数。

## BEHAVIOR:E2E

N/A：autonomous CLI 的 Mode B 已在 contract-draft.md 的 Bash E2E 完整覆盖。
