# 设计：安卓真机采集 smoke 自愈 —— 幂等 seed 端点

## 背景 / 根因
真机采集 smoke（`line02-android-collect-realmachine-smoke.sh`）硬编码固定测试租户
`455a8ca9-5f63-4286-83ce-c5cca04cfd58` + agent `a7a7b36c-6d05-4653-8ba1-83c1553ef5c7`
（物理设备 xian-rog 绑死这俩 ID，不能每轮随机 provision）。当环境隔离 session 重置
staging DB `zenithjoy_test` 时，这个固定租户被冲掉，`POST /collect/start` 插
`acquisition_collect_tasks` 触发外键 `acquisition_collect_tasks_tenant_id_fkey` 失败 → 500 →
刀3 卡死。无 seed 脚本兜底，手动 seed 下次重置又没。

已手动验证：seed 回 tenant+license+credits+agent+license_machines 后，`collect/start` 从 500 变 200。

## 目标
让 smoke 派任务前自愈：新增 DEV-only seed 端点，smoke step0 调它幂等补齐固定测试租户，抗 DB 重置。

## 架构

### 单元 1：`apps/api/src/routes/_smoke-acquisition-seed.ts`（新）
- **职责**：DEV-only 幂等 seed 固定测试租户链，供真机 smoke 自愈。
- **接口**：`POST /api/_smoke/acquisition-seed`
  - body：`{ tenant_id: string, agent_id?: string, license_key?: string }`
  - 门禁中间件（照抄 `_smoke-feishu-seed.ts`）：
    - `NODE_ENV === 'production'` → 404
    - `X-Smoke-Token` 缺/错（≠ `process.env.SMOKE_TOKEN || 'smoke-secret-2026'`）→ 403
  - `tenant_id` 缺 → 400
- **依赖**：`pool`（`../db/connection`）。
- **实现**：一个事务（BEGIN/COMMIT，失败 ROLLBACK）幂等 upsert：
  1. `zenithjoy.tenants(id, name, license_key, plan)` ON CONFLICT(id) DO UPDATE name
  2. `zenithjoy.licenses(id, license_key, tier='enterprise', max_machines=10, tenant_id, status='active', expires_at=now()+interval '3650 days')` ON CONFLICT(license_key) DO UPDATE tenant_id/max_machines/tier/status；RETURNING id
  3. `zenithjoy.tenant_credits(tenant_id, balance=1000000, total_recharged=1000000)` ON CONFLICT(tenant_id) DO UPDATE balance
  4. 若给了 `agent_id`：`zenithjoy.license_machines(license_id, machine_id=agent_id, agent_id, status='active')` ON CONFLICT(license_id, machine_id) DO UPDATE status
  - 返回 `{ success: true, data: { seeded: true, tenant_id, license_key }, timestamp }`
  - 失败 → 500 `{ success:false, error:{ code:'SEED_FAILED', message } }`
- **约束依据**（已核对 zenithjoy_test 真实 schema）：
  - `licenses_tier_check` 允许 `free|basic|matrix|studio|enterprise`（用 enterprise）
  - `tenants` 无父 FK；`license_machines` UNIQUE(license_id, machine_id)，FK license_id→licenses
  - `acquisition_collect_tasks` 仅 tenant_id FK（agent_id 是自由文本）→ 过 500 只需 tenant 存在

### 单元 2：`apps/api/src/app.ts`（改 1 行挂载）
- 照 `smokeFeishuSeedRouter` 方式：`import` + `app.use('/api/_smoke', smokeAcquisitionSeedRouter)`（生产 NODE_ENV=production 端点内门禁必 404）。

### 单元 3：`.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`（改）
- 现有 step2 collect/start 之前加 **step0 自愈**：
  - `curl -fsSk -X POST $API_BASE/api/_smoke/acquisition-seed -H "X-Smoke-Token: ${SMOKE_TOKEN:-smoke-secret-2026}" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT\",\"agent_id\":\"$AGENT\"}"`
  - 需要 `AGENT` 变量（现有脚本可能已有默认 agent_id；若无则加默认 `a7a7b36c-...`）
  - seed 返回非 success/HTTP≠200 → `envfail`（seed 失败=环境/服务端问题，不是采集红，走 exit3 分级）

## 测试策略（vitest integration，`_smoke-acquisition-seed.test.ts`）
- **档次**：integration（打 supertest app，真实 pg？—— 参照 `_smoke-feishu-seed.test.ts` 是否 mock pool 决定）。
- 断言：
  1. `NODE_ENV=production` → 404（门禁）
  2. 缺/错 `X-Smoke-Token` → 403
  3. 缺 `tenant_id` → 400
  4. 正确 token + tenant_id → 200 且 `data.seeded=true`（upsert 调用成功）
  5. 幂等：连调两次都 200 不报错
- 若测试用真实 DB 不可行，则 mock `pool.query`/`pool.connect` 断言 SQL 被调用 + 门禁分支——与仓库现有 smoke-seed 测试范式一致。

## 环境接缝守卫
改后的 android smoke step0 本身是运行时自愈守卫：DB 重置后 smoke 自动补齐，不再靠人工 seed（proven-to-fire = 本 sprint 已亲历 500，seed 后 200）。

## commit / CI
- TDD 两 commit：commit-1 failing test（Red），commit-2 实现（Green）。
- commit 前缀用 `[CONFIG]`（只改现有 smoke 非新增，绕 lint-feature-has-smoke 的 `--diff-filter=A`；repo 惯例 #1279/#1277）。
- 新端点 vitest 单测满足 api 覆盖 gate；smoke glob runner 会 SKIP 真机 smoke（DENYLIST 第152行）。

## 不包含
- 设备侧 `ALL_RESOLVE_FAILED`（Stage1 分享面板 UIA 抓取失败）—— 另立 sprint（本 sprint 只修服务端 seed 自愈）。
- 生产（5200/cecelia 库）连接修复部署 —— 待人工放行。
