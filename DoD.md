contract_branch: cp-harness-propose-r3-63f76ab6-ra0860dd1-a18
sprint_dir: sprints/08051200-productmap-cli-json

# Contract DoD — product-map CLI `check --json`

**范围**: 仅 `scripts/product-map/` CLI 与单测；不改分类数据、其他子命令或共享 CI。
**大小**: S

## Invariant 映射

- [x] [ARTIFACT] INV-1 共享 CI 禁区：本 Sprint diff 不含 `.github/workflows/`。
  Test: bash -c 'test -z "$(git diff --name-only d087c9cf489e1edff9146ea565552dd059851c06...HEAD -- .github/workflows)"'

## ARTIFACT 条目

- [x] [ARTIFACT] CLI 与 node:test 单测均在授权目录。
  Test: bash -c 'test -f scripts/product-map/cli.mjs && test -f scripts/product-map/__tests__/product-map-cli-json.test.mjs'

## BEHAVIOR 条目

- [x] [BEHAVIOR] [L2] B-01: `check --json` 成功时返回 PRD 必填字段
  动作: 在当前真实 product-map 上执行 `check --json`
  预期观察: stdout 是单个 JSON，至少含 `ok=true`、`errors=[]`，exit 0；额外字段允许
  等待预算: 0s
  留证: 命令 stdout JSON
  Test: manual:bash -c 'node scripts/product-map/cli.mjs check --json | jq -e '"'"'type=="object" and has("ok") and has("errors") and .ok==true and (.ok|type=="boolean") and .errors==[] and (.errors|type=="array")'"'"''

- [x] [BEHAVIOR] [L2] B-02: 普通 `check` 成功与失败输出逐字兼容
  动作: 用真实文件、缺失 JSON、digest 漂移三个夹具，不带 `--json` 执行 CLI
  预期观察: 成功 PASS 行与两个失败分支 stderr 均逐字等于冻结文本，退出码保持 0/1/1
  等待预算: 0s
  留证: 完整 stdout 文本
  Test: manual:bash -c 'node --test --test-name-pattern="普通 check" scripts/product-map/__tests__/product-map-cli-json.test.mjs'

- [x] [BEHAVIOR] [L2] B-03: 损坏 product-map.json 返回 JSON 失败 [接缝×2]
  动作: 在隔离临时仓库将生成 JSON 写成不可解析内容后执行 `check --json`
  预期观察: exit 非0，stdout 为 `ok=false` 与非空字符串 errors，stderr 空
  等待预算: 2s
  留证: 临时仓库 failure.json 与 exit code
  Test: manual:bash -c 'node --test --test-name-pattern="损坏或缺失" scripts/product-map/__tests__/product-map-cli-json.test.mjs'

- [x] [BEHAVIOR] [L2] B-04: 缺失 product-map.json 返回 JSON 失败 [接缝×2]
  动作: 在隔离临时仓库不提供生成 JSON 后执行 `check --json`
  预期观察: exit 非0，stdout 合法且 errors 含具体缺失原因
  等待预算: 2s
  留证: 临时仓库 stdout 与 exit code
  Test: manual:bash -c 'node --test --test-name-pattern="损坏或缺失" scripts/product-map/__tests__/product-map-cli-json.test.mjs'

- [x] [BEHAVIOR] [L2] B-05: `--json` 与额外既有参数并存不互扰
  动作: 执行 `check --json extra`
  预期观察: 仍得到与成功检查相同 JSON 和 exit 0
  等待预算: 0s
  留证: 命令 stdout JSON
  Test: manual:bash -c 'node scripts/product-map/cli.mjs check --json extra | jq -e '"'"'has("ok") and has("errors") and .ok==true and .errors==[]'"'"''

- [x] [BEHAVIOR] [L2] B-06: node:test 回归与新增测试全部通过
  动作: 执行 product-map 真实测试套件
  预期观察: 所有测试通过且进程 exit 0
  等待预算: 30s
  留证: TAP 输出
  Test: manual:bash -c 'node --test scripts/product-map/__tests__/product-map.test.js scripts/product-map/__tests__/gp-smoke-ratchet.test.js scripts/product-map/__tests__/realmachine-unverified-ratchet.test.js scripts/product-map/__tests__/product-map-cli-json.test.mjs'
