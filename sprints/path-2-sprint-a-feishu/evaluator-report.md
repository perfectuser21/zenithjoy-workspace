# Evaluator Report — Path 2 Sprint A 飞书集成

**Evaluator**: Harness v5 阶段 B（mode = final-e2e, journey_type = user_facing）
**Branch**: `cp-05081646-path2-sprint-a-contract`
**Head SHA**: `b49d789` (TDD commit-2 GREEN)
**Run At**: 2026-05-08 17:48 CST
**Verdict**: **FAIL**（详见 §5）

---

## 1. SSOT 文件存在性 — PASS (11/11)

合同 §SSOT 列出的 11 个 SSOT 文件全部存在于 worktree。

| 文件 | 状态 |
|---|---|
| `apps/api/db/migrations/20260508_170000_tenant_feishu_bindings.sql` | OK |
| `apps/api/src/services/feishu-token.ts` | OK |
| `apps/api/src/services/feishu-bitable-multitenant.ts` | OK |
| `apps/api/src/routes/feishu-oauth.ts` | OK |
| `apps/api/src/routes/lead-config.ts` | OK |
| `apps/api/src/routes/_smoke-feishu-seed.ts` | OK |
| `apps/api/test-utils/fake-feishu-server.ts` | OK |
| `apps/dashboard/src/pages/FeishuBindTenant.tsx` | OK |
| `apps/dashboard/e2e/path-2-sprint-a.spec.ts` | OK |
| `.github/workflows/scripts/smoke/golden-path-2-smoke.sh` | OK |
| `.agent-knowledge/path-2/lead-acceptance-sprint-a.md` | OK |

---

## 2. 本地硬阈值 — 7/8 PASS

| 检查 | 结果 | 证据 |
|---|---|---|
| `apps/api` TS build | PASS | `npm run build` exit 0，无 TS 错 |
| `apps/dashboard` TS build | PASS | `npm run build` exit 0，PWA 84 entries |
| `apps/api` ESLint | PASS | `eslint src/ --max-warnings 30` → 0 errors / 30 warnings |
| **`apps/dashboard` ESLint** | **FAIL** | `eslint . --max-warnings 79` → **1 error / 75 warnings**（详见 §5.1） |
| WS2 unit tests (合同 BEHAVIOR) | PASS | `tests/ws2/feishu-token.test.ts` 6/6 GREEN |
| WS3 unit tests (合同 BEHAVIOR) | PASS | `tests/ws3/feishu-bitable-mt.test.ts` 5/5 + `tests/ws3/lead-config.test.ts` 5/5 = 10/10 GREEN |
| WS4 unit tests (dashboard BEHAVIOR) | PASS | `tests/ws4/feishu-bind-page.test.ts` 4/4 GREEN（vitest 用 esbuild tsx loader 强制） |
| WS1+WS5 integration tests | PASS | `tests/integration/ws1` 5/5 + `tests/integration/ws5` 8/8 GREEN |
| `lint-tdd-commit-order.sh` | PASS | "lint-tdd-commit-order 通过" |
| `lint-feature-has-smoke.sh` | PASS | "pass lint-feature-has-smoke -- new smoke: golden-path-2-smoke.sh" |

注：`apps/api npm test` 出现 1 个 ECONNRESET 网络抖动 (`tests/tenants.test.ts`)；隔离重跑 6/6 GREEN，确认是测试环境 flake，不归因实现。428/429 单测通过，全部 BEHAVIOR 测试 GREEN。

---

## 3. Path 1 隔离 — PASS（合同 Constraint C）

`git diff --name-only origin/main...HEAD` 不含三个 FORBIDDEN_FILES：
- `services/agent/src/handlers/qr-bind-douyin.ts` — 未改
- `apps/api/src/services/feishu-bitable.ts`（单租户原版）— 未改
- `apps/dashboard/src/pages/DouyinBindPage.tsx` — 未改
- `agent_platform_sessions` schema — migration 未触及

字节级 diff stat 为空，Path 1 完整保留。

---

## 4. Lead 自验证据 — PASS（骨架，缺真截图）

合同 Constraint B 验证命令逐条核：
- 文件存在：OK
- 大小 5873 bytes > 1024：OK
- `lead_acceptance_status: PASS` YAML：OK
- 7 个 `^### Step [1-9]`（≥ 5）：OK

**Deferred**：YAML status 为占位 `PASS`，缺真飞书租户截图 + 时间戳。Lead 必须在 xian-pc 真飞书自验后替换。本 evaluator 按合同字面只验"骨架"，符合 Constraint B 字面要求即 PASS；但合规上必须由主理人最终签字。

---

## 5. 失败项与裁决

### 5.1 BLOCKING：dashboard lint Parsing error

`apps/dashboard/tests/ws4/feishu-bind-page.test.ts:26:17` — `error  Parsing error: '>' expected`

文件以 `.test.ts` 结尾，但第 26 行含 JSX `<Page />`。dashboard 的 vitest 配置在 `vitest.config.ts:15-18` 用 `esbuild { loader: 'tsx' }` 把 `.ts` 当 `.tsx` 解析，所以**单测能跑通**；但 ESLint 没有等价覆盖（`tsParser` 见 JSX 在 `.ts` 中报错）。CI L3 `dashboard-lint` 跑 `npx eslint . --max-warnings 79`，1 error 直接 FAIL。

合同 Constraint E："commit 2：实现 + tests 全绿"。Lint 是常规绿条件之一，文件由 commit-1 引入并在 commit-2 仍存在。属于 Generator 实现问题（应改文件后缀为 `.test.tsx` 或加 eslint override）。修复极小（重命名文件 + 更新引用），但属于 Generator 范畴，evaluator 不触代码。

### 5.2 SPEC DRIFT（非 BLOCKING）：R4 ALREADY_BOUND 单测缺失

合同 Test Contract 表 WS3 行明文要求：`tests/ws3/feishu-bitable-mt.test.ts` 覆盖 "POST /api/feishu/oauth/start 在 binding 行已存在时返 400 ALREADY_BOUND"。实际该文件 0 处提及 ALREADY_BOUND，R4 仅由 smoke 脚本（line 318-324）覆盖。

裁决：**接受**（smoke 已断言）但记录 spec drift。评估时优先以 smoke 为信号源，单元层补强可在下一 sprint 补。

### 5.3 CI smoke 状态：NOT_RUN

`ci-l4-e2e-smoke.yml` / `ci-l3-code.yml` / `ci-l1-process.yml` 三个关键工作流的 trigger 都是 `pull_request: branches: [main]` 或 `push: branches: [main]`，本分支 push 既不是 main 也无 PR → 三者都没触发。GitHub 仅运行了 `deploy.yml` / `cleanup-merged-artifacts.yml` / `ci-l4-e2e-smoke.yml` 中的某些 push-to-main path 校验，0 秒 startup_failure（属于 `branches: [main]` filter 不符合直接拒）。

**Evaluator 判断**：CI smoke = NOT_RUN（不是 FAIL，也不是 PASS）。需要主理人开 PR 后自动跑。

### 5.4 总裁决：FAIL

合同 Constraint E 隐含的"全绿"包含 lint 全绿。dashboard lint 1 error 是 BLOCKING。

```
verdict = FAIL
原因：1. dashboard ESLint 1 error（commit 2 后未解决）
      2. CI smoke 未运行（无 PR），无法证明 Step 1-4 端到端绿
deferred：1. R4 单测漂移（接受 smoke 覆盖）
         2. Lead 真截图（人工补，xian-pc）
```

---

## 6. Ready to Merge 决断

**否**。两件事必须先解决：
1. Generator 修 `tests/ws4/feishu-bind-page.test.ts`（重命名 `.tsx` 或加 eslint parser override），让 dashboard lint 转绿
2. 开 PR 让 CI L4 smoke 真跑一次 Path 2 Step 1-4 PASS（合同 §约束 A 指定为 required check）
3. Lead 在 xian-pc 替换真截图（合同 §约束 B）

**可分批**：1+2 是技术阻塞，3 是人工签字。1 解决后即可 retest，2 自动跑，3 主理人在 xian-pc 完成。
