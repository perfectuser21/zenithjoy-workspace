# Sprint Contract Draft (Round 1)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- PRD 正文以 task bundle 的 Thin PRD 为主，仓库 `sprint-prd.md` 为补充。
- 本任务不依赖数据库、网络、业务身份或第三方 API。

## GP-Anchor

GP-Anchor: none(config)

## Response Schema（推导来源: PRD字面）

### Command: `node scripts/product-map/cli.mjs check --json`

成功（exit 0）与失败（exit 非 0）均向 stdout 输出且仅输出：

```json
{"ok":true,"errors":[]}
```

- `ok`（boolean，必填）：PRD 明确。
- `errors`（string[]，必填）：PRD 明确；通过时为空，失败时逐项描述具体问题。
- 顶层 keys 必须完全等于 `errors,ok`；禁止增加替代字段。
- 非 JSON 模式不适用该 schema，输出必须与基线逐字一致。

## 已知约束（来自回归测试）

- `scripts/product-map/__tests__/product-map.test.js` → schema、关系、digest、smoke_files 与 bootstrap parity 均须保持通过。
- `[累积FR]` 本 line 暂无历史。
- registry 测试风格：该目录使用 Node 内建 `node:test` 与 `assert/strict`，新测试沿用。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 为 `check` 增加 `--json`，输出 `ok/errors`；文本模式与退出码兼容。 |
| NFR（做得多好） | stdout 始终为单个可解析对象；本地命令 10 秒内完成。 |
| Invariant（永不违反） | 不改 product-map 数据、其他子命令、文本模式或退出码语义。 |
| 判定点（怎么知道） | 以进程 exit code、stdout 严格 JSON schema、文本基线字节比较判定。 |
| 保质期（何时过期） | CLI 参数契约长期有效；字段变更须新 PRD。 |
| 死亡告警（停了谁知道） | L2 `product-map-contract` job 在一次 CI 内失败并通知 PR 作者。 |
| 失败语义（挂了怎么办） | fail-closed：输出 `ok=false`、非零退出；JSON 模式不得裸异常污染 stdout。 |
| 效果确认（已发≠已生效） | jq 可读取字段且 shell 观察到对应 exit code。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 生成 JSON 缺失或不可解析 | stdout 单个 `ok=false` 对象，errors 含原因，exit 非 0 | 是，只读检查 | 无静默放行 |
| 规则检查失败 | 聚合具体 errors，exit 非 0 | 是 | 无静默放行 |

### 输入对抗面

N/A：本地 CLI 不暴露 agent 或外部用户内容入口。

## 真实调用方请求 shape

真实调用方为 shell/CI：`node scripts/product-map/cli.mjs check --json`；无认证、无 body、无网络 Content-Type。调用方从 stdout 读取 `ok`、`errors` 并读取进程退出码。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

- CLI 参数解析 ↔ `cmdCheck` 输出/退出路径（测试必须真实 spawn Node 进程，不得 mock `process.argv`、stdout、stderr 或 exit code）。
- `cmdCheck` ↔ 文件系统生成投影（缺失与坏 JSON 必须用真实临时文件状态触发，不得 mock `fs`）。

## 接缝清单

无真机、异步或第三方接缝；本地进程与真实文件系统属于 L2 逻辑集成，直接执行两次可复现。

## Golden Path

独立小路（无父路）

[CI 执行 check --json] → [CLI 汇总检查结果] → [stdout JSON + exit code 供 jq 门禁]

### Step 1: 调用 check --json
**来源**: `[FROM_PRD]` — Thin PRD「Golden Path」与具体第 1 项。

**可观测行为**: 命令真实启动，接受 `check --json`，与额外既有参数并存不改变 JSON 语义。

**验证命令**: `node scripts/product-map/cli.mjs check --json --unused-existing-compatible | jq -e 'type=="object"'`

**硬阈值**: 10 秒内完成；stdout 可被 jq 解析。由 E2E 的 `timeout 10s` 与 jq 断言执行。

### Step 2: 成功结论成为严格 JSON
**来源**: `[FROM_PRD]` — Thin PRD 具体第 2 项。

**可观测行为**: 当前有效 product-map 返回 `ok=true`、空 `errors`，stdout 没有额外文本，exit 0。

**验证命令**: `OUT=$(node scripts/product-map/cli.mjs check --json); CODE=$?; [ "$CODE" -eq 0 ] && printf '%s' "$OUT" | jq -e 'keys==["errors","ok"] and .ok==true and .errors==[]'`

**硬阈值**: exit=0；keys 精确为 `errors,ok`；`ok=true`；`errors=[]`。

### Step 3: 失败结论仍是严格 JSON
**来源**: `[FROM_PRD]` — Thin PRD「边界情况」缺失/不可解析投影与多问题要求。

**可观测行为**: 真实文件缺失或坏 JSON 时，stdout 仍为单个对象，`ok=false`，`errors` 为非空字符串数组，exit 非 0。

**验证命令**: `bash -c 'set +e; OUT=$(node scripts/product-map/cli.mjs check --json); CODE=$?; [ "$CODE" -ne 0 ] && printf "%s" "$OUT" | jq -e '\''keys==["errors","ok"] and .ok==false and (.errors|type)=="array" and (.errors|length)>0 and all(.errors[]; type=="string")'\'''`

**硬阈值**: exit≠0；stdout 解析成功；errors 至少 1 条且全为 string。测试与 E2E 通过真实文件故障建立前置状态。

### Step 4: 文本模式零回归
**来源**: `[FROM_PRD]` — Thin PRD 具体第 1、3 项。

**可观测行为**: 不带 `--json` 的 stdout、stderr 与冻结 base SHA 的 CLI 逐字一致，退出码一致。

**验证命令**: `cmp "$BASE_STDOUT" "$NEW_STDOUT" && cmp "$BASE_STDERR" "$NEW_STDERR" && [ "$BASE_CODE" -eq "$NEW_CODE" ]`

**硬阈值**: 两个输出逐字节相同，exit code 完全相同。

### Step 5: 防造假完整性检查
**来源**: `[AI_ADDED]` — 防止只验证可解析却漏掉多余 key、stderr 污染和失败退出码。

**可观测行为**: 所有新红测直接 spawn CLI；不 mock 被改边；旧 product-map 回归测试保持绿。

**验证命令**: `node --test sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js scripts/product-map/__tests__/product-map.test.js`

**硬阈值**: 新合同测试 5/5 与既有测试全部通过；任一失败均为非零退出。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT=$(pwd)
CLI="$REPO_ROOT/scripts/product-map/cli.mjs"
JSON_PATH="$REPO_ROOT/product-map/generated/product-map.json"
BASE_CLI="$REPO_ROOT/scripts/product-map/.harness-base-cli.mjs"
BACKUP_JSON=$(mktemp)
TMP_DIR=$(mktemp -d)
cp "$JSON_PATH" "$BACKUP_JSON"
cleanup() { cp "$BACKUP_JSON" "$JSON_PATH"; rm -f "$BACKUP_JSON" "$BASE_CLI"; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

git show d1991c02f89b581b431b1ee18a1028f6ab6c933c:scripts/product-map/cli.mjs > "$BASE_CLI"
set +e
node "$BASE_CLI" check >"$TMP_DIR/base.out" 2>"$TMP_DIR/base.err"; BASE_CODE=$?
node "$CLI" check >"$TMP_DIR/new.out" 2>"$TMP_DIR/new.err"; NEW_CODE=$?
set -e
cmp "$TMP_DIR/base.out" "$TMP_DIR/new.out"
cmp "$TMP_DIR/base.err" "$TMP_DIR/new.err"
[ "$BASE_CODE" -eq "$NEW_CODE" ]

OUT=$(timeout 10s node "$CLI" check --json --unused-existing-compatible)
[ "$?" -eq 0 ]
printf '%s' "$OUT" | jq -e 'keys==["errors","ok"] and .ok==true and .errors==[]'

rm "$JSON_PATH"
set +e
OUT=$(node "$CLI" check --json 2>"$TMP_DIR/missing.err"); CODE=$?
set -e
[ "$CODE" -ne 0 ]
[ ! -s "$TMP_DIR/missing.err" ]
printf '%s' "$OUT" | jq -e 'keys==["errors","ok"] and .ok==false and (.errors|length)>0 and all(.errors[]; type=="string")'

printf '{invalid-json\n' > "$JSON_PATH"
set +e
OUT=$(node "$CLI" check --json 2>"$TMP_DIR/invalid.err"); CODE=$?
set -e
[ "$CODE" -ne 0 ]
[ ! -s "$TMP_DIR/invalid.err" ]
printf '%s' "$OUT" | jq -e 'keys==["errors","ok"] and .ok==false and (.errors|length)>0 and all(.errors[]; type=="string")'

cp "$BACKUP_JSON" "$JSON_PATH"
node --test sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js scripts/product-map/__tests__/product-map.test.js
echo 'Golden Path 验证通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 在临时副本中把生成 JSON 改为空文件、数组、缺 digest 的对象。
- 重复提交: 连续执行 `check --json` 两次，比较输出与 exit code。
- 中途中断: 无异步状态，N/A。
- 边界值: 同时制造 digest 不匹配与 smoke_files 缺失，确认 errors 逐项表达。
发现分级: P0/P1（非 JSON stdout、错误退出码、文本模式回归）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| JSON 成功 | `sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js` | `check --json 成功时仅输出` | 当前 CLI 忽略参数并输出文本，JSON.parse 失败 |
| 缺文件失败 | `sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js` | `缺少 product-map.json 时输出合法失败 JSON` | 当前 CLI 只写 stderr，stdout 为空 |
| 坏 JSON 失败 | `sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js` | `不可解析 product-map.json 时仍输出合法失败 JSON` | 当前 CLI 抛 SyntaxError |
| 参数兼容 | `sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js` | `与既有额外参数并存时保持 JSON 语义` | 当前 CLI 输出文本 |
| 文本兼容 | `sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js` | `不带 --json 的成功输出逐字保持` | 现状通过，作为零回归基线 |
