# Sprint Contract Draft（Round 1）

## Notes

- contract-gate: skipped (file not found, third-party repo)
- GAN 起草身份仅作 provenance；未来 Evaluator/Judge 身份必须读取 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`，本合同不固化任何角色 UUID。

## Response Schema（推导来源: PRD 字面）

### Endpoint: CLI `node scripts/product-map/cli.mjs check --json`

**Success（exit 0）**:

```json
{"ok": true, "errors": []}
```

- `ok`（boolean，必填）：PRD 明确。
- `errors`（string[]，必填）：PRD 明确；成功时为空数组。

**Failure（exit 非 0）**:

```json
{"ok": false, "errors": ["具体问题描述"]}
```

- 顶层 keys 必须恰为 `errors`、`ok`；不新增 PRD 未授权字段。
- 禁用字段名：`error`、`message`、`success`、`status`。

## 已知约束（来自回归测试）

- `scripts/product-map/__tests__/product-map.test.js` → T1/T3/T4/T6/T8/T9 保持现有分类解析、关系、digest、smoke_files 与 AJV 行为。
- `scripts/product-map/__tests__/product-map.test.js` → T10 YAML 错误必须结构化，不得裸堆栈崩溃。
- `[累积FR]` 本 line 暂无历史（PRD 已冻结）；context-manifest 运行时查询未返回正文。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | `check --json` 输出单个机器可解析对象；普通 `check` 逐字兼容。 |
| NFR（做得多好） | Node.js 20；stdout 在 JSON 模式无额外文本；无 PRD 指定延迟阈值。 |
| Invariant（永不违反） | 退出码通过=0、失败=非0；不改分类数据、其他子命令或共享 CI。 |
| 判定点（怎么知道） | `jq` 校验字段、类型、keys 与错误数组；shell 校验退出码。 |
| 保质期（何时过期） | 随 CLI 合同长期有效；字段变更须新 PRD。 |
| 死亡告警（停了谁知道） | L2 `product-map-contract` 与 CLI smoke 首次执行即失败。 |
| 失败语义（挂了怎么办） | fail-closed，输出合法 JSON 后非0退出；不得未捕获异常污染 stdout。 |
| 效果确认（已发≠已生效） | 调用方能以 `jq` 读取且退出码与 `ok` 一致才算生效。 |

### 判定点登记表

（本任务无真机/RPA/外部状态判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 生成 JSON 缺失/损坏 | stdout 输出 `ok=false` 与具体 `errors`，exit 非0 | 是（只读检查） | 无文本降级，保持 JSON 合同 |
| YAML/schema/smoke 检查失败 | 聚合具体问题至字符串数组，exit 非0 | 是 | fail-closed |
| 普通 `check` | 保持冻结基线原输出与退出码 | 是 | N/A |

### 输入对抗面

N/A：仓库本地 CLI，不是对外暴露 agent。

## GP-Anchor

GP-Anchor: none(config)

理由：本 Sprint 修改分类合同检查 CLI 的输出适配，不推进任何业务 Golden Path，也不修改 product-map 数据。

## 真实调用方请求 shape

真实调用方为 shell/CI：`node scripts/product-map/cli.mjs check --json`，无 HTTP、认证 header 或请求 body；结果通过 stdout JSON 与进程退出码消费。普通调用保持 `node scripts/product-map/cli.mjs check`。

## 禁 mock 边清单

- CLI 入口 ↔ 真实文件系统中的 `product-map/product-map.yaml` 与 `product-map/generated/*`（本单修改错误收集/输出边；测试以临时仓库真实文件运行 CLI，不 mock `fs`）。
- CLI 入口 ↔ `lib.mjs` 的真实校验函数（不得 stub/mocking 校验结果）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

独立小路（无父路）

`check` 入口 → 执行真实既有检查 → 选择文本或 JSON 呈现 → 调用方按内容与退出码判门禁

### Step 1：普通 `check` 保持冻结基线

**来源**: `[FROM_PRD]` — Golden Path 第 4 点与范围限定。

**可观测行为**: 不带 `--json` 时 stdout 为冻结基线的 PASS 行，stderr 为空且 exit 0。

**验证命令**: `OUT=$(node scripts/product-map/cli.mjs check); [ "$OUT" = "PASS: no drift — generated files match current product-map.yaml (digest: $(node -e \"import('./scripts/product-map/lib.mjs').then(async m=>console.log(m.productMapDigest((await m.loadAndValidateProductMap()).map).slice(0,8)))\")...)" ]`

**硬阈值**: stdout 逐字相同；exit=0。上述命令同时执行字面比较与 exit-code 断言。

### Step 2：`check --json` 成功输出

**来源**: `[FROM_PRD]` — Golden Path 第 1-2 点。

**可观测行为**: stdout 仅一个 JSON 对象，`ok=true`、`errors=[]`，且无额外 keys，exit 0。

**验证命令**: `node scripts/product-map/cli.mjs check --json | jq -e 'type=="object" and keys==["errors","ok"] and .ok==true and .errors==[]'`

**硬阈值**: 合法 JSON；keys 精确；字段类型和值符合 PRD；exit=0。验证命令已 codify 全部阈值。

### Step 3：损坏输入仍输出结构化失败

**来源**: `[FROM_PRD]` — 边界情况“product-map.json 不存在或不可解析”。

**可观测行为**: 在隔离临时仓库删除或损坏生成 JSON 后，stdout 仍为单个合法对象，`ok=false`、`errors` 为非空字符串数组，exit 非0；stderr 不含未捕获堆栈。

**验证命令**: `bash -c 'TMP=$(mktemp -d); trap "rm -rf \"$TMP\"" EXIT; mkdir -p "$TMP/scripts" "$TMP/product-map/generated"; cp -R scripts/product-map "$TMP/scripts/"; cp -R product-map/product-map.yaml product-map/product-map.schema.json "$TMP/product-map/"; ln -s "$PWD/node_modules" "$TMP/node_modules"; printf "{" > "$TMP/product-map/generated/product-map.json"; set +e; OUT=$(cd "$TMP" && node scripts/product-map/cli.mjs check --json 2>err); RC=$?; set -e; [ "$RC" -ne 0 ]; printf "%s" "$OUT" | jq -e '"'"'type=="object" and keys==["errors","ok"] and .ok==false and (.errors|type=="array" and length>0 and all(type=="string"))'"'"'; [ ! -s "$TMP/err" ]'`

**硬阈值**: exit 非0、stdout 单 JSON、非空字符串错误数组、stderr 空；上述命令逐项断言。

### Step 4：参数并存不干扰检查语义

**来源**: `[FROM_PRD]` — 边界情况“`--json` 与其他既有参数并存”。

**可观测行为**: `check --json extra` 仍执行 check JSON 模式并给出同一成功结论；参数不改变既有 command 选择。

**验证命令**: `node scripts/product-map/cli.mjs check --json extra | jq -e 'keys==["errors","ok"] and .ok==true and .errors==[]'`

**硬阈值**: exit=0 且 schema/value 与 Step 2 相同；验证命令已覆盖。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api（本任务不依赖 Postgres；`DB_URL` N/A）

```bash
#!/bin/bash
set -euo pipefail
cd "${REPO_ROOT:-/workspace}"
npm run product-map:check >/tmp/product-map-text.out
EXPECTED="PASS: no drift — generated files match current product-map.yaml (digest: $(node -e "import('./scripts/product-map/lib.mjs').then(async m=>console.log(m.productMapDigest((await m.loadAndValidateProductMap()).map).slice(0,8)))")...)"
[ "$(cat /tmp/product-map-text.out)" = "$EXPECTED" ]
node scripts/product-map/cli.mjs check --json >/tmp/product-map-ok.json
jq -e 'type=="object" and keys==["errors","ok"] and .ok==true and .errors==[]' /tmp/product-map-ok.json
TMP=$(mktemp -d)
trap 'rm -rf "$TMP" /tmp/product-map-text.out /tmp/product-map-ok.json' EXIT
mkdir -p "$TMP/scripts" "$TMP/product-map/generated"
cp -R scripts/product-map "$TMP/scripts/"
cp product-map/product-map.yaml product-map/product-map.schema.json "$TMP/product-map/"
ln -s "$PWD/node_modules" "$TMP/node_modules"
printf '{broken' > "$TMP/product-map/generated/product-map.json"
set +e
(cd "$TMP" && node scripts/product-map/cli.mjs check --json) > "$TMP/failure.json" 2> "$TMP/failure.err"
RC=$?
set -e
[ "$RC" -ne 0 ]
[ ! -s "$TMP/failure.err" ]
jq -e 'type=="object" and keys==["errors","ok"] and .ok==false and (.errors|type=="array" and length>0 and all(type=="string"))' "$TMP/failure.json"
node scripts/product-map/cli.mjs check --json extra | jq -e '.ok==true and .errors==[]'
echo 'Golden Path 验证通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: 生成 JSON 分别置为空文件、数组、合法 JSON 但缺 digest。
- 重复提交: 连续执行 `check --json`，比较输出确定性与退出码。
- 中途中断: N/A（同步只读 CLI，无持久写入）。
- 边界值: 同时制造 MD digest 不匹配与 smoke 文件缺失，确认 `errors` 每项均为字符串且 stdout 仍单 JSON。

发现分级: P0/P1（错误 exit=0、stdout 非 JSON、普通模式回归）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| JSON 成功与 schema | `tests/product-map-cli-json.test.ts` | `check --json 成功时只输出 ok/errors JSON` | 当前 CLI 输出文本，JSON.parse 失败 |
| JSON 失败与兼容 | `tests/product-map-cli-json.test.ts` | `check --json 对损坏 JSON 输出结构化失败` | 当前 CLI 裸抛 SyntaxError/JSON stdout 缺失 |

