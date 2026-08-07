# Sprint PRD — W1-AI打表器 D2：采证器白名单点火 + 判定对接 + staging 版本戳

**TASK_ID**: `557c8bf4-b873-41f6-8ea8-c1d983da0a8f`
**GP_ID**: `7790f728-f490-4243-b166-03f3250a0938`
**Journey**: 发版验收一体两面（F2 步2 加厚）
**Journey ID**: `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`
**Sprint 目录**: `sprints/w1-ai-scorer-d2`
**创建时间**: 2026-08-07

---

## 背景与定位

GP v7 已拍板（决策 `8640ef58`，2026-08-07），J17 定案候选 B：AI 打表器用**专用验收租户 + 专用抖音小号，自己发起采集、自持计时**。D1 数据层已合并主干（cecelia 1.270.0，migration 392-393），含 AI 四列/7 值状态机/36 格建行生成器/`POST /api/brain/acceptance/ai-results`（AI token, 只写 AI 列）。

D2 目标：打通**采证器（capture.mjs）→ 判定任务 → Brain ai-results 端点**这条完整链路，并补齐 staging 双端版本戳，使 36 格能全量回写零缺格。

---

## Invariant 约束

以下约束来自 GP v7 Gate A（法源决策 `fdeb48aa` + `8640ef58`），机械可断言，**任何 PR 违反其中一条即拒绝合并**。

| # | 约束描述 | 机械断言方式 |
|---|---|---|
| **INV-1** | `cells-map.mjs` 的 `action` 枚举**恰为 `{observe, trigger_collect}`**，禁止出现 `signup_flow` | `grep -c 'signup_flow' scripts/acceptance-spec/ai-run/cells-map.mjs` == 0；单测枚举值 |
| **INV-2** | `trigger_collect` 仅覆盖 **S6-c3 和 S10-c4 恰 2 格**，不多不少 | 单测断言 `CELLS_MAP.filter(c=>c.action==='trigger_collect').map(c=>c.id)` 等于 `['S6-c3','S10-c4']` |
| **INV-3** | `login.mjs` 无 `signup`/`resolveCredentials.*signup` 回落路径；无凭据时进程以非零退出，**零回写** | `grep -c 'signup\|resolveCredentials.*signup' scripts/acceptance-spec/ai-run/login.mjs` == 0；单测：无凭据入参 → exit code ≠ 0 且输出零行 ai-column |
| **INV-4** | 采证器全文不得出现私信/关注/点赞触发代码 | `grep -c '私信\|关注\|点赞\|outreach.*click\|sendMessage' scripts/acceptance-spec/ai-run/capture.mjs` == 0 |
| **INV-5** | 打表器 workflow 固定 `runs-on: ubuntu-latest`，禁止 `self-hosted`/`android-capable` label | `grep -c 'self-hosted\|android-capable' .github/workflows/acceptance-scorer.yml` == 0 |
| **INV-6** | 该 workflow 的 `secrets` 白名单**不含** `ACCEPTANCE_API_TOKEN`、`TAILSCALE_AUTHKEY`、`HK_VPS_SSH_KEY` | 解析 workflow yaml 断言白名单条目 |
| **INV-7** | Playwright 网络 allowlist 只放行 `staging-autopilot.zenjoymedia.media`，其余 abort | 单测验证 route 拦截器配置 |
| **INV-8** | `yaml` 中 `opportunistic` 集合**恰为空集**（`scenario_class=opportunistic` 零格） | 单测 `A17①`：解析 yaml，过滤 `scenario_class=opportunistic` count == 0 |
| **INV-9** | 任何格提交 `reason='scenario_not_triggered'` → Brain 端点返回 400 | 集成测试：POST ai-results 含该 reason → 响应 400 |
| **INV-10** | AI 回写**必须覆盖全部 36 个建行格，零缺格**（`machine_db` 19 格给确定判定，`human_only` 17 格回写 `reason='human_only'`） | 单测：`capture.mjs` 输出的 `ai-column.json` 格数 == 36；集成测试：POST 后 DB `SELECT count(*) WHERE run_id=:rid AND ai_verdict IS NULL` == 0 |
| **INV-11** | 开跑前自检：登录租户 == 专用验收租户 **且** `run-summary.machines_online ≥ 1` **且**含单头 `device_model` 那台机；任一不满足整轮标 `ai_incomplete` 退出 | 单测：mock 自检失败 → 进程 exit code ≠ 0 且无 ai-column 回写 |
| **INV-12** | 采证产物（截图/`ai-column.json`）不得 commit 进 repo | `git ls-files acceptance-spec/runs/` == empty |

---

## 累积 FR

以下功能需求来自 PrepPRD 的 ①-⑪ 条及 GP v7 Step 3 挂片中的 **缺失** 标注：

| FR# | 功能描述 | 来源 | 影响文件 |
|---|---|---|---|
| **FR-01** | `cells-map.mjs`：S1-c3 从 `signup_flow`/`/signup` 改为 `observe`/`/area/acquisition/accounts`；S10-c4 从 `observe` 改为 `trigger_collect`（二次同关键词采集） | PrepPRD ①⑤ / GP v7 INV-1/2 | `scripts/acceptance-spec/ai-run/cells-map.mjs` |
| **FR-02** | `login.mjs`：删除 `mode:'signup'` 分支及 signup 回落逻辑；无凭据/登录失败时抛错并以非零退出，整轮零回写 | PrepPRD ② / GP v7 Gate A ② | `scripts/acceptance-spec/ai-run/login.mjs` |
| **FR-03** | `capture.mjs`：开跑前执行双自检（登录租户 == 专用验收租户 + `run-summary` 含单头 `device_model` 那台机），任一不满足整轮 `ai_incomplete` 告警退出 | PrepPRD ⑥ / GP v7 Gate A ⑥ | `scripts/acceptance-spec/ai-run/capture.mjs` |
| **FR-04** | `capture.mjs`：`trigger_collect` 动作加白名单四条约束：(a) 目标路由 = `/area/acquisition/tasks`；(b) 参数 = 本轮关键词（来自 run 单头）；(c) 每轮触发次数 ≤ 2；(d) 不携带私信/关注/点赞参数 | PrepPRD ① / GP v7 Gate A ① | `scripts/acceptance-spec/ai-run/capture.mjs` |
| **FR-05** | `capture.mjs`：恢复 S7-c2（5分钟终态）和 S9-c2（3分钟判定）的自持轮询计时（`while (Date.now()-start < wait_budget_ms)` 每 60 秒截容，检出终态提前结束） | PrepPRD ③ / GP v7 v7 现状核验② | `scripts/acceptance-spec/ai-run/capture.mjs` |
| **FR-06** | `capture.mjs`：S4-c2 三档取数——档1：读页面掉线/上线时间戳算差值；档2：读单头 `device_reboot_at` 算差值；档3：回落 `human_only` | PrepPRD ④ / GP v7 Gate B 第4条 | `scripts/acceptance-spec/ai-run/capture.mjs` |
| **FR-07** | `capture.mjs`：实现二次同关键词采集（S10-c4 执行第二次 `trigger_collect`，对照同一视频评论覆盖情况，承载红线11） | PrepPRD ⑤ / GP v7 拍板② | `scripts/acceptance-spec/ai-run/capture.mjs` |
| **FR-08** | 打表器 workflow 新增（`.github/workflows/acceptance-scorer.yml`）：`ubuntu-latest`、Playwright 域名 allowlist、secrets 白名单 = `STAGING_ACCEPTANCE_EMAIL` + `STAGING_ACCEPTANCE_PASSWORD` + `ACCEPTANCE_AI_TOKEN`（不含 `ACCEPTANCE_API_TOKEN`） | PrepPRD ⑦ / GP v7 Gate A ④⑤ | `.github/workflows/acceptance-scorer.yml` |
| **FR-09** | staging 后端 `GET /api/version`：挂载到已有 `build-info` 路由，返回 `{ sha, version, built_at }` | PrepPRD ⑧ | 后端 `apps/server` 路由层 |
| **FR-10** | 前端 `VITE_BUILD_SHA` 注入：`deploy-dashboard-staging.yml` 改为 pin `github.sha`（去掉 `reset --hard origin/main`），前端页面可读该值（页脚或 `/admin` 显示） | PrepPRD ⑨ / GP v7 Step 1「需改 pin」 | `.github/workflows/deploy-dashboard-staging.yml`、前端组件 |
| **FR-11** | 判定任务对接：判官读 artifact 截图按屏幕所见判定 → `POST /api/brain/acceptance/ai-results`（使用 `ACCEPTANCE_AI_TOKEN`）；实现全 36 格回写零缺格（`human_only` 格回写 `reason='human_only'`） | PrepPRD ⑩⑪ / GP v7 Step 3 「结论回写缺失」 | `scripts/acceptance-spec/ai-run/capture.mjs`，判官 runbook |
| **FR-12** | Brain 端点校验加固：`reason='scenario_not_triggered'` 任何格一律 400；`reason='human_only'` 而该格 yaml 非 `human_only` 一律 400；`detail.scenarios_observed[]` 未勾齐 5 个 `mandatory` 场景码时拒收 AI 回写（409） | PrepPRD ⑩ / GP v7 九组合「server 校验」 | Brain `POST /api/brain/acceptance/ai-results` handler |

---

## NFR

| NFR# | 类型 | 描述 |
|---|---|---|
| **NFR-01** | 安全 | AI token（`ACCEPTANCE_AI_TOKEN`）只能写 AI 四列，不能写人列/修改 `submitted_by`；`ACCEPTANCE_API_TOKEN` 物理不在打表器 workflow 的 secret 白名单内 |
| **NFR-02** | 隔离 | AI 的全部点击动作只在专用验收租户内；不触达生产租户与生产小号池；Playwright route 拦截非 allowlist 域名 |
| **NFR-03** | 可观测 | 采证开跑后每 60 秒写一条结构化日志（格号/当前页面文本摘要/已处理格数）；整轮退出时输出格数与缺格清单 |
| **NFR-04** | 幂等 | `capture.mjs` 重跑时若已有本轮 artifact，可增量补写缺格而不重置已完成格 |
| **NFR-05** | 超时 | 整轮最大运行时间 ≤ 30 分钟（含 S7-c2 的 5 分钟 + S9-c2 的 3 分钟 + 二次采集的 5 分钟余量） |

---

## 真机边界声明

本 sprint 的 AI 打表器**只走 staging 后台 UI（`staging-autopilot.zenjoymedia.media`）的只读观察与受控点火**，零真机动作。

引用名词清单（PrepPRD 及 GP v7 中出现的真机相关名词）：

- **安卓设备 / 4 台安卓在线**：专用验收租户下的存量绑机，AI 只通过 staging 网页的「设备/账号」页面**观察**其在线状态，不直接操控任何安卓设备
- **专用抖音小号**：AI 通过 staging 后台发起采集后，小号由 agent/安卓设备代为执行抖音操作；AI 本身不触碰手机也不登录抖音客户端
- **`device_reboot_at`**：由员工手动重启手机并记录时刻写入单头，AI 只读取该字段，不执行重启动作
- **S5 制造掉线**：员工规定动作（手动退出登录/断网），AI 仅事后在设备/账号页观察结果
- **S11/S12 私信/派单**：恒由员工执行，AI 列对 S11-S13 系列格输出「无法验证」

**承诺：本 sprint 的 CI job 固定 `ubuntu-latest` 托管 runner，物理无法连接手机池（self-hosted 车道），零真机动作。**

---

## 验收条件（E2E 断言）

| # | 验收项 | 机械断言 |
|---|---|---|
| **AC-1** | `cells-map.mjs` action 白名单 | `grep -c 'signup_flow' cells-map.mjs` == 0；`trigger_collect` 格 == `['S6-c3','S10-c4']` |
| **AC-2** | 无凭据告警退出 | `node capture.mjs` 无 env 时 exit code != 0，无 `ai-column.json` 产出 |
| **AC-3** | 双自检失败告警退出 | mock 租户不匹配时 exit code != 0，整轮无回写 |
| **AC-4** | 全 36 格回写零缺格 | 集成测试：跑完 `ai-column.json` `length` == 36；DB `ai_verdict IS NULL` count == 0 |
| **AC-5** | `scenario_not_triggered` 被拒 | POST ai-results 含该 reason → Brain 返 400 |
| **AC-6** | staging 版本戳双端可读 | `curl staging/.../api/version` 返含 sha 的 JSON；前端页面可见 sha 字符串 |
| **AC-7** | workflow secrets 白名单 | CI yaml 中无 `ACCEPTANCE_API_TOKEN`/`TAILSCALE_AUTHKEY`/`HK_VPS_SSH_KEY` |
| **AC-8** | 二次采集覆盖对照（红线11） | S10-c4 的 `trigger_collect` 执行后，capture log 含第二次采集的页面对照记录 |

---

## 开工前提（Gate B 核对项）

在动代码前需一次性确认（首日半天内）：

1. **托管 runner 能否登录 staging**：ubuntu-latest headless chromium + better-auth 登录 staging，不通则阻塞（无 signup 降级路径）
2. **Brain 5223 端口可达性**：`ACCEPTANCE_AI_TOKEN` 从 ubuntu runner 能 POST `/api/brain/acceptance/ai-results`；不通则改走 artifact → Brain docker 内判定任务读 artifact 落库
3. **专用验收租户确认**：用 `ZenithJoy AI验收账号 (staging常驻)` 登录，确认租户标识、4 台安卓在线状态、专用小号与生产小号零交集
4. **S4-c2 三档探明**：设备/账号页是否同时显示掉线/上线时刻（档1）；仅显示上线时刻（档2）；两者都读不到（档3→回落 `human_only`）

---

## 实现顺序

```
commit-1: 写单测（INV-1~12 的 failing 断言，AC-1~8 的 failing E2E）
commit-2: FR-01 cells-map.mjs 白名单改动
commit-3: FR-02 login.mjs 删 signup 回落
commit-4: FR-03/04/05/06/07 capture.mjs 双自检 + 白名单点火 + 自持计时 + 三档取数 + 二次采集
commit-5: FR-08 workflow 新增
commit-6: FR-09 staging 后端 /api/version
commit-7: FR-10 前端 VITE_BUILD_SHA 注入
commit-8: FR-11/12 判定对接 + Brain 端点校验加固
commit-9: 让所有单测和 E2E 通过
```

---

journey_type: infra（验收工具链，无 gp_anchor）
target_environment: mac_web（本机 Playwright，localhost:5174，内网）
gp_id: 7790f728-f490-4243-b166-03f3250a0938
task_id: 557c8bf4-b873-41f6-8ea8-c1d983da0a8f
