contract_branch: cp-harness-propose-r3-73abda71-r300693ff-a24
sprint_dir: sprints/08052150-productmap-cli-json-r41

# Contract DoD — product-map CLI `check --json`

**范围**: 仅 `scripts/product-map/` CLI 与单测；分类数据、其他子命令不改。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/product-map/cli.mjs` 实现 `check --json`，测试文件保留真实子进程覆盖
  Test: node -e "const fs=require('node:fs');const c=fs.readFileSync('scripts/product-map/cli.mjs','utf8');const t=fs.readFileSync('sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js','utf8');if(!c.includes('--json')||!t.includes('spawnSync'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Golden Path 成功时调用方读到精确 JSON schema
  Test: manual:bash -c 'OUT=$(node scripts/product-map/cli.mjs check --json); CODE=$?; [ "$CODE" -eq 0 ] && printf "%s" "$OUT" | jq -e '\''type=="object" and keys==["errors","ok"] and .ok==true and (.ok|type)=="boolean" and (.errors|type)=="array" and (.errors|length)==0'\'''

- [ ] [BEHAVIOR] [L2] B-02: 漂移失败时仍返回具体 errors 与非零退出
  Test: manual:bash -c 'node --test --test-name-pattern="漂移失败时" sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js'

- [ ] [BEHAVIOR] [L2] B-03: 投影缺失或损坏不泄漏非 JSON stdout
  Test: manual:bash -c 'node --test --test-name-pattern="缺失或不可解析" sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js'

- [ ] [BEHAVIOR] [L2] B-04: JSON 顶层 keys 完整且无额外字段
  Test: manual:bash -c 'node scripts/product-map/cli.mjs check --json | jq -e '\''keys==["errors","ok"] and all(.errors[]; type=="string")'\'''

- [ ] [BEHAVIOR] [L2] B-05: 普通 check 成功与三种失败的人类文本及退出码逐字零回归
  Test: manual:bash -c 'node --test --test-name-pattern="不带 --json.*逐字一致" sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js'

- [ ] [BEHAVIOR] [L2] B-06: 产品分类合同原入口继续通过
  Test: manual:bash -c 'npm run product-map:check'

- [ ] [BEHAVIOR] [L2] B-07: JSON 标志与既有参数并存时互不干扰
  Test: manual:bash -c 'node --test --test-name-pattern="与既有参数并存" sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js'
