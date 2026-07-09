# 刀B：跨 Line 接缝 nightly E2E（integration-cross-line）设计

日期：2026-07-09 · Brain task：d242b121 · decision：dc59e268 · 承接 0709 CI/CD 6站2轨刀序第 3 刀

## 问题

Line02 Lead E2E 与 Line04 CRM E2E 各有闸（PR#1189），但两条 Line 的后端从未在同一 DB/同一租户下合跑过。migrations 组合、租户链贯通、CRM 三源合并名册与获客数据共存，零覆盖。

调研坐实：两 Line 无代码级自动接缝（Line02 身份=抖音 sec_uid，Line04 身份=微信昵称，无 lead→customer 转换），真实接缝是人工链路（私信引导加企微→真人加好友→agent 扫好友入册）。故本 E2E 的接缝步只能模拟，且必须诚实标注 `[SIMULATED-JOIN]`（假绿灯纪律，同 PR#1193）。

## 方案（已选）

云端（ubuntu-latest）起真 postgres + 真 apps/api，同一租户下走通两 Line 后端链路 + 双向租户隔离断言，挂 nightly。备选「等真接缝代码出现再测」被否——接缝代码没有排期，而合跑/租户链/migrations 组合三样现在就该守。

## 组件

### 1 `.github/workflows/scripts/smoke/cross-line-seam-smoke.sh`（新建）

输入 env：`API_BASE`（默认 http://localhost:5200）、PG 连接五件套。步骤：

1. 种子（psql，`-qtAc`）：`tenants` A/B → `tenant_members`（`ci-cross-a`/`ci-cross-b`，不得进 ADMIN_FEISHU_OPENIDS）→ `service_agents`（tenant A，wx_cs_ci）→ `acquisition_keyword_tasks`（tenant A，RETURNING id）。
2. Line02 写侧（真 API）：`POST /api/acquisition/comment-score-result`，body 带 `keyword_task_id` + comments（含 `grade:"A"` 绕开 LLM 打分，CI 无 TOAPI_API_KEY）。psql 断言 `acquisition_leads` 出现该 lead 且 `tenant_id` = A。
3. `[SIMULATED-JOIN]`（psql，脚本 echo 醒目标注"此步模拟人工加微链路，非真实 RPA"）：插 `crm_customers`（tenant A，source='scan'，cs_wechat_id=wx_cs_ci，contact=lead 昵称）+ `cs_memory_messages`（注意 tenant_id 是 TEXT，用同一 uuid 字面值）。
4. Line04 读侧（真 API）：`curl -H "X-Feishu-User-Id: ci-cross-a" GET /api/crm/customers` → 断言该 contact 在名册。
5. 隔离断言：`ci-cross-b` 查 CRM 看不到 A 的客户；无头 curl 得 401；psql 断言 lead 只挂 tenant A。

### 2 `.github/workflows/integration-cross-line.yml`（新建）

- name：`[CLOUD] integration-cross-line — 跨Line接缝云端真后端E2E（接缝步SIMULATED-JOIN，非真机RPA）`
- 触发：`schedule: '30 20 * * *'`（北京 04:30，错开刀A 03:00）+ `workflow_dispatch`。`permissions: issues: write`。
- job `cross-line-e2e`（ubuntu-latest）：照抄 `e2e-line02-lead-human-handoff-windows.yml` e2e job——`services.postgres`（postgres:15）→ 建 schema+pgcrypto → 顺序跑 `apps/api/db/migrations/*.sql` → `npm run build` → `node dist/index.js`（PORT=5200，拆分式 DATABASE_* env，`BETTER_AUTH_SECRET` CI 假值，NODE_ENV=test）→ `/health` 轮询 → 跑 smoke 脚本。
- job `nightly-report`（needs 上一 job，`if: always()`，ubuntu-latest）：failure 时 `gh issue create`，前缀 **`[cross-line-red]`**（区分刀A 的 `[nightly-red]`，避免同日去重互吞），同日去重（`gh issue list --search "in:title [cross-line-red] <日期>"`），body 含 run 链接 + flaky 约定（先 rerun，连续 2 晚红=真 bug 走 /dev），最后 exit 1。
- 非 required。

## 错误路径

- migrations 任一失败 → `ON_ERROR_STOP=1` 当场红（本身即回归价值）。
- API 起不来 → health 轮询 30s 超时红，上传 `/tmp/apps-api.log` 为 artifact。
- 写侧端点静默不写（tenant 反查失败）→ 步骤 2 的 psql 断言兜住。
- flaky → Issue body 约定 rerun 一次；连续 2 晚红=真 bug。

## 测试策略

- 档位：E2E（smoke 脚本本身就是交付物）。
- commit-1 = smoke 脚本先行（对着无后端环境跑必然 fail，且 `bash -n` 过）；commit-2 = workflow 接线使其在 CI 绿。满足 lint-tdd-commit-order / lint-feature-has-smoke。
- proven to work：merge 后 `workflow_dispatch` 手动真跑一次全绿。
- proven-to-fire：dispatch 传入故意坏断言（或临时 env `FIRE_TEST=1` 断言不存在的客户）看 job 红 + `[cross-line-red]` Issue 真开出，再关闭。
- PR 标题带 `[CONFIG]`。

## 不做

- 不建 lead→customer 自动转换（无此需求排期，YAGNI）。
- 不上真机（云轨刀；真机接缝属刀D/后续 full check 缺口清单）。
- 不设 required。
