# regression-contract 值班表通电（骨架） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 zenithjoy 空的 regression-contract.yaml 值班表接通电，成为 required 聚合闸，用自包含 must-never-break 种子证明它真拦。

**Architecture:** 照抄 Cecelia B1 无条件核心回归闸——runner 脚本读 yaml 按 tier 选条目逐条跑 test_command（空契约→exit 1，任一失败→exit 1）；新 ubuntu workflow 无路径门每 PR 跑；产出 `Core Regression Gate Passed` context 待纳入 required。

**Tech Stack:** bash、yq(mikefarah)、GitHub Actions

---

## File Structure

- Create: `scripts/ci/run-core-regression.sh` — 值班表执行器（读 yaml、按 tier 选、逐条跑）
- Create: `scripts/ci/__tests__/run-core-regression.test.sh` — runner 的 shell 单测（fixture 驱动）
- Create: `.github/workflows/ci-core-regression.yml` — ubuntu job，装 yq，PR/main 跑对应 tier
- Modify: `regression-contract.yaml` — golden_paths[] 播种 3 条自包含种子
- Create: `.github/workflows/scripts/smoke/core-regression-smoke.sh` — feat PR smoke 强制（跑 runner 自测）

---

### Task 1: runner 的 failing shell 单测

**Files:**
- Test: `scripts/ci/__tests__/run-core-regression.test.sh`

- [ ] **Step 1: 写失败的测试**

测试内容（fixture 驱动，四个 case）：
- case1 空契约 yaml（golden_paths: []）→ 断言退出码 1（空契约守卫）
- case2 含一条 test_command 为 `false` 的条目 → 断言退出码 1
- case3 含一条 test_command 为 `true` 的条目 → 断言退出码 0
- case4 条目 trigger 仅 [Release]，用 `--tier pr` 跑 → 选出0条 → 断言退出码 1

脚本骨架：
```
#!/usr/bin/env bash
set -uo pipefail
RUNNER="$(dirname "$0")/../run-core-regression.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail=0
check(){ if [ "$2" = "$3" ]; then echo "  ok: $1"; else echo "  FAIL: $1 (want=$2 got=$3)"; fail=1; fi; }
# 四个 case 写 fixture yaml 到 $TMP，逐个 bash "$RUNNER" --tier .. --contract .. ; check 退出码
[ $fail -eq 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bash scripts/ci/__tests__/run-core-regression.test.sh`
Expected: FAIL（runner 不存在）

- [ ] **Step 3: commit（commit-1 红）**

```
git add scripts/ci/__tests__/run-core-regression.test.sh
git commit -m "test(ci): core-regression runner 单测（Red）"
```

---

### Task 2: runner 实现让测试变绿

**Files:**
- Create: `scripts/ci/run-core-regression.sh`

- [ ] **Step 1: 写 runner（照抄 Cecelia B1，去掉 invariant 桥）**

逻辑：
1. 解析 `--tier pr|release`、`--contract <path>`（默认 regression-contract.yaml）
2. tier=release → GATE=Release，否则 GATE=PR
3. 无 yq → exit 2；契约文件不存在 → exit 2
4. `yq -r ".golden_paths[] | select(.trigger[] == \"$GATE\") | .id"` 取 id 列表
5. id 列表为空 → 打印"选出0条（空契约守卫触发）" + exit 1
6. 逐个 id 取 test_command，`bash -c "$cmd"`，失败则 rc=1 并打印 `FAIL: <id>`
7. rc=0 打印 PASS，否则 FAIL；exit rc

- [ ] **Step 2: chmod**

Run: `chmod +x scripts/ci/run-core-regression.sh`

- [ ] **Step 3: 跑测试确认变绿**

Run: `bash scripts/ci/__tests__/run-core-regression.test.sh`
Expected: `ALL PASS`（本地无 yq 则 `brew install yq` 后再跑）

- [ ] **Step 4: commit（commit-2 绿）**

```
git add scripts/ci/run-core-regression.sh
git commit -m "feat(ci): core-regression runner（Green）"
```

---

### Task 3: 播种 3 条自包含种子到 regression-contract.yaml

**Files:**
- Modify: `regression-contract.yaml`（把 `golden_paths: []` 替换为 3 条）

- [ ] **Step 1: 编辑 golden_paths**

三条种子（均 trigger:[PR,Release]、method:auto、must_never_break:true）：
- SENTINEL-001 test_command: `bash -n .github/workflows/scripts/smoke/golden-path-1-smoke.sh`
- SENTINEL-002 test_command: `bash -n .github/workflows/scripts/smoke/golden-path-2-smoke.sh`
- SENTINEL-003 test_command: `bash -n scripts/ci/run-core-regression.sh`（自举守卫）

- [ ] **Step 2: 本地跑 runner 验证 3 条全过**

Run: `bash scripts/ci/run-core-regression.sh --tier pr`
Expected: `core-regression PASS (tier=pr)`

- [ ] **Step 3: proven-to-fire——改坏一条目标脚本看 runner 报红**

用 Edit 工具在 run-core-regression.sh 末尾临时插入一行制造语法错（不用 bash 重定向，避免 guard），跑 `bash scripts/ci/run-core-regression.sh --tier pr`，Expected: `FAIL: SENTINEL-003` + 退出码 1；再 Edit 复原，重跑变回 PASS。记录这次红作为 proven-to-fire 证据。

- [ ] **Step 4: commit**

```
git add regression-contract.yaml
git commit -m "feat(ci): 播种 3 条自包含 must-never-break 种子到值班表"
```

---

### Task 4: workflow 接线 + feat smoke

**Files:**
- Create: `.github/workflows/ci-core-regression.yml`
- Create: `.github/workflows/scripts/smoke/core-regression-smoke.sh`

- [ ] **Step 1: 写 smoke（feat PR 强制）**

内容：`set -euo pipefail` + 跑 `bash scripts/ci/__tests__/run-core-regression.test.sh` + 打印通过。

- [ ] **Step 2: 写 workflow**

要点：
- name: `Core Regression`；on: push main + pull_request main + merge_group
- concurrency group 按 ref，cancel-in-progress
- job `core-regression`，job name（= required context）`Core Regression Gate Passed`，runs-on ubuntu-latest，timeout 10min
- steps: checkout → 装 yq（mikefarah release binary，照 Cecelia）→ 跑 runner 单测 → PR tier（`if github.ref != refs/heads/main`）→ Release tier（`if github.ref == refs/heads/main`）

- [ ] **Step 3: chmod smoke**

Run: `chmod +x .github/workflows/scripts/smoke/core-regression-smoke.sh`

- [ ] **Step 4: 本地跑 smoke 验证**

Run: `bash .github/workflows/scripts/smoke/core-regression-smoke.sh`
Expected: 打印通过

- [ ] **Step 5: commit**

```
git add .github/workflows/ci-core-regression.yml .github/workflows/scripts/smoke/core-regression-smoke.sh
git commit -m "feat(ci): core-regression workflow 接线 + feat smoke"
```

---

### Task 5: 收尾——required 手点清单写进 PR 描述

**Files:** 无（PR 描述内容）

- [ ] **Step 1: PR body 写明合并后手点动作**

- 产出 required 候选 context：`Core Regression Gate Passed`
- 合并后用户手点（[CONFIG] 单独动作，本 PR 不改 branch protection）：把 `Core Regression Gate Passed` 加进 main 分支保护 required_status_checks.contexts
- proven-to-fire 记录：Task3 Step3 本地已见 SENTINEL-003 报红；补 CI run id
- 声明：本 PR 把 dev_pipeline 的"通道 B 值班表"从 ❌ 空壳推到 ✅ 通电+required 候选

---

## Self-Review

- **Spec coverage**：runner（Task1-2）✅ / 值班表种子（Task3）✅ / workflow（Task4）✅ / required 手点（Task5）✅ / 测试策略 unit=shell 单测(Task1)+proven-to-fire(Task3 Step3) ✅。
- **Placeholder scan**：无 TBD；CI run id 合并前补是 proven-to-fire 的合理留白。
- **Type consistency**：runner 参数 `--tier/--contract`、context name `Core Regression Gate Passed`、种子 id `SENTINEL-00x` 全文一致。
