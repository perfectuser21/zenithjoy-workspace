# Sprint PRD — AI 打表器 D2（采证器白名单点火 + 判定对接 + staging 版本戳）

**Task**: 557c8bf4-b873-41f6-8ea8-c1d983da0a8f
**Sprint**: w1-ai-scorer-d2
**Date**: 2026-08-08
**GP**: 7790f728-f490-4243-b166-03f3250a0938（发版验收一体两面 · F2步2加厚）
**Journey**: 2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6（工厂 · F2 部署闭环）

---

## 真机边界声明

本单涉及的名词「安卓设备 / 4台安卓 / 手机 / 真机 / agent / 小号」均指专用验收租户下已在线的设备；AI 在本 sprint 的全部动作限于：**staging 后台 UI 只读观察** + **受控点火（专用验收租户采集入口，≤2次/轮）**。

AI 绝不执行以下动作：直接控制手机、SSH 到设备、触发手机重启、操作手机上的任何 App、发送私信/关注/点赞、跨出专用验收租户范围的任何写操作。

真机动作（S5 的「制造一次小号掉线」）仍由**员工**在 Step 2 手动执行。

---

## Invariant 约束

1. **`action` 白名单不可破坏**：`cells-map.mjs` 的 `action` 枚举运行期只能为 `{observe, trigger_collect}`；`signup_flow` 必须从代码中删除，`grep -c 'signup'` 在采证器全文必须为 0。
2. **`trigger_collect` 上限 ≤ 2 次/轮**：S6-c3（首轮采集）+ S10-c4（同关键词二次采集）恰好 2 格；任何第 3 次 `trigger_collect` 调用必须触发断言失败。
3. **无凭据不得静默 signup 回落**：无凭据 / 登录失败 → 整轮立即以 `ai_incomplete` 告警退出，不产生任何回写，不注册新账号。
4. **双自检必须先于任何采集动作**：开跑前校验「登录租户 == 专用验收租户」且「`run-summary.machines_online ≥ 1` 且含单头 `device_model` 那台机」，任一不满足 → 整轮 `ai_incomplete` 退出，零回写。
5. **禁私信/关注/点赞类动作**：采证器全文 `grep -c '私信\|关注\|点赞\|outreach.*click\|sendMessage'` 必须为 0（A11-f 机械断言）。
6. **runner 环境剥夺**：打表器 job 固定 `runs-on: ubuntu-latest`，不得含 `self-hosted` / `android-capable` label。
7. **secrets 白名单**：该 job 只能访问 `STAGING_ACCEPTANCE_EMAIL` / `STAGING_ACCEPTANCE_PASSWORD` / `ACCEPTANCE_AI_TOKEN`；`ACCEPTANCE_API_TOKEN`（能写人列）必须移出白名单。
8. **36格零缺格**：`POST /api/brain/acceptance/ai-results` 回写时，36 行格全部非空，不得有任何格缺席。
9. **`scenario_not_triggered` 零容忍**：本版 `opportunistic` 集合为空（A17 断言），任何格提交 `reason=scenario_not_triggered` → 服务端 400。判官判「场景未出现」时必须映射成流程类 reason（如 `task_not_completed` / `page_element_missing` 等），不得直译。
10. **D1 数据层不可降级**：cecelia 1.270.0 / migration 392-393 的七值状态机 / computeCellState 九组合 / 收单闸（5 个 mandatory 场景码）/ reason 域校验不得被本 sprint 改写。

---

## 累积 FR

### FR-1 capture.mjs 白名单点火（D2 核心）

**现状**：`cells-map.mjs` 含 `signup_flow`（S1-c3）和 1 个 `trigger_collect`（S6-c3）；`login.mjs` 无凭据时静默回落 signup。

**改动**：

#### FR-1a 删除 `signup_flow`，S1-c3 改 `observe`
- `cells-map.mjs` S1-c3 的 `action` 从 `signup_flow` 改为 `observe`，`route` 改为 `/area/acquisition/accounts`（看员工本轮绑的那台机）
- `capture.mjs` 中涉及 `/signup` 路由和注册逻辑的分支全部删除

#### FR-1b 无凭据整轮 `ai_incomplete` 退出
- `login.mjs` `resolveCredentials` 无凭据时不再返回 `{ mode: 'signup' }`，改为抛出异常或返回 fail 标记
- `capture.mjs` 收到无凭据信号 → 输出 `ai_incomplete` 原因至 `run-summary.json` → `process.exit(1)`，不产生任何格回写

#### FR-1c 新增 S10-c4 的 `trigger_collect`（二次采集）
- `cells-map.mjs` S10-c4 的 `action` 从 `observe` 改为 `trigger_collect`，同关键词，等待时限复用 `wait_budget_ms: 60000`
- `capture.mjs` 用户流5（线索页）之前，在 S10-c4 发起同关键词第二轮采集，对照评论覆盖情况
- 全局计数器保证 `trigger_collect` 调用总次数 ≤ 2，超过即断言失败退出

#### FR-1d S7-c2/S9-c2 自持轮询计时恢复
- 现有 `capture.mjs:168-185` 的 `while (Date.now()-start < 300000)` 自持轮询物理可用（候选 B 下 AI 到场早）
- 确认 S7-c2（5分钟终态）和 S9-c2（3分钟判定）复用该轮询，不依赖页面时间戳
- S9-c2 的 `wait_budget_ms` 从 `180000` 对应至 3 分钟轮询超时上限

#### FR-1e S4-c2 三档取数
- 档 1：设备/账号页同时可见掉线时刻与恢复上线时刻 → AI 自算差值，留 `machine_db`
- 档 2：只见恢复上线时刻 → 读单头 `detail.device_reboot_at`，AI 算差值，留 `machine_db`
- 档 3：两个时刻都读不到 → S4-c2 回落 `human_only`，run 单头注记，口径降一格（`human_only` 17→18，`machine_db` 19→18）
- `capture.mjs` 在机器页截图阶段顺序尝试三档，首档可行即停

---

### FR-2 采证前双自检（Invariant-4 的实现）

- 采集动作开始前，`capture.mjs` 调用新函数 `assertTenantAndDevice()`：
  1. 读取当前登录态的 tenant_id（从 `/api/me` 或 session 接口）与单头 `ACCEPTANCE_TENANT_ID` 对比，不等 → `ai_incomplete` 退出
  2. 读取 `run-summary.machines_online` 且机器列表包含 `ACCEPTANCE_DEVICE_MODEL` → 不满足 → `ai_incomplete` 退出
- 两条均通过后才进入采集流程

---

### FR-3 staging 后端 GET /api/version 挂 build-info

**现状**：`apps/api/src/app.ts:115` 已有 `GET /version`，返回 `getBuildInfo()`；`capture.mjs:76` 调用的是 `/api/walking-skeleton/version`（路径不一致）。

**改动**：
- 新增 `/api/version` 路由（或确认 nginx.staging.conf 代理 `/version` → `:5201/version`）使 `${STAGING}/api/version` 可访问
- `capture.mjs` 将 version 采集路径统一改为 `${STAGING}/api/version`，fail-loud（读不到 → 整轮 `ai_incomplete`，不静默忽略）
- `run-summary.json` 的 `version_stamp.backend_sha` 来自该接口的 `sha` 字段

---

### FR-4 前端 VITE_BUILD_SHA 注入 + 页面可读

**现状**：`deploy-dashboard-staging.yml` 不注入 `VITE_BUILD_SHA`；前端无构建 SHA 展示。

**改动**：
- `deploy-dashboard-staging.yml` 在 build 步骤（`[2/5]`）注入 `VITE_BUILD_SHA` 环境变量，值来源 = workflow 触发时的 `github.sha`（在 SSH script 中通过 deploy script 参数传入，或改用 workflow 级别 env 先写文件再 rsync）
- 前端 `apps/dashboard/src/` 在页面某处（如 footer 或 `/version` 路由）展示 `import.meta.env.VITE_BUILD_SHA`（若为空显示「unknown」）
- `deploy-dashboard-staging.yml` 改 pin `github.sha`：脚本里的 `git reset --hard origin/main` 之后额外断言当前 commit 等于触发本次 workflow 的 `github.sha`（通过 SSH script 传入参数做断言）

---

### FR-5 打表器 workflow（ubuntu-latest + Playwright allowlist + secrets 白名单）

新建 `.github/workflows/ai-acceptance-capture.yml`：

```yaml
runs-on: ubuntu-latest          # 不得含 self-hosted
env:
  PLAYWRIGHT_BROWSERS_PATH: 0
jobs:
  capture:
    # Playwright 域名 allowlist（限于必要的 staging + CDN）
    # secrets 白名单
    env:
      STAGING_ACCEPTANCE_EMAIL: ${{ secrets.STAGING_ACCEPTANCE_EMAIL }}
      STAGING_ACCEPTANCE_PASSWORD: ${{ secrets.STAGING_ACCEPTANCE_PASSWORD }}
      ACCEPTANCE_AI_TOKEN: ${{ secrets.ACCEPTANCE_AI_TOKEN }}
      # ACCEPTANCE_API_TOKEN 不在此列
      # TAILSCALE_AUTHKEY 不在此列
      # HK_VPS_SSH_KEY 不在此列
```

- 上传 CI artifact：`acceptance-spec/runs/<版本戳>/`（截图 + `pending-judgments.json` + `run-summary.json`）

---

### FR-6 判定任务读 artifact 截图 → POST ai-results

- 判官（AI 判定任务）从 CI artifact 下载证据包
- 按 `judge-runbook.md` 规程逐格判定（依据 = 截图与页面文本所见，不查库）
- 判定完成后 `POST /api/brain/acceptance/ai-results`，携带 `ACCEPTANCE_AI_TOKEN`（专用 AI token，只写 AI 四列）
- 36 格全部回写，零缺格（Invariant-8）
- 场景类 reason 禁止直译 `scenario_not_triggered`，必须映射为流程类（Invariant-9）

---

### FR-7 规程 yaml 进 Brain 容器

三选一（开工首日 Gate B 确认）：
- 方案 A：volume mount（Brain docker-compose 挂 `scripts/acceptance-spec/` 目录）
- 方案 B：构建期拷贝（Brain 容器 Dockerfile `COPY`）
- 方案 C：落库（ACCEPTANCE_SPEC_PATH env 指向 DB 里的 yaml 字段）

`ai-results` 端点读 `ACCEPTANCE_SPEC_PATH` env，不存在 → fail-loud 500，不静默接收。

---

## NFR

| 项 | 要求 |
|---|---|
| 运行时间 | 采证一轮全程 ≤ 15 分钟（ubuntu-latest runner，含两轮采集等待） |
| 证据保留 | artifact 保留 ≥ 30 天；不 commit 进 repo（含 `ai-column.json` / 截图） |
| 凭据安全 | `ACCEPTANCE_EMAIL/PASSWORD` 不落日志；`run-summary.json` 不含密码字段 |
| 幂等性 | 同一 run-key 重跑覆盖写，不重复建行 |
| 租户隔离 | 全部写操作只发生在专用验收租户内；跨租户写视为 P0 bug |

---

## Gate B 开工前置（首日必查，半天内出结论）

1. **托管 runner 登录可行性**：ubuntu-latest headless chromium 完成 better-auth 登录（先例只有 `curl`，需真跑一次验证）。不通 → 登记回落方案（不得落回 self-hosted）。
2. **S4-c2 时刻可读性**：设备/账号页能否同时显示掉线时刻与恢复时刻（档 1）；不能 → 确认员工可否填 `device_reboot_at`（档 2）；都不行 → 档 3 回落。
3. **专用验收租户隔离核对**：1Password 的常驻账号是否就是「专用验收租户」 + 绑定的抖音小号是否与生产小号零交集 + 哪台机承接 AI 发起的采集（指定 vs 轮询）。
4. **规程 yaml 进 Brain 容器方案**：三方案选一，确认 `ACCEPTANCE_SPEC_PATH` 可读后才允许判定任务开跑。

---

## E2E 验收（Final）

```bash
# 1. 采证器单测（机械断言）
cd scripts/acceptance-spec && node --experimental-vm-modules ../../node_modules/.bin/jest ai-run/__tests__/

# 2. action 枚举断言
node -e "import('./ai-run/cells-map.mjs').then(m => {
  const actions = [...new Set(m.CELLS_MAP.map(c=>c.action))].sort();
  console.assert(JSON.stringify(actions)==='[\"observe\",\"trigger_collect\"]','action 枚举不符');
  const tc = m.CELLS_MAP.filter(c=>c.action==='trigger_collect');
  console.assert(tc.length===2,'trigger_collect 格数不为 2，实际:'+tc.length);
  console.log('PASS: action 枚举 + trigger_collect ≤2');
})"

# 3. signup 禁用断言
grep -c 'signup' scripts/acceptance-spec/ai-run/capture.mjs scripts/acceptance-spec/ai-run/login.mjs
# 期望全部输出 0，任何非 0 → FAIL

# 4. workflow secrets 白名单断言（smoke 解析 yaml）
grep 'ACCEPTANCE_API_TOKEN\|TAILSCALE_AUTHKEY\|HK_VPS_SSH_KEY' \
  .github/workflows/ai-acceptance-capture.yml && echo FAIL || echo PASS

# 5. 端到端：staging 采证一轮
ACCEPTANCE_EMAIL="..." ACCEPTANCE_PASSWORD="..." \
  node scripts/acceptance-spec/ai-run/capture.mjs \
    --staging https://staging-autopilot.zenjoymedia.media \
    --out acceptance-spec/runs/test-$(date +%s)
# 期望：
#   run-summary.json 含 machines_online≥1 + backend_sha 非空
#   pending-judgments.json 含 36 格（或规程格数），无 signup_flow 类证据
#   exit 0

# 6. POST ai-results 回写验证
# 用 ACCEPTANCE_AI_TOKEN 向 Cecelia Brain POST 一个测试 run，断言：
#   - 36 格全部回写（`SELECT count(*) FROM acceptance_cells WHERE run_id=... AND ai_result IS NOT NULL`）
#   - scenario_not_triggered reason → 400（发一条测试请求验证）
#   - 无 ACCEPTANCE_API_TOKEN 权限写人列（403 / 401）
```

---

## 变更文件清单（预期）

| 文件 | 改动类型 |
|---|---|
| `scripts/acceptance-spec/ai-run/cells-map.mjs` | 修改：S1-c3 `signup_flow`→`observe`；S10-c4 `observe`→`trigger_collect` |
| `scripts/acceptance-spec/ai-run/login.mjs` | 修改：删除 signup 回落，无凭据 → fail 标记 |
| `scripts/acceptance-spec/ai-run/capture.mjs` | 修改：删 signup 分支，加双自检，加二次采集，S4-c2 三档，api/version 对接 |
| `scripts/acceptance-spec/ai-run/__tests__/` | 修改/新增：action 枚举单测 + 无凭据退出单测 + trigger_collect 次数上限单测 |
| `.github/workflows/ai-acceptance-capture.yml` | 新建：打表器 workflow（ubuntu-latest，secrets 白名单） |
| `.github/workflows/deploy-dashboard-staging.yml` | 修改：注入 `VITE_BUILD_SHA=github.sha`，部署后断言 commit pin |
| `apps/dashboard/src/` | 修改：页面展示 `import.meta.env.VITE_BUILD_SHA` |

---

## 不包含（本 sprint 范围外）

- Gate B 任何一条「不通」情况的根治（登记 P2，不阻塞）
- S13-c4 频控受控注入（Gate B 第6条，维持 `unverifiable_this_version`）
- 员工验收网页（背靠背纪律，AI 列不接线到员工页）
- 真机动作（员工 Step 2 执行；AI 不触碰手机池）
- 多租户 / 生产环境的任何改动

---

journey_type: infra_acceptance
target_environment: mac_web
