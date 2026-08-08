# Contract Draft — W5 D5：two-column-gate.sh + selftest + promote 接线

**TASK_ID**: 11cc5f4c-9bd0-4612-bf5a-9a6b574756af
**Sprint**: W5-放行闸第三证据项双表绿(验收一体两面D5)
**Contract 版本**: v1.1（P1修复轮——selftest 五情形 + INV-1 验收命令修正）
**日期**: 2026-08-08

---

## 真机边界声明

**本 sprint 零真机、零 UI。**

- 唯一执行环境：GitHub Actions ubuntu-latest 托管 runner
- sprint-prd.md 中出现的 android/真机/安卓等名词（如「4台安卓在线」「真机租户」「account-scan 真机车道」）均为 GP 规程对已有基础设施的引用，属上下文名词，不构成本 sprint 的验收目标
- 无 self-hosted runner、无安卓设备、无浏览器操作

---

## 交付物清单

| 产物 | 类型 | 路径 |
|------|------|------|
| two-column-gate.sh | 新建 bash 脚本 | `scripts/release-gate/two-column-gate.sh` |
| two-column-gate-selftest.yml | 新建 CI workflow | `.github/workflows/two-column-gate-selftest.yml` |
| promote-all-prod.yml 接线 | 修改 CI workflow | `.github/workflows/promote-all-prod.yml`（:138 后新增证据③ step） |
| promote-dashboard sha 绑定 | 修改 CI workflow | `.github/workflows/promote-all-prod.yml`（promote-dashboard job） |
| fixture JSON 测试文件 | 新建测试 fixture | `scripts/release-gate/fixtures/*.json`（5 个：含 case-sha-mismatch） |

---

## 功能行为合约

### [BEHAVIOR-1] 双 sha 绑定断言

`two-column-gate.sh` 接收 `PROMOTE_SHA` 参数，从 cecelia Brain 只读 gate 端点取定案 run，断言 `run.backend_sha == PROMOTE_SHA`（字节精确匹配，不允许前缀截断）。任何不匹配情形 exit 1 并输出差异行。

- 前置条件：gate 端点可达，run 处于定案状态
- 期望结果：sha 匹配时继续；sha 不匹配时 exit 1，日志打印 `expected=$PROMOTE_SHA got=$run.backend_sha`

### [BEHAVIOR-2] gate_verdict 绿判断

`two-column-gate.sh` 断言 gate 响应中 `gate_verdict == "green"`。verdict 为其他值（`red`/`pending`/`undefined`）时 exit 1。

- 前置条件：run 处于定案状态（finalized）
- 期望结果：verdict green + sha 匹配 → exit 0；任一不满足 → exit 1 + 说明原因

### [BEHAVIOR-3] blocked_reason 三态机械区分

`two-column-gate.sh` 对 `blocked_reason` 字段进行三态区分：

| blocked_reason 值 | 分类 | 行为 |
|---|---|---|
| `ai_run_infra_error` | infra 故障 | 若 `bypass_two_column_infra=true` 则放行（exit 0）；否则 exit 1 |
| `undecided_cells` | cells_red | 无论 bypass 值，exit 1 |
| `null` 或其他格红 | cells_red | 无论 bypass 值，exit 1 |

bypass 仅在 infra_error 时生效；cells_red 时即使传入 `bypass_two_column_infra=true` 也必须 exit 1。

### [BEHAVIOR-4] 棘轮计数超限阻止放行

`two-column-gate.sh` 查询 cecelia Brain 历史记录，统计近 30 天以下四项计数：

- `force_reason` 强开次数
- `unverifiable` 裁决绿次数
- `waive` 频次
- `bypass` 使用次数

任意一项近 30 天 > 3 次时，当次 gate exit 1 并在 `$GITHUB_STEP_SUMMARY` 大字说明，不允许静默放行。

### [BEHAVIOR-5] --fixture 模式（selftest 专用）

`two-column-gate.sh --fixture <file>` 从本地 JSON 文件读取 gate 响应，跳过真实 HTTP 调用。行为与真实模式完全一致，仅数据来源不同。

### [BEHAVIOR-6] promote-dashboard sha 绑定闭合

`promote-all-prod.yml` 的 `promote-dashboard` job 中，若 `inputs.sha` 非空，`git reset --hard "${{ github.event.inputs.sha }}"` 而非 `git reset --hard origin/main`。前后端 sha 来自同一 input 来源，不允许 dashboard 独立漂移至 origin/main HEAD。

---

## selftest 五情形验收

`two-column-gate-selftest.yml` 独立 CI workflow，五个 step 各自构造 fixture JSON，调 `--fixture` 模式，期望退出码如下：

| 情形 | fixture 文件 | 期望 |
|------|--------------|------|
| 情形1：未定案（finalized=false） | `case-not-finalized.json` | exit 1（step 标红 = 符合预期） |
| 情形2：定案绿 + sha 匹配 | `case-green.json`（`finalized=true, gate_verdict=green, backend_sha=$PROMOTE_SHA`） | exit 0 |
| 情形3：取数失败（fixture 文件不存在，模拟不可达的近似代理） | `nonexistent.json`（文件不存在） | exit 1 |
| 情形4：infra_error + bypass=true | `case-infra-error-bypass.json`（`blocked_reason=ai_run_infra_error, bypass_two_column_infra=true`） | exit 0 |
| 情形5：cells_red + bypass=true → INVARIANT-2 负路径 | `case-cells-red-bypass.json`（`blocked_reason=undecided_cells, bypass_two_column_infra=true`） | exit 1（bypass 不生效） |

---

## E2E 验收

```bash
# 方式 A（主验收）：推送分支后，GitHub Actions 自动触发
# two-column-gate-selftest.yml 四情形全部符合预期退出码 → CI 绿

# 方式 B（手动执行 --fixture 本地验证）
# 见 contract-dod.md 中 manual:bash 命令

# 方式 C（promote-all-prod.yml yaml lint）
# 推送后 CI 验证 yaml 语法有效，新增 step 不破坏现有 needs 链

# 注：proven-to-fire（真实 dispatch + confirm=PROMOTE）留给发布者在下次正式放行时自然验证
```

---

## 不验收项声明

- cecelia Brain gate 端点服务端逻辑（D3/D4 已上线，本 sprint 只做 HTTP 调用端）
- D1-D4 数据层、采证器、裁决 API 任何改动
- promote-all-prod.yml 除证据③和 promote-dashboard sha 绑定外的其他 job
- 真机 E2E 脚本
- Dashboard UI

---

## 假设声明

- [ASSUMPTION-1] cecelia Brain 只读 gate 端点（J19 gate token）在 D3/D4 已上线，HTTP 调用端的 fixture 模式可完全覆盖 selftest
- [ASSUMPTION-2] `GATE_TOKEN` secret 在 zenithjoy repo 中已配置或在本 sprint 交付时配置
- [ASSUMPTION-3] `blocked_reason` 三态字段名与 D4 computeGateVerdict 实现一致
- [ASSUMPTION-4] `PROMOTE_SHA` 解析算法：`github.event.inputs.sha` 非空时直接用，否则 `git rev-parse origin/main`
