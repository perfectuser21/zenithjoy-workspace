# Sprint PRD — 放行闸第三证据项（D5）：two-column-gate.sh + selftest + promote 接线

**TASK_ID**: 11cc5f4c-9bd0-4612-bf5a-9a6b574756af
**SPRINT_DIR**: sprints/w5-release-gate-d5
**GP Anchor**: 7790f728（发版验收一体两面 · F2步2 · D5）
**base_repo**: zenithjoy
**优先级**: P1
**创建日期**: 2026-08-08

---

## OKR 对齐

- **对应 KR**：ZenithJoy 发版验收一体两面 — F2步2「部署被证明没坏」D5 交付完成
- **当前进度**：D1（数据层）/ D2（采证器）/ D3（裁剪/三token分权）/ D4（adjudication 裁决 API）已上主干
- **本次推进预期**：D5 交付 two-column-gate.sh + selftest workflow + promote-all-prod.yml 接线，闸完全闭合

---

## 背景

D1-D4 已建立完整的数据层（migration 392-393，7 值状态机，九组合矩阵 computeCellState/computeGateVerdict，36 格生成器）、D2 采证器（白名单点火/双自检/打表器 workflow/staging 版本戳）、D3 裁剪（SQL 列白名单/view 参数/跨轮闸/三 token 分权）、D4 后端（adjudication 裁决 API/hard 格裁决绿 P0 与 unverifiable 例外/聚合分流建任务/熔断）。

D5 是放行闸最后一节：从 cecelia Brain 只读 gate 端点取定案 run，断言双 sha 绑定 + gate_verdict 绿，并在 promote-all-prod.yml 接入第三证据项，使 two-column 双表绿成为 promote 前置条件。

---

## Golden Path（本次验收场景）

`promote-all-prod.yml` 触发 → release-gate job 依次查三项证据（①staging 部署绿、② nightly 真机两晚绿、**③ two-column-gate.sh 断言定案 run 双 sha 匹配 + gate_verdict 绿**）→ 三项全通才允许 promote-backend 继续。

selftest workflow（`two-column-gate-selftest.yml`）独立跑四情形自检：未定案 exit 1 / 定案绿 pass / 取数失败红 / infra_error+bypass 放行。

---

## 实现范围

### 在范围内

1. **`scripts/release-gate/two-column-gate.sh`**（新建）
   - 从 cecelia Brain 只读 gate 端点取定案 run（使用 J19 三 token 分权中的 gate token）
   - 断言 `PROMOTE_SHA == run.backend_sha`（双 sha 绑定，PROMOTE_SHA 解析算法与 promote-backend 一致）
   - 断言 `gate_verdict == green`
   - `blocked_reason` 三态机械区分：
     - `ai_run_infra_error` → infra 故障
     - `undecided_cells` / null 格红 → 证据不足（cells_red）
   - `bypass_two_column_infra` 参数：仅当 gate 自判 `ai_run_infra_error` 时生效；cells_red 时忽略输入仍 exit 1
   - 四项棘轮计数（近 30 天 > 3 次 gate exit 1 时阻止放行，留档 summary）：
     - `force_reason` 强开次数
     - `unverifiable` 裁决绿次数
     - `waive` 频次
     - `bypass` 使用次数
   - `--fixture <file>` 模式：从本地 JSON 文件读 gate 响应（供 selftest 使用，不发真实 HTTP）

2. **`.github/workflows/two-column-gate-selftest.yml`**（新建）
   - 触发：push / workflow_dispatch
   - 四情形测试（每情形构造 fixture JSON，调 `scripts/release-gate/two-column-gate.sh --fixture`）：
     - 未定案 → exit 1（阻止放行）
     - 定案绿 + sha 匹配 → exit 0（pass）
     - 取数失败（HTTP 错误）→ exit 1（红）
     - infra_error + `bypass_two_column_infra=true` → exit 0（放行）
   - CI 验收：四情形全部符合预期退出码

3. **`.github/workflows/promote-all-prod.yml`** — release-gate job 在 `:138` 之后新增 step（证据③）
   - 按证据①②既有范式，新增 step「证据③ two-column 双表绿（gate_verdict）」
   - 调用 `scripts/release-gate/two-column-gate.sh`，传 `PROMOTE_SHA`（来自 `github.event.inputs.sha` 同款解析）、`GATE_TOKEN`（secret）、可选 `bypass_two_column_infra`（新 input）
   - exit 1 时阻止 promote-backend，exit 0 继续

4. **`.github/workflows/promote-all-prod.yml`** — `promote-dashboard` job 改读 `inputs.sha`（J12-④ 前端 sha 绑定闭合）
   - 当前 `promote-dashboard` 用 `git reset --hard origin/main` 取最新 HEAD；改为：若 `inputs.sha` 非空则 `git reset --hard "${{ github.event.inputs.sha }}"`，确保前后端 sha 一致

### 不在范围内

- cecelia Brain gate 端点本身（D3/D4 已上线，只读端点已存在）
- D1-D4 数据层、采证器、裁决 API 任何改动
- promote-all-prod.yml 的其他 job（wechat/nightly 证据逻辑不改）
- 真机 E2E 脚本（本 sprint 纯 CI 脚本，零真机操作）
- Dashboard UI 改动

---

## 假设

- [ASSUMPTION: cecelia Brain 只读 gate 端点（J19 三 token 分权 gate token）在 D3/D4 已上线，本 sprint 只做 HTTP 调用端，不改服务端逻辑]
- [ASSUMPTION: GATE_TOKEN secret 已在 zenithjoy repo secret 中配置，或在本 sprint 交付时配置]
- [ASSUMPTION: `PROMOTE_SHA` 解析算法与 promote-backend 一致：`github.event.inputs.sha` 非空时直接用，否则取 `git rev-parse origin/main`]
- [ASSUMPTION: blocked_reason 三态由 D4 computeGateVerdict 生成，JSON 字段名与 D4 实现一致]

---

## 真机边界声明

**本 sprint 零真机、零 UI。**

PrepPRD 及 GP proposal_doc 中出现的 android/真机名词（如「4台安卓在线」「真机租户」「account-scan 真机车道」）均为 GP 规程中对已有基础设施的引用，属上下文名词，不构成本 sprint 的验收目标。

本 sprint 唯一执行环境：GitHub Actions ubuntu-latest（标准托管 runner），无 self-hosted、无安卓设备、无浏览器操作。

---

## NFR 约束

- `scripts/release-gate/two-column-gate.sh` 无外部依赖（只用 `curl` + `jq` + `bash`），可在标准 ubuntu-latest runner 上运行
- selftest workflow 全程不发真实 HTTP（使用 `--fixture` 模式），CI 可在无外网访问的场景下运行
- promote-all-prod.yml diff 增量 < 40 行，新增 step 不引入新 job

---

## Invariant 约束

- [INVARIANT-1] 证据③仅新增，不替换证据①②；三证据全部通过才允许 promote-backend 继续
- [INVARIANT-2] `bypass_two_column_infra` 只在 gate 响应 `blocked_reason == ai_run_infra_error` 时生效；`blocked_reason == undecided_cells` 或 null 格红时，即使 bypass=true 也必须 exit 1
- [INVARIANT-3] 棘轮计数：四项（force_reason/unverifiable/waive/bypass）近 30 天各自 > 3 次时，当次 gate exit 1 并在 summary 大字说明，不允许静默放行
- [INVARIANT-4] PROMOTE_SHA 双 sha 断言：`run.backend_sha` 必须与输入 PROMOTE_SHA 字节相等（不允许前缀截断匹配）
- [INVARIANT-5] `promote-dashboard` 改读 `inputs.sha` 后，与 promote-backend 的 sha 必须来自同一 input 来源（不允许 dashboard 独立漂移至 origin/main HEAD）
- [INVARIANT-6] secrets（GATE_TOKEN）不硬编码、不进日志、不进 git

---

## 累积 FR（本 line 已验收行为，本 sprint 不得回退）

- [FR-D1] AI 验收 run 记录双列结构（ai_column / human_column）+ 7 值状态机 + 36 格生成器 + computeCellState/computeGateVerdict 九组合矩阵（migration 392-393）
- [FR-D2] 采证器白名单点火 + 双自检 + 打表器 workflow + staging 版本戳（zj#1623）
- [FR-D3] SQL 列白名单 / view 参数 / 跨轮闸 / 三 token 分权 / 5223 人列写端点下线（cecelia#4714）
- [FR-D4] adjudication 裁决 API / hard 格裁决绿 P0 与 unverifiable 例外 / 聚合分流建任务 / 熔断（cecelia#4715）
- [FR-promoteGate-①] release-gate job：证据① staging 部署最近一次必须 success
- [FR-promoteGate-②] release-gate job：证据② nightly 真机最近 2 晚绿且最新 < 36h（可 waive_nightly 豁免）
- [FR-promoteTag] promote 成功后自动打 `release-YYYYMMDD-N` tag + GitHub Release

---

## E2E 验收

```bash
# 验收方式：GitHub Actions CI 全绿即验收通过
# 本 sprint 全部验收点均在 CI 内自动执行，无需手动操作

# 1. two-column-gate-selftest.yml — 四情形全绿
#    触发：push / workflow_dispatch
#    验收：四个 step 各自返回预期退出码：
#      - 未定案 fixture → exit 1 (step 标红 = 符合预期，job level expect-fail)
#      - 定案绿 fixture → exit 0
#      - 取数失败 fixture → exit 1
#      - infra_error + bypass=true fixture → exit 0

# 2. promote-all-prod.yml — yaml 语法有效，lint 通过
#    新增 step「证据③」语法正确，不破坏现有 needs 链

# 3. PR 标题带 [CONFIG]，CI 全绿

# 注：proven-to-fire 验证（真实 dispatch 打 confirm=PROMOTE）留给发布者在下次正式放行时自然验证
```

---

## 关联决策

- `fdeb48aa`：GP 法源六条
- `8640ef58`：2026-08-07 三呈批项拍板（J17=候选B / S5/S10 mandatory / S13-c4 受控注入）
- `2f11ae25`：envfail 与真机验证失败同级计红，不准包装成绿

---

journey_type: infra_ci
target_environment: local_api
journey_id: 2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6
step_id: 817f59f5-02ff-4a70-bd81-f7ae65f77e02
