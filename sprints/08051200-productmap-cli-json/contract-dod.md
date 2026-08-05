---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — product-map CLI `check --json`

**范围**: 仅 `scripts/product-map/` CLI 与单测；不改分类数据、其他子命令或共享 CI。
**大小**: S

## Invariant 映射

- [ ] [ARTIFACT] INV-1 共享 CI 禁区：本 Sprint diff 不含 `.github/workflows/`。
  Test: bash -c 'test -z "$(git diff --name-only d087c9cf489e1edff9146ea565552dd059851c06...HEAD -- .github/workflows)"'

## ARTIFACT 条目

- [ ] [ARTIFACT] CLI 与 node:test 单测均在授权目录。
  Test: bash -c 'test -f scripts/product-map/cli.mjs && test -f scripts/product-map/__tests__/product-map-cli-json.test.js'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: `check --json` 成功时返回精确 schema
  动作: 在当前真实 product-map 上执行 `check --json`
  预期观察: stdout 是单个 JSON，`ok=true`、`errors=[]`、无额外字段，exit 0
  等待预算: 0s
  留证: 命令 stdout JSON
  Test: manual:bash -c 'node scripts/product-map/cli.mjs check --json | jq -e '"'"'type=="object" and keys==["errors","ok"] and .ok==true and (.ok|type=="boolean") and .errors==[] and (.errors|type=="array")'"'"''

- [ ] [BEHAVIOR] [L2] B-02: 普通 `check` stdout 与冻结行为逐字兼容
  动作: 不带 `--json` 执行真实 CLI
  预期观察: 看到原有 PASS 行且 exit 0
  等待预算: 0s
  留证: 完整 stdout 文本
  Test: manual:bash -c 'OUT=$(node scripts/product-map/cli.mjs check); DIGEST=$(node -e "import('"'"'./scripts/product-map/lib.mjs'"'"').then(async m=>console.log(m.productMapDigest((await m.loadAndValidateProductMap()).map).slice(0,8)))"); [ "$OUT" = "PASS: no drift — generated files match current product-map.yaml (digest: ${DIGEST}...)" ]'

- [ ] [BEHAVIOR] [L2] B-03: 损坏 product-map.json 返回 JSON 失败 [接缝×2]
  动作: 在隔离临时仓库将生成 JSON 写成不可解析内容后执行 `check --json`
  预期观察: exit 非0，stdout 为 `ok=false` 与非空字符串 errors，stderr 空
  等待预算: 2s
  留证: 临时仓库 failure.json 与 exit code
  Test: manual:bash -c 'TMP=$(mktemp -d); trap '"'"'rm -rf "$TMP"'"'"' EXIT; mkdir -p "$TMP/scripts" "$TMP/product-map/generated"; cp -R scripts/product-map "$TMP/scripts/"; cp product-map/product-map.yaml product-map/product-map.schema.json "$TMP/product-map/"; ln -s "$PWD/node_modules" "$TMP/node_modules"; printf '"'"'{broken'"'"' > "$TMP/product-map/generated/product-map.json"; set +e; (cd "$TMP" && node scripts/product-map/cli.mjs check --json) >"$TMP/out" 2>"$TMP/err"; RC=$?; set -e; [ "$RC" -ne 0 ] && [ ! -s "$TMP/err" ] && jq -e '"'"'keys==["errors","ok"] and .ok==false and (.errors|length>0 and all(type=="string"))'"'"' "$TMP/out"'

- [ ] [BEHAVIOR] [L2] B-04: 缺失 product-map.json 返回 JSON 失败 [接缝×2]
  动作: 在隔离临时仓库不提供生成 JSON 后执行 `check --json`
  预期观察: exit 非0，stdout 合法且 errors 含具体缺失原因
  等待预算: 2s
  留证: 临时仓库 stdout 与 exit code
  Test: manual:bash -c 'TMP=$(mktemp -d); trap '"'"'rm -rf "$TMP"'"'"' EXIT; mkdir -p "$TMP/scripts" "$TMP/product-map/generated"; cp -R scripts/product-map "$TMP/scripts/"; cp product-map/product-map.yaml product-map/product-map.schema.json "$TMP/product-map/"; ln -s "$PWD/node_modules" "$TMP/node_modules"; set +e; OUT=$(cd "$TMP" && node scripts/product-map/cli.mjs check --json 2>/dev/null); RC=$?; set -e; [ "$RC" -ne 0 ] && printf "%s" "$OUT" | jq -e '"'"'.ok==false and (.errors|type=="array" and length>0 and all(type=="string")) and (keys==["errors","ok"])'"'"''

- [ ] [BEHAVIOR] [L2] B-05: `--json` 与额外既有参数并存不互扰
  动作: 执行 `check --json extra`
  预期观察: 仍得到与成功检查相同 JSON 和 exit 0
  等待预算: 0s
  留证: 命令 stdout JSON
  Test: manual:bash -c 'node scripts/product-map/cli.mjs check --json extra | jq -e '"'"'keys==["errors","ok"] and .ok==true and .errors==[]'"'"''

- [ ] [BEHAVIOR] [L2] B-06: node:test 回归与新增测试全部通过
  动作: 执行 product-map 真实测试套件
  预期观察: 所有测试通过且进程 exit 0
  等待预算: 30s
  留证: TAP 输出
  Test: manual:bash -c 'npm run test:product-map'

