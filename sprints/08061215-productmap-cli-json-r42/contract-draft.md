# Sprint Contract Draft（Round 2）

## Notes

- contract-gate: skipped (file not found, third-party repo)
- context-manifest: unavailable（Brain 返回 404）
- 本合同仅改变 `check` 子命令与其单测，不修改 Product Map 数据、其他子命令或 CI。

## Response Schema（推导来源: PRD字面）

### Endpoint: CLI `node scripts/product-map/cli.mjs check --json`

成功或失败均向 stdout 输出且仅输出一个 JSON 对象：

```json
{"ok": true, "errors": []}
```

- `ok`（boolean，必填）：来源——PRD 明确。
- `errors`（string[]，必填）：来源——PRD 明确；成功为空数组，失败每项为具体原因。
- Schema 完整性：顶层 keys 完全等于 `["errors","ok"]`。
- 禁用字段名：`[]`（PRD 未声明同义禁用字段）。
- HTTP Error：N/A——本任务是本地 CLI，无 HTTP 响应；失败仍使用同一 JSON schema，并以非零退出码表达。

## 已知约束（来自回归测试）

- `scripts/product-map/__tests__/product-map.test.js` → T8: `validateSmokeFiles` 对缺失/空 smoke 文件必须失败，真实 smoke 必须通过。
- `scripts/product-map/__tests__/product-map.test.js` → T10: YAML 语法错误必须成为结构化诊断，不得裸异常。
- `scripts/product-map/__tests__/product-map.test.js` → T6: digest 对同一 map 必须确定。
- `[累积FR]` 本 line 暂无历史。
- context-manifest: unavailable（Brain 返回 404）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | `check --json` 输出 `{ok,errors}`，保持既有文本模式与退出码。 |
| NFR（做得多好） | JSON 模式 stdout 始终是单个可解析对象；不新增 PRD 外性能阈值。 |
| Invariant（永不违反） | 不修改 product-map 数据、其他子命令、无 `--json` 文本与原退出码。 |
| 判定点（怎么知道） | JSON parse、严格 keys/type/value、进程退出码和既有文本逐字断言。 |
| 保质期（何时过期） | CLI 参数存在期间持续有效；移除须经产品合同变更。 |
| 死亡告警（停了谁知道） | `test:product-map`/L2 product-map-contract 非零失败，CI 当次即知。 |
| 失败语义（挂了怎么办） | fail-closed：`ok=false`、具体 errors、非零退出；不得打印裸堆栈到 stdout。 |
| 效果确认（已发≠已生效） | 调用方 `jq` 读取值并同时核对退出码；失败输入在隔离副本中真执行。 |

### 判定点登记表

（本任务无外部真实状态推断或接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 检查发现 drift/schema/smoke 问题 | JSON 模式输出 `ok=false` 与逐项 errors，退出非零 | 是；只读检查 | 无降级，调用方阻塞 |
| 生成 JSON 缺失或不可解析 | 捕获并输出合法失败 JSON，退出非零 | 是 | 无裸异常或文本 stdout |

### 输入对抗面

N/A——本地 CLI 不对外暴露 agent，也不处理 prompt/不可信内容指令。

## GP-Anchor

GP-Anchor: line00/gp_anchor_enforcement keep-green

## 真实调用方请求 shape

- 生产调用方形态：Node 进程 argv，字面调用 `node scripts/product-map/cli.mjs check --json`；`check` 是 `process.argv[2]`，`--json` 在其后参数集合中。
- 认证、Content-Type、payload：N/A（本地 CLI，无网络请求）。
- 与其他既有参数并存时仍按参数集合识别 `--json`，不得改变 `check` 或其他参数含义。

## 禁 mock 边清单

- `scripts/product-map/cli.mjs check` ↔ 真实文件系统副本中的 `product-map/generated/product-map.json`（本单改变缺失/解析失败路径，测试必须真删除/真写损坏 JSON，禁止 mock fs）。
- CLI 父进程 ↔ Node 子进程 stdout/stderr/exit code（必须 `spawnSync` 真执行 CLI，禁止 mock 进程结果）。

## 未覆盖真实链路清单

（本合同无 mock、force、stub 或假数据豁免，N/A）

## 接缝清单

本任务只碰本机 Node/隔离文件系统，不含真机、第三方或生产环境接缝；逻辑断言在本地真实子进程与真实文件副本执行即可判 done，N/A。

## Golden Path

独立小路（无父路）

[入口 `check [--json]`] → [执行现有检查] → [按模式呈现结论] → [调用方解析] → [退出码判定]

### Step 1: 调用方选择 JSON 模式

**来源**: `[FROM_PRD]` — Thin PRD「Golden Path」及具体第 1、2 条。

**可观测行为**: `check --json` 成功时 stdout 仅为单行 JSON，包含且仅包含 `ok=true`、`errors=[]`。

**验证命令**: `node --test --test-name-pattern='成功时只输出' sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js`

**硬阈值**: JSON 可解析；keys=`["errors","ok"]`；`ok` 为 boolean；`errors` 为 string[]；成功退出码 0。上述命令非零即 FAIL。

### Step 2: 现有检查聚合一个或多个输入故障

**来源**: `[FROM_PRD]` — Thin PRD「边界情况」第一、三条。

**可观测行为**: 隔离副本缺少或含损坏 `product-map.json` 时，stdout 仍是失败 JSON；当 digest、Markdown 与 smoke file 同时出错时，`errors` 分别包含三个具体字符串，且每个失败对象严格只有 `errors`、`ok` 两个 key。

**验证命令**: `node --test --test-name-pattern='缺少 product-map.json|不可解析 product-map.json|多个检查问题' sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js`

**硬阈值**: 三种失败均严格 keys=`["errors","ok"]`、`ok=false`、errors 非空且逐项 string、退出码非 0；多问题场景 errors 长度至少 3 且分别描述 digest、Markdown 与 smoke file；上述命令非零即 FAIL。

### Step 3: 保持默认人类可读输出

**来源**: `[FROM_PRD]` — Thin PRD「Golden Path」具体第 1 条。

**可观测行为**: 不带 `--json` 的成功 stdout 与基线模板逐字一致，stderr 为空，退出码仍为 0。

**验证命令**: `node --test --test-name-pattern='不带 --json' sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js`

**硬阈值**: stdout 字节串精确等于既有 PASS 行（含换行）；上述命令非零即 FAIL。

### Step 4: JSON 标志不干扰既有命令参数

**来源**: `[FROM_PRD]` — Thin PRD「边界情况」第二条。

**可观测行为**: 仓库 CLI 当前没有其他 option-style flag；`--json` 与既有 `check` 位置参数共同工作，并且把同一 token 传给既有 `validate` 子命令时仍保持 validate 的原文本与退出码，证明 JSON 模式只作用于 check。

**验证命令**: `node --test --test-name-pattern='既有命令参数' sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js`

**硬阈值**: `check --json` 退出 0 且 JSON 严格等于 `{ok:true,errors:[]}`；`validate --json` 仍逐字输出既有 `PASS: product-map.yaml is valid` 文本并退出 0；上述命令非零即 FAIL。

### Step 5: 调用方用退出码完成门禁

**来源**: `[FROM_PRD]` — Thin PRD「Golden Path」具体第 3 条。

**可观测行为**: 同一真实 CLI 在有效输入返回 0，在缺失、损坏或多问题输入返回非 0，JSON 内容与退出码语义一致。

**验证命令**: `node --test sprints/08061215-productmap-cli-json-r42/tests/product-map-cli-json.test.js`

**硬阈值**: 6 个子测试全部通过且 node:test 进程退出 0；否则 FAIL。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_ATTEMPT_ID:?Runner must inject current-role attempt identity}"
: "${HARNESS_PROVIDER:?Runner must inject provider}"
: "${HARNESS_ACCOUNT:?Runner must inject account}"
: "${HARNESS_MACHINE:?Runner must inject machine}"
: "${HARNESS_MODEL:?Runner must inject model}"
: "${HARNESS_RUNNER_DIGEST:?Runner must inject runner digest}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current-role capability snapshot}"
SPRINT_DIR="sprints/08061215-productmap-cli-json-r42"
START=$(date +%s)
node --test "$SPRINT_DIR/tests/product-map-cli-json.test.js" | tee /tmp/product-map-cli-json-e2e.log
grep -q '# pass 6' /tmp/product-map-cli-json-e2e.log
grep -q '# fail 0' /tmp/product-map-cli-json-e2e.log
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -le 30 ] || { echo "FAIL: E2E 超过 30s (${ELAPSED}s)"; exit 1; }
echo "OK: check --json Golden Path 全部通过，evaluator_attempt=$HARNESS_ATTEMPT_ID snapshot=$CAPABILITY_SNAPSHOT_ID"
```

说明：本任务不依赖 Postgres，故 Fleet 的 DB_URL 资源不进入合同；E2E 用每个测试独享的仓库内临时副本，真实执行 CLI 并由 `finally` 清理。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| JSON 成功 | `tests/product-map-cli-json.test.js` | `成功时只输出 ok=true 与空 errors` | 当前实现输出人类文本，JSON.parse/退出码断言失败 |
| 缺失输入 | `tests/product-map-cli-json.test.js` | `缺少 product-map.json 时输出合法失败 JSON` | 当前实现把文本写 stderr，stdout 非 JSON |
| 损坏输入 | `tests/product-map-cli-json.test.js` | `不可解析 product-map.json 时输出具体错误 JSON` | 当前实现裸 SyntaxError |
| 默认兼容 | `tests/product-map-cli-json.test.js` | `不带 --json 时成功 stdout 与既有文本逐字一致` | 实现前作为既有行为保护（当前通过） |
| 多问题聚合 | `tests/product-map-cli-json.test.js` | `多个检查问题分别进入 errors 且失败对象严格 keys` | 当前实现首错即退出，无法聚合 |
| 参数并存 | `tests/product-map-cli-json.test.js` | `JSON 标志只作用于 check 且不干扰既有命令参数` | 当前实现未识别 `--json` |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: 将生成 JSON 写成空文件、数组或合法但缺 digest 的对象，确认 stdout 仍为合法失败 JSON。
- 重复提交: 连续执行 `check --json` 两次，确认输出与退出码确定且无状态残留。
- 中途中断: N/A（同步只读 CLI 无可恢复中间态）。
- 边界值: `--json` 与既有 command 位置参数共同出现；errors 多项时均为 string 且无重复。
- 发现分级: P0/P1（非 JSON stdout、退出码反转、默认文本回退）阻塞 merge；P2/P3 记录 findings。
