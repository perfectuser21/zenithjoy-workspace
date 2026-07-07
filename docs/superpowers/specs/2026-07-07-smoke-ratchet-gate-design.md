# Smoke 棘轮闸设计：glob runner 从 report-only 升为 PASS 基线阻断

日期：2026-07-07
Brain task：735a910d-c4ed-4e45-9d55-511aa258e8a0（Line 00 运营中枢）
PrepPRD：sprints/07072252-smoke-ratchet-gate/prep-prd.md

## 问题

`.github/workflows/scripts/smoke/` 下 204 个 smoke 脚本是历次 sprint 合同 [BEHAVIOR] 断言的沉淀物，但 merge 后无人持续跑。`ci-smoke-glob-runner.yml` 目前 report-only（job 级 `continue-on-error: true`，不在 required checks），2026-07-07 run 28861827802 报告 TOTAL=200 PASS=56 FAIL=144 SKIP=4——144 个已漂移无人守。workflow 头注释自承"稳定后再 ratchet 成必跑闸（下一步，非本 PR）"，本设计就是那一步。

直接翻闸会全线飘红，故用棘轮：锁住现在能过的，存量债分批清偿，新债不许欠。

## 设计

### 1. 基线文件 `.github/workflows/scripts/smoke-baseline.txt`

- 55 行，一行一个脚本文件名，排序。来源 = run 28861827802 实际 PASS 的 56 个减去 `manual-verify-douyin.sh`（该脚本 `MANUAL_VERIFY!=1` 时恒 `exit 0`，CI 下是永绿占位，无守护意义，不纳入）。
- 语义：基线内 = 必须一直绿；基线外 = 存量债，FAIL 只报告。

### 2. `ci-smoke-glob-runner.yml` 改造（workflow 更名 "Smoke Glob Gate"）

**runner job（原 smoke-glob-runner）**：
- 去掉 job 级 `continue-on-error: true`。
- 执行循环改判定逻辑：
  - 脚本 FAIL 且在基线 → 重试 1 次（sleep 5 后）；仍 FAIL → `GATE_FAIL` 计数 + `::error::` annotation。
  - 脚本 FAIL 且不在基线 → `::warning::` annotation（债，计数进 summary）。
  - 基线条目在磁盘不存在或落在 DENYLIST → `GATE_FAIL`（防"删/挪脚本绕闸"）。
- per-script timeout 默认 90s 不变；`wechat-rpa-real-agent-smoke.sh` 单独放宽到 240s（脚本内含 npm install + build，审查实证是最大 flaky 源）。
- 结束：`GATE_FAIL > 0` → exit 1。summary 保留并增加「基线 N/55 绿、存量债 FAIL M」两行。
- 触发（on:）不变：push main / pull_request / schedule 每日 / dispatch。nightly 基线红 = drift 告警。

**新 job `baseline-lint`**（`if: github.event_name == 'pull_request'`，`fetch-depth: 0`）：
- 新脚本必进基线：`git diff --name-only --diff-filter=A origin/main...HEAD` 中新增的 `.github/workflows/scripts/smoke/*-smoke.sh`，文件名必须出现在 smoke-baseline.txt，否则红（新债不欠）。
- 基线删行需声明：`git diff origin/main...HEAD -- smoke-baseline.txt` 有删除行时，PR body（经 `${{ github.event.pull_request.body }}` env 注入，照抄 notion-sync.yml 惯例）必须含 `BASELINE-REMOVE:` 字样，否则红。
- diff 写法照抄 `lint-feature-has-smoke.sh`（origin/main + git fetch）。
- 实现为独立脚本 `.github/workflows/scripts/lint-smoke-baseline.sh`，workflow 只做薄调用。

**新聚合 job `gate`**（name: `Smoke Glob Gate Passed`）：
- 照抄 ci-l1-process.yml `l1-passed` 模式：`if: always() && github.event_name == 'pull_request'`，needs [runner, baseline-lint]，任一 result != success → exit 1。
- 该名字是 required check 的稳定锚点；已确认与现有 6 个 required contexts 不撞名。

### 3. 存量债分类报告 `docs/smoke-debt-report.md`

从 run 28861827802 日志离线生成，144 条全列，按失败特征分三类：
- **环境类**（`got 000` / 不可达 / ECONNREFUSED / 依赖未起的服务）→ 候选进 DENYLIST 或需在 runner 内补起服务；
- **断言类**（expected X got Y / 业务断言失败）→ 真 drift，待修；
- **超时类**（rc=124）。
每条含：脚本名、exit code、末行报错摘要、分类、建议处置。本 PR 只分类不修。

### 4. merge 后动作（不在 PR 内）

`gh api` 把 `Smoke Glob Gate Passed` 追加进 main branch protection required_status_checks。

## 不做（YAGNI）

- 不修任何存量 FAIL 脚本（后续按债务报告分批）。
- 不做基线自动扩充（脚本转绿后由人/后续 PR 手动加行）。
- 不加多次重试/隔离重跑机制（重试 1 次已覆盖瞬断；观察一周再定）。

## 测试策略（integration 档）

被测物是 CI 行为本身，无单元测试面，验证全部走真 workflow：

1. **本 PR 自证（绿路径）**：PR 的 CI 里 Smoke Glob Gate 必须绿——55 个基线脚本全过 + baseline-lint 过（本 PR 自身新增了 baseline 文件属新增行，无删除行）。
2. **proven-to-fire（红路径，merge 前在测试分支验证，验后关闭不合并）**：
   - fire-1：故意破坏基线内 1 个脚本（如往 wechat-cs-hardening-smoke.sh 加 `exit 1`）→ runner 红、gate 红。
   - fire-2：新增 `zz-test-fire-smoke.sh`（exit 0）但不加进 baseline → baseline-lint 红。
   - fire-3：从 baseline 删 1 行且 PR body 不带 BASELINE-REMOVE: → baseline-lint 红。
3. 验收对齐 PrepPRD：上述三红一绿全部截图/run 链接留证进 PR body。

## 风险与缓解

- 基线内脚本 flaky 卡 PR → 重试 1 次 + wechat-rpa-real-agent 放宽 timeout；仍偶发则从基线移出（走 BASELINE-REMOVE 流程，留痕）。
- 聚合门 skipped 判定错误 → 已规定照抄 l1-passed，PR-only，不裸比 `!= "success"`。
