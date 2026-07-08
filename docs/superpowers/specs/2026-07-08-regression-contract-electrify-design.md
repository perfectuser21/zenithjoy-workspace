# 设计：regression-contract 值班表通电（第一刀·骨架）

日期：2026-07-08
分支：cp-07082130-regression-contract-electrify
类型：CI/CD 基础设施（dev_pipeline），非面客 Ability

## 背景与问题

zenithjoy 的"通道 B"（golden path 验收产物 → 永久回归值班表）是空壳：
- `regression-contract.yaml` 里 `core: []`、`golden_paths: []` 全空
- 没有任何 workflow 引用它
- `golden_path` Brain 表 0 行、`sprints/` 95 个测试文件从未被执行

结果：每个 Ability 的客户旅程在 merge 之后无人天天守（"验完即焚"）。

## 目标（本刀 scope）

把这条空管道**接通电并成为 required**，用一批自包含 must-never-break 种子证明它真拦。
一旦通电且 required，此后加任何 golden path 退化成"改一行 yaml 的小 PR"——这就是
"新机制自动加进去"的属性。

**不包含（留第二刀）**：windows/nightly tier、需起后端的 job、Line02 Lead / Line04 CRM /
Line05 pipeline 三条真 Ability golden path。

## 方案：照抄 Cecelia B1（无条件核心回归闸）

prior art：`/Users/administrator/perfect21/cecelia/scripts/ci/run-core-regression.sh`
+ `regression-contract.yaml` + `ci.yml` 的 `core-regression` job。三个组件一一移植：

### 组件 1：runner — `scripts/ci/run-core-regression.sh`

职责：读 `regression-contract.yaml`，按 tier（pr/release）选出 `trigger` 含该 gate 的
`golden_paths[]` 条目，逐条 `bash -c` 执行其 `test_command`。

接口：`run-core-regression.sh --tier pr|release [--contract <path>]`
- 依赖 `yq`（mikefarah）解析 yaml
- **空契约守卫**：选出 0 条 → exit 1（防"空表假绿灯"）
- 任一 `test_command` 非零 → 整体 exit 1，并打印 `FAIL: <id>`
- 全过 → exit 0，打印 `core-regression PASS`

（与 Cecelia 版逐字节对齐，仅去掉 Cecelia 特有的 invariant_ids 桥。）

### 组件 2：值班表 — `regression-contract.yaml` 播种

在 `golden_paths[]` 填入自包含 must-never-break 种子（每条 `trigger: [PR, Release]`、
`method: auto`、`must_never_break: true`）。种子选"不起后端、一行命令能在 ubuntu 裸跑"的
守卫，例如：
- 关键 CI 脚本自身语法可解析（`bash -n <script>`）
- 已存在且自包含的 lint/守卫脚本能跑通

（具体条目在实现时逐条 proven-to-fire 验证能裸跑 + 能被改坏报红后落定。）

### 组件 3：workflow — `.github/workflows/ci-core-regression.yml`

- `runs-on: ubuntu-latest`，无路径门（每个 PR 都跑）
- 装 yq（mikefarah release binary，照 Cecelia）
- PR（ref != main）跑 `--tier pr`；push main 跑 `--tier release`
- 输出一个聚合 check name `Core Regression Gate Passed`

### 组件 4：接进 required

- 新 job 显式产出 `Core Regression Gate Passed` context
- **分支保护改 required 为单独 `[CONFIG]` 动作**：PR 合并后提示用户手点，
  按 `feedback_smoke_must_wire_into_ci` 死规矩不在本 PR 直接改 branch protection

## 测试策略

| 层 | 测什么 | 怎么测 |
|---|---|---|
| **unit（shell）** | runner 逻辑：空契约→exit 1；某条 fail→整体非零；tier 选择正确 | `scripts/ci/__tests__/run-core-regression.test.sh`：喂 fixture 契约（空表 / 含必失败条目 / 全过），断言退出码 |
| **integration（proven-to-fire）** | 真把一条种子的 test_command 改坏 → job 真红 | 实现时手动破坏一次亲眼看红（记录 run id），再复原 |
| **E2E** | 不适用（CI 基础设施，无客户旅程） | — |

TDD 顺序：commit-1 先写 `run-core-regression.test.sh`（红，因 runner 不存在）；
commit-2 写 runner + 契约种子 + workflow 让其变绿。

## 验收标准（DoD）

- [ ] runner 读 yaml 选条目逐条跑；空契约 → exit 1（shell test proven）
- [ ] 故意改坏一条种子 test_command → core-regression job 真红（proven-to-fire，记 run id）
- [ ] job 产出 `Core Regression Gate Passed`，纳入 required 的动作已列给用户手点
- [ ] CI 全绿

## 影响范围

新增一个 ubuntu job（~1min，种子自包含不起后端）。无路径门 = 每个 PR 都跑。
不动现有 workflow 的行为，纯新增。
