# Sprint Contract Draft（首轮）

sprint: `w1-ai-scorer-d2`
task_id: `557c8bf4-b873-41f6-8ea8-c1d983da0a8f`
gp_id: `7790f728-f490-4243-b166-03f3250a0938`
journey_id: `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`
date: 2026-08-08
round: 1（首轮，无 reviewer feedback）

---

## 真机边界声明

本单 AI 动作完全限于：**staging 后台 UI 只读观察** + **受控点火（专用验收租户采集入口，≤2次/轮）**。

AI 绝不执行以下动作：直接控制手机、SSH 到任何设备、触发手机重启、操作手机上的任何 App、发送私信/关注/点赞、跨出专用验收租户范围的任何写操作。

S5 的「制造一次小号掉线」仍由**员工**在 Step 2 手动执行；AI 只负责在账号页截图观察掉线/恢复状态，不主动造场景。

theater 闸检查项：
- ✅ 本单无 self-hosted runner
- ✅ workflow secrets 白名单不含 `ACCEPTANCE_API_TOKEN` / `TAILSCALE_AUTHKEY` / `HK_VPS_SSH_KEY`
- ✅ `trigger_collect` 全局计数 ≤ 2
- ✅ 无 signup / 注册动作

---

## GP-Anchor

`line02/keyword_acquisition` — 发版验收 F2步2加厚（AI 打表器 D2）

---

## 技术上下文与推导

- **现状**：`cells-map.mjs` 含 `signup_flow`（S1-c3）且有 1 个 `trigger_collect`（S6-c3）；`login.mjs` 无凭据时返回 `{ mode: 'signup' }`，`capture.mjs` 据此走注册分支。
- **目标**：把 `action` 白名单收口为 `{observe, trigger_collect}` 两值；S1-c3 改 `observe`；S10-c4 新增第二个 `trigger_collect`；无凭据时整轮以 `ai_incomplete` 退出而不注册。
- **后端**：`apps/api/src/app.ts:115` 已有 `GET /version`，但 `capture.mjs:76` 调用路径为 `/api/walking-skeleton/version`，需统一为 `/api/version`。
- **前端**：`deploy-dashboard-staging.yml` 缺 `VITE_BUILD_SHA` 注入；前端无构建 SHA 展示。
- **workflow**：尚无 `ai-acceptance-capture.yml`；打表器需在 `ubuntu-latest` + secrets 白名单下跑。
- **判定**：判官从 CI artifact 读证据包逐格判定后，`POST /api/brain/acceptance/ai-results` 携带 `ACCEPTANCE_AI_TOKEN`（专用 AI token，只写 AI 四列），36 格全部回写零缺格。

---

## Invariant 约束（来自 PRD）

1. `action` 枚举运行期只能为 `{observe, trigger_collect}`；`signup_flow` 必须从代码中删除，`grep -c 'signup'` 在采证器全文必须为 0。
2. `trigger_collect` 上限 ≤ 2 次/轮：S6-c3（首轮采集）+ S10-c4（二次采集）恰好 2 格；任何第 3 次 `trigger_collect` 调用必须断言失败。
3. 无凭据/登录失败 → 整轮立即以 `ai_incomplete` 告警退出，不产生任何回写，不注册新账号。
4. **双自检**：开跑前校验「登录租户 == 专用验收租户 (`ACCEPTANCE_TENANT_ID`)」且「`run-summary.machines_online ≥ 1`」，任一不满足 → 整轮 `ai_incomplete` 退出，零回写。
5. 采证器全文禁私信/关注/点赞类动作：`grep -c '私信\|关注\|点赞\|outreach.*click\|sendMessage'` 必须为 0。
6. runner 必须为 `ubuntu-latest`，禁含 `self-hosted` / `android-capable` label。
7. secrets 白名单：仅 `STAGING_ACCEPTANCE_EMAIL` / `STAGING_ACCEPTANCE_PASSWORD` / `ACCEPTANCE_AI_TOKEN`；`ACCEPTANCE_API_TOKEN` 必须移出。
8. `POST /api/brain/acceptance/ai-results` 回写时，36 行格全部非空，不得有任何格缺席。
9. `scenario_not_triggered` reason → 服务端 400；判官必须映射成流程类 reason（`task_not_completed` / `page_element_missing` 等）。
10. D1 数据层（cecelia 1.270.0 / migration 392-393）不可降级。

---

## Response Schema（推导来源：PRD + 既有 API 信封）

### GET `/api/version`（staging 后端版本戳）

```json
{ "sha": "<git-sha>", "build": "<build-info>", "timestamp": "<ISO-8601>" }
```

- `capture.mjs` fail-loud：读不到 → 整轮 `ai_incomplete` 退出。
- `run-summary.json` 的 `version_stamp.backend_sha` 来自 `sha` 字段。

### POST `/api/brain/acceptance/ai-results`（判官回写）

```json
{
  "run_key": "<string>",
  "cells": [
    {
      "id": "<S{n}-c{n}>",
      "verdict": "通过|不通过|无法验证",
      "reason": "<流程类 reason，禁止 scenario_not_triggered>",
      "evidence_urls": ["<url>"]
    }
  ]
}
```

- 携带 `Authorization: Bearer <ACCEPTANCE_AI_TOKEN>`。
- 36 格全部必须在 payload 中出现（Invariant-8）。
- `scenario_not_triggered` → 400（Invariant-9）。

### `run-summary.json` 结构

```json
{
  "mode": "login",
  "account": "<email>",
  "staging_url": "<url>",
  "machines_online": 4,
  "tenant_ok": true,
  "version_stamp": {
    "captured_at": "<ISO-8601>",
    "backend_sha": "<sha>",
    "frontend_sha": "<vite-build-sha>"
  },
  "trigger_collect_count": 2,
  "ai_incomplete": false
}
```

---

## 禁 mock 边清单

- `cells-map.mjs` action 枚举 ↔ 真实文件内容（不 mock，机械断言读文件）。
- `login.mjs` 无凭据分支 ↔ 真实 `resolveCredentials` 输出（不 mock）。
- `capture.mjs` trigger_collect 计数 ↔ 真实调用路径（不 mock，单测注入假 cells-map）。
- `assertTenantAndDevice()` ↔ 真实 `/api/me` 接口（E2E 用真 staging）。
- `/api/version` ↔ 真实 staging 后端（fail-loud 断言）。

---

## Golden Path

`action 白名单收口` → `无凭据 ai_incomplete 退出` → `双自检通过才采集` → `S6-c3 首次 trigger_collect` → `S10-c4 二次 trigger_collect（同关键词）` → `version 版本戳采集` → `artifact 上传` → `判官读证据逐格判定` → `POST ai-results 36 格回写`

### Step 1: action 枚举收口，signup_flow 彻底删除

**来源**: `[FROM_PRD]` — Invariant-1（FR-1a）。

**可观测行为**: `cells-map.mjs` 中 `CELLS_MAP` 所有格 `action` 只取值 `observe` 或 `trigger_collect`；`capture.mjs` + `login.mjs` 全文无 `signup` 字样。

**验证命令**:
```bash
node -e "import('./scripts/acceptance-spec/ai-run/cells-map.mjs').then(m => {
  const actions = [...new Set(m.CELLS_MAP.map(c=>c.action))].sort();
  console.assert(JSON.stringify(actions)==='[\"observe\",\"trigger_collect\"]','action 枚举不符: '+JSON.stringify(actions));
  const tc = m.CELLS_MAP.filter(c=>c.action==='trigger_collect');
  console.assert(tc.length===2,'trigger_collect 格数不为 2，实际:'+tc.length);
  console.log('PASS: action 枚举 + trigger_collect 恰好 2 格');
})"
grep -c 'signup' scripts/acceptance-spec/ai-run/capture.mjs scripts/acceptance-spec/ai-run/login.mjs
# 期望每行均为 0，任何非 0 → FAIL
```

**硬阈值**: action 枚举深等于 `["observe","trigger_collect"]`；`grep -c signup` 全部为 0；命令非 0 即失败。

### Step 2: 无凭据整轮 ai_incomplete 退出，零回写

**来源**: `[FROM_PRD]` — Invariant-3（FR-1b）。

**可观测行为**: `resolveCredentials({}, {})` 不再返回 `{ mode: 'signup' }`，而是返回失败标记；`capture.mjs` 收到无凭据信号后写 `run-summary.json` 标 `ai_incomplete: true` 并以 `exit 1` 退出，不产生任何格 evidence 或 pending-judgments.json。

**验证命令**:
```bash
node scripts/acceptance-spec/ai-run/__tests__/login-mode.test.js 2>&1 | grep -E 'PASS|FAIL|ok|not ok'
# 关键用例："无凭据整轮 ai_incomplete 退出"
```

**硬阈值**: 无凭据路径单测通过；`capture.mjs` 无凭据运行后目录无 `pending-judgments.json`；`run-summary.json.ai_incomplete === true`；exit code 1。

### Step 3: 采证前双自检通过后才进入采集流程

**来源**: `[FROM_PRD]` — Invariant-4（FR-2）。

**可观测行为**: 开跑前 `assertTenantAndDevice()` 校验 tenant_id 与 `ACCEPTANCE_TENANT_ID` 相等且 `machines_online ≥ 1`；任一失败 → `ai_incomplete` 退出，`trigger_collect_count = 0`。

**验证命令**:
```bash
node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep -E 'PASS|FAIL|ok|not ok'
# 关键用例："tenant 不匹配时双自检使整轮 ai_incomplete 退出"
# 关键用例："machines_online = 0 时双自检使整轮 ai_incomplete 退出"
```

**硬阈值**: 两条双自检失败用例均为 PASS（即单测断言正确捕获了异常退出行为）。

### Step 4: trigger_collect 全局计数 ≤ 2，超过即断言失败

**来源**: `[FROM_PRD]` — Invariant-2（FR-1c）。

**可观测行为**: S6-c3 执行第 1 次 `trigger_collect`；S10-c4 执行第 2 次 `trigger_collect`（同关键词，`wait_budget_ms: 60000`）；若全局计数到达 3 时调用立即断言失败退出。

**验证命令**:
```bash
node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep -E 'PASS|FAIL|ok|not ok'
# 关键用例："trigger_collect 超过 2 次时断言失败退出"
```

**硬阈值**: 超出限额用例 PASS；`cells-map.mjs` 中 `trigger_collect` 格数精确等于 2（S6-c3 + S10-c4）。

### Step 5: /api/version 版本戳采集，fail-loud

**来源**: `[FROM_PRD]` — FR-3。

**可观测行为**: `capture.mjs` 从 `${STAGING}/api/version` 读取 `sha` 字段写入 `run-summary.json.version_stamp.backend_sha`；读不到 → 整轮 `ai_incomplete` 退出。

**验证命令**:
```bash
node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js 2>&1 | grep -E 'PASS|FAIL|ok|not ok'
# 关键用例："/api/version 不可达时整轮 ai_incomplete 退出"
```

**硬阈值**: 版本戳失败用例 PASS；正常路径 `backend_sha` 为非空非 `unknown` 字符串。

### Step 6: workflow secrets 白名单，禁 ACCEPTANCE_API_TOKEN

**来源**: `[FROM_PRD]` — Invariant-7（FR-5）。

**可观测行为**: `.github/workflows/ai-acceptance-capture.yml` 的 env 块仅含 3 个 secrets；`ACCEPTANCE_API_TOKEN` / `TAILSCALE_AUTHKEY` / `HK_VPS_SSH_KEY` 不出现在该 workflow 中。

**验证命令**:
```bash
grep 'ACCEPTANCE_API_TOKEN\|TAILSCALE_AUTHKEY\|HK_VPS_SSH_KEY' \
  .github/workflows/ai-acceptance-capture.yml && echo FAIL || echo PASS
```

**硬阈值**: 命令输出 `PASS`（grep 无匹配）。

### Step 7: 前端 VITE_BUILD_SHA 注入

**来源**: `[FROM_PRD]` — FR-4。

**可观测行为**: `deploy-dashboard-staging.yml` build 步骤注入 `VITE_BUILD_SHA=${{ github.sha }}`；前端某处（footer / `/version` 路由）展示该值或显示 `unknown`。

**验证命令**:
```bash
grep 'VITE_BUILD_SHA' .github/workflows/deploy-dashboard-staging.yml && echo PASS || echo FAIL
```

**硬阈值**: 命令输出 `PASS`（grep 有匹配）。

---

## E2E 验收

**journey_type**: infra_acceptance
**target_environment**: ubuntu-latest（CI runner）+ staging 后台 UI 只读

```bash
# 1. 采证器单测（机械断言）
cd scripts/acceptance-spec && node --experimental-vm-modules ../../node_modules/.bin/jest ai-run/__tests__/

# 2. action 枚举断言
node -e "import('./scripts/acceptance-spec/ai-run/cells-map.mjs').then(m => {
  const actions = [...new Set(m.CELLS_MAP.map(c=>c.action))].sort();
  console.assert(JSON.stringify(actions)==='[\"observe\",\"trigger_collect\"]','action 枚举不符');
  const tc = m.CELLS_MAP.filter(c=>c.action==='trigger_collect');
  console.assert(tc.length===2,'trigger_collect 格数不为 2，实际:'+tc.length);
  console.log('PASS: action 枚举 + trigger_collect ≤2');
})"

# 3. signup 禁用断言
grep -c 'signup' scripts/acceptance-spec/ai-run/capture.mjs scripts/acceptance-spec/ai-run/login.mjs
# 期望全部输出 0，任何非 0 → FAIL

# 4. workflow secrets 白名单断言
grep 'ACCEPTANCE_API_TOKEN\|TAILSCALE_AUTHKEY\|HK_VPS_SSH_KEY' \
  .github/workflows/ai-acceptance-capture.yml && echo FAIL || echo PASS

# 5. 单元测试：无凭据退出 + 双自检 + trigger_collect 计数上限
node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js

# 6. 端到端：staging 采证一轮（可选，需真 staging 凭据）
# STAGING_ACCEPTANCE_EMAIL="..." STAGING_ACCEPTANCE_PASSWORD="..." \
#   node scripts/acceptance-spec/ai-run/capture.mjs \
#     --staging https://staging-autopilot.zenjoymedia.media \
#     --out acceptance-spec/runs/test-$(date +%s)
# 期望：
#   run-summary.json 含 machines_online≥1 + backend_sha 非空 + trigger_collect_count=2
#   pending-judgments.json 含规程格数，无 signup_flow 类证据
#   exit 0

# 7. POST ai-results scenario_not_triggered → 400 断言
# node scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js（含回写验证用例）
```

---

## 变更文件清单

| 文件 | 改动类型 |
|---|---|
| `scripts/acceptance-spec/ai-run/cells-map.mjs` | S1-c3 `signup_flow`→`observe`，route 改 `/area/acquisition/accounts`；S10-c4 `observe`→`trigger_collect` |
| `scripts/acceptance-spec/ai-run/login.mjs` | 删 signup 回落：无凭据返回 `{ mode: 'ai_incomplete' }` 而非 `signup` |
| `scripts/acceptance-spec/ai-run/capture.mjs` | 删 signup 分支，加双自检 `assertTenantAndDevice()`，加 S10-c4 二次采集，trigger_collect 全局计数闸，api/version fail-loud |
| `scripts/acceptance-spec/ai-run/__tests__/capture-invariants.test.js` | 新建：action 枚举 + 无凭据退出 + trigger_collect 计数 + 双自检 + version fail-loud 单测 |
| `.github/workflows/ai-acceptance-capture.yml` | 新建：打表器 workflow（ubuntu-latest，secrets 白名单） |
| `.github/workflows/deploy-dashboard-staging.yml` | 注入 `VITE_BUILD_SHA=github.sha` |
| `apps/dashboard/src/` | 展示 `import.meta.env.VITE_BUILD_SHA` |

---

## 不包含（本 sprint 范围外）

- Gate B 任何一条「不通」情况的根治
- S13-c4 频控受控注入（维持 `unverifiable_this_version`）
- 员工验收网页
- 真机动作（员工 Step 2 执行）
- 多租户 / 生产环境的任何改动
- 规程 yaml 进 Brain 容器方案（FR-7 Gate B 决策前不实施）

## GP-Anchor

gp-anchor: none(infra)

> 本 sprint 属于验收基础设施改造（采证器白名单收口 + 判定对接 + staging 版本戳），非推进 Golden Path 业务步骤，显式豁免 GP 步骤绑定。
