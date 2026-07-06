# CI 可信化修复设计 — 坏 YAML×2 / L1 解析闸 / WeChat 真机闸 required 化

日期：2026-07-06 · Brain Task：1a45c0e9 · Issues：f194490f（CI 闸失效）/ e6203ac4（UIA 死区不自愈，另 PR）

## 背景与根因（0706 实证）

1. **`WeChat CS Hardening — E2E` job3（rog 真机气泡闸）自 07-04 19:08 后 40+ 次全红且非 required** → 所有 PR（含 #1105/#1107）顶红合并。红是诚实的：rog 上有一个 UIA 死区微信实例（启动时 SPI 标志未置位）挂了 ~40h，07-06 09:28 listener 进程重启带标志拉起新微信后痊愈。机器侧不自愈是独立 bug（issue e6203ac4，另 PR 修 listen_chat）。CI 侧问题 = 闸不 required + gate 无重试采样瞬态 + 报错不区分「微信没跑」和「UIA 死区」。
2. **`agent-preflight-hardening-e2e.yml` 每次 push 秒红**：E2E-3 的 PowerShell here-string 内容顶格（L175-179）跳出 `run: |` 块缩进 → YAML 解析失败 → GitHub 对每次 push 生成无 job 的 failure run（paths 过滤失效）。E2E-1/E2E-7 的 here-string 经 YAML strip 后终结符在行首，双合法，无需改动（终审 pyyaml 渲染实证）。
3. **`cleanup-merged-artifacts.yml` 生来即坏**（创建 commit 92c6690f 即含多行 commit message 顶格行破坏块缩进），从未成功运行过；其核心设计「git push 直推 main」与分支保护（required checks + 禁直推）根本不兼容，修好 YAML 也会换一种方式红。main 上已积 37 个 `.prd-*/.task-*` 残留，全部是 2026-05 遗产，生成来源（旧 /dev 流程）已不存在。

## 改动清单

### 1.（删）cleanup-merged-artifacts.yml + 37 个 `.prd-*/.task-*` 残留
- 删 workflow 文件；`git rm` 全部 37 个残留文件（一次性完成该 workflow 的历史使命）。
- 不加新 ratchet：无新增来源（最新残留 2026-05-20），YAGNI。

### 2.（修）agent-preflight-hardening-e2e.yml
- 仅将 E2E-3 的 4 个顶格行重缩进到块基准列 10（strip 后回行首，PowerShell/python 双约束满足），em-dash 换 ASCII。
- 本地预验证：`yaml.safe_load` 通过 + Linux 侧断言脚本本地跑通。

### 3.（新）L1 加 `lint-workflow-yaml-parse`
- `ci-l1-process.yml` 新 job：`pip install pyyaml` 后对 `.github/workflows/*.yml` 逐个 `yaml.safe_load`，任一失败 → 红，输出文件名+行号。
- 纳入 `L1 Process Gate Passed` 的 `needs`（L1 已是 push+PR 双触发）。
- **proven-to-fire**：commit-1 只加 lint 与测试（本地对当前两个坏文件跑，亲眼红，证据进 PR 描述）；commit-2 修/删文件后变绿。

### 4.（重构+required 化）wechat-cs-e2e.yml
- 去掉 `pull_request.paths` 过滤（required context 必须每个 PR 都产生结论，否则卡 expected）。
- 新增 `changes` job（ubuntu，手写 git diff（三点 merge-base 语义）+ grep 正则）：输出 `agent_or_api`（services/agent/** ∪ apps/api/** ∪ 本 workflow）与 `agent`（services/agent/** ∪ 本 workflow）。
- job1 `if: needs.changes.outputs.agent_or_api == 'true'`；job2/job3（self-hosted rog）`if: needs.changes.outputs.agent == 'true'`。
- 新增聚合 job **`WeChat CS Gate Passed`**（ubuntu，`needs: [changes, job1, job2, job3]`，`if: always()`）：needs 结果含 failure/cancelled → exit 1；success/skipped → exit 0（与 L1/L2 Gate Passed 同款）。
- **合并后**：`gh api -X PATCH .../branches/main/protection/required_status_checks` 把 `WeChat CS Gate Passed` 加进 contexts（共 6 个）。403 → 输出手动步骤给用户。
- 有意设计：rog runner 掉线/微信死区时，碰 agent 路径的 PR 会被卡住 —— 这就是真机闸的意义；不相关 PR 秒绿不占 rog。

### 5.（韧化）selfcheck_bubbles.py 找窗口状态机
- 顺序：找 mmui → 找不到时：查 `Weixin.exe` 进程（tasklist）→ 无进程 → 立即红 `NO_PROCESS（微信没跑）`；有进程 → 设 SPI 屏幕阅读器标志（复用 wechat-rpa 现有 helper）→ 重试（6 次 × 12s（72s，测试断言 60-180s 区间））→ 仍找不到 → 红 `UIA_DEAD（进程在但 UIA 找不到主窗口 = 机器死区，需自愈/人工）`。
- 纯函数 `classify_no_window(process_running: bool) -> (code, err文案)` + 重试参数常量，pytest 放 `services/agent/wechat-rpa/tests/test_selfcheck_gate_state.py`。
- **非目标**：gate 不重启微信（观察者不动手；自愈归 listen_chat，issue e6203ac4 另 PR）。

## 测试策略（四档）
- **E2E**：本 PR 自身触发 wechat-cs-e2e（job3 真机，rog 当前健康）与 agent-preflight-hardening（paths 含自身）真跑绿；合并后 main 上两个原坏 workflow 出正常 job 级 run（或消失——cleanup 已删）。
- **integration**：L1 lint 解析全部 workflow 文件（修复后 58 个）。
- **unit**：`classify_no_window` pytest；lint 对坏样本 proven-to-fire（commit-1 本地红证据）。
- **trivial**：删 cleanup workflow + 37 残留文件。

## Commit 顺序（TDD）
1. commit-1（test/Red）：L1 lint job + `test_selfcheck_gate_state.py`（对现状必红：lint 报两个坏文件；pytest 报 classify 不存在）。
2. commit-2（impl/Green）：修 preflight-hardening、删 cleanup+残留、selfcheck 状态机实现、wechat-cs-e2e 重构。

## 风险与回滚
- required 化误伤：从 contexts 移除该 check 一条 gh api 即回滚。
- preflight-hardening 修活后若 Windows job 内容性失败：在本 PR 内修到绿（paths 含自身，PR 上必真跑）。
- PR 标题带 `[CONFIG]`（触碰 .yml 的硬规矩）。
