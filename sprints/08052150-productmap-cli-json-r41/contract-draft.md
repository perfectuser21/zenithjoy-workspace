# Sprint Contract Draft (Round 2)

## Notes

- PRD 正文以 bundle `thin_prd` 为主，`sprint-prd.md` 为补充；二者无冲突。
- contract-gate: skipped (file not found, third-party repo)
- Registry 可达但快照已过期；本任务无 HTTP/DB，测试风格以 `scripts/product-map/__tests__/product-map.test.js` 的 `node:test` 为准。

## Response Schema（推导来源: PRD字面）

本任务无 HTTP 响应；CLI `check --json` 的 stdout Success/Failure 均为且仅为：

```json
{"ok":true,"errors":[]}
```

- `ok` (boolean，必填)：PRD 明确。
- `errors` (string[]，必填)：PRD 明确；成功时必须为空数组，失败时至少一个具体原因。
- 顶层 keys 必须完全等于 `["errors","ok"]`。
- 禁用字段名：N/A（PRD 未列同义禁用字段）。

## 已知约束（来自回归测试）

- `scripts/product-map/__tests__/product-map.test.js` → `T8: validateSmokeFiles — 缺失路径报错含具体路径；空文件占位报错`
- `scripts/product-map/__tests__/product-map.test.js` → `T10: loadAndValidateProductMap 对YAML语法错误返回结构化FAIL，不抛未捕获异常`
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（端点返回 Cannot GET）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | `check --json` 输出机器可解析结论；普通 `check` 不回归。 |
| NFR（做得多好） | JSON stdout 恰为一个对象；同步 CLI，无新增延迟阈值。 |
| Invariant（永不违反） | 分类数据不改；原退出码与普通文本逐字不变；失败 stdout 仍为 JSON。 |
| 判定点（怎么知道） | 进程退出码 + 对 stdout 做 `jq -e`，不依赖文本猜测。 |
| 保质期（何时过期） | CLI 参数为持续兼容接口；移除须走正式破坏性变更。 |
| 死亡告警（停了谁知道） | L2 `product-map-contract` 与本 smoke 在首个 CI 周期报红。 |
| 失败语义（挂了怎么办） | fail-closed：输出 `ok=false`、具体 errors、非零退出；不抛裸异常污染 stdout。 |
| 效果确认（已发≠已生效） | `jq` 校验字段、keys、类型和值，并独立核对真实进程退出码。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| JSON 投影缺失/损坏 | stdout 单 JSON：`ok=false`，errors 含原因；退出非零 | 是，只读检查 | 无静默降级 |
| 分类漂移/校验错误 | 汇总具体 errors；退出非零 | 是，只读检查 | 无静默降级 |
| 未知子命令 | 保持既有行为 | 是 | 不在本 Sprint 修改 |

### 输入对抗面

N/A：本任务是本地只读 CLI，不对外暴露 agent。

## GP-Anchor

GP-Anchor: line00/gp_anchor_enforcement keep-green

## 真实调用方请求 shape

生产调用方为 shell/CI：`node scripts/product-map/cli.mjs check --json`；认证 N/A，位置参数 `check` 与标志 `--json` 均来自 `process.argv`。无 HTTP header/body/Content-Type。

## 禁 mock 边清单

- CLI 进程 ↔ 真实 `scripts/product-map/lib.mjs`（测试必须启动真实 Node 子进程，不 mock loader/validator）。
- CLI 进程 ↔ 临时副本中的真实 `product-map/generated/product-map.json`（测试以缺失、损坏、漂移文件触发真实文件读取边）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

本任务只触及本地 CLI/文件系统，测试使用隔离临时副本真实执行，无真机、异步或第三方接缝；N/A。

## Golden Path

独立小路（无父路）

`check --json` → 执行真实分类检查 → 输出单个 JSON 结论 → 调用方以 jq + 退出码判门禁；普通 `check` 保持原样。

### Step 1: 调用方选择 JSON 输出
**来源**: `[FROM_PRD]` — Thin PRD「Golden Path」入口。

**可观测行为**: `check --json` 被接受，且不改变 `check` 的检查范围。

**验证命令**:
```bash
node --test --test-name-pattern='成功时' sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js
```
**硬阈值**: 测试 exit = 0；验证命令即上式。

### Step 2: 成功结论可机读
**来源**: `[FROM_PRD]` — Thin PRD 具体要求 2、3。

**可观测行为**: stdout 仅含 `{ok:boolean,errors:string[]}`，通过时 `ok=true/errors=[]` 且进程退出 0。

**验证命令**:
```bash
OUT=$(node scripts/product-map/cli.mjs check --json); CODE=$?; [ "$CODE" -eq 0 ] && printf '%s' "$OUT" | jq -e 'type=="object" and keys==["errors","ok"] and .ok==true and (.errors|type)=="array" and (.errors|length)==0 and all(.errors[]; type=="string")'
```
**硬阈值**: 单个 JSON 对象、精确 keys、exit 0；验证命令即上式。

### Step 3: 失败结论仍可机读
**来源**: `[FROM_PRD]` — Thin PRD「边界情况」。

**可观测行为**: 投影缺失、不可解析或漂移时 stdout 仍为单个 JSON，`ok=false`、errors 含具体原因、退出非零。

**验证命令**:
```bash
node --test --test-name-pattern='失败时|缺失或不可解析' sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js
```
**硬阈值**: 两类异常全部 exit 0（测试进程），每个被测 CLI exit 非 0 且 JSON 可解析；验证命令即上式。

### Step 4: 普通文本零回归
**来源**: `[FROM_PRD]` — Thin PRD 具体要求 1。

**可观测行为**: 不带 `--json` 时 stdout 与当前基线逐字一致，退出码语义不变。

**验证命令**:
```bash
node --test --test-name-pattern='逐字一致' sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js && npm run product-map:check
```
**硬阈值**: 两条命令 exit 0，stdout 字节级相等；验证命令即上式。

### Step 5: JSON 标志与既有参数并存
**来源**: `[FROM_PRD]` — Thin PRD「边界情况」要求 `--json` 与其他既有参数并存时互不干扰。

**可观测行为**: 仓库当前 CLI 没有其他业务标志；与既有 Node 运行参数 `--no-warnings` 并存时，`check --json` 仍只输出精确 JSON schema，退出码保持检查结论语义。

**验证命令**:
```bash
node --test --test-name-pattern='与既有参数并存' sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js
```
**硬阈值**: 带既有 Node 参数的真实 CLI 子进程输出与无该参数时一致，测试 exit = 0；验证命令即上式。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api（无需 DB；Fleet 的 Postgres 资源不进入合同）

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/08052150-productmap-cli-json-r41"
RED_TEST="$SPRINT_DIR/tests/product-map-cli-json.test.js"
test -f "$RED_TEST"

# 实现后完整真实链路：测试内部在仓库内建隔离副本，启动真实 CLI/loader/文件读取。
node --test "$RED_TEST"

# 直接核对当前真实仓库成功输出与退出码。
set +e
OUT=$(node scripts/product-map/cli.mjs check --json)
CODE=$?
set -e
[ "$CODE" -eq 0 ]
printf '%s' "$OUT" | jq -e 'type=="object" and keys==["errors","ok"] and .ok==true and (.ok|type)=="boolean" and (.errors|type)=="array" and (.errors|length)==0 and all(.errors[]; type=="string")'
[ "$(printf '%s' "$OUT" | wc -l | tr -d ' ')" -eq 0 ]

# 普通入口必须继续通过且输出由回归测试做逐字比较。
npm run product-map:check
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| JSON 成功/失败/边界与兼容 | `sprints/08052150-productmap-cli-json-r41/tests/product-map-cli-json.test.js` | `check --json 成功时`；`check --json 漂移失败时`；`product-map.json 缺失或不可解析时`；`不带 --json 的 check 输出与既有文本逐字一致`；`--json 与既有参数并存` | 当前 CLI 忽略 `--json`，JSON 解析/shape 断言失败 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: `check --json=1`、重复 `--json`，确认不产生多对象或裸堆栈。
- 重复提交: 连续执行十次 `check --json`，输出确定且不修改分类投影。
- 中途中断: JSON 文件读取失败时确认 stdout 仍只有合法 JSON。
- 边界值: 同时制造多个检查问题，确认 errors 每项均为具体字符串。
发现分级: P0/P1（门禁假绿或破坏普通输出）阻塞 merge；P2/P3 记录 findings 不阻塞。
