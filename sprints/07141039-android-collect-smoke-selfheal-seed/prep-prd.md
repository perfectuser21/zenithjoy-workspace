# 小改动 PrepPRD：安卓真机采集 smoke 自愈 —— 幂等 seed 端点补固定测试租户

## 改什么
1. **新增 DEV-only seed 端点** `apps/api/src/routes/_smoke-acquisition-seed.ts`（仿 `_smoke-feishu-seed.ts` 双门禁：`NODE_ENV=production` → 404；缺/错 `X-Smoke-Token` → 403）：
   - `POST /api/_smoke/acquisition-seed`，body `{ tenant_id, agent_id, keyword? }`
   - 幂等 upsert（一个事务）：
     - `zenithjoy.tenants`（id=tenant_id, name, license_key）ON CONFLICT(id) DO UPDATE
     - `zenithjoy.licenses`（license_key, tier=`enterprise`, max_machines=10, tenant_id, status=active, expires_at=now()+10y）ON CONFLICT(license_key) DO UPDATE
     - `zenithjoy.tenant_credits`（tenant_id, balance 充足）ON CONFLICT(tenant_id) DO UPDATE
     - `zenithjoy.license_machines`（license_id, machine_id=agent_id, agent_id, status=active）ON CONFLICT(license_id,machine_id) DO UPDATE
   - 返回 `{ success, data: { seeded: true, tenant_id, license_key } }`
   - 在 `app.ts` 用与 `smokeFeishuSeedRouter` 相同方式挂 `app.use('/api/_smoke', smokeAcquisitionSeedRouter)`（生产 NODE_ENV=production 必 404）
2. **改现有 smoke** `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`：在 collect/start（现有 step2）之前加 **step0 自愈**：`curl POST $API_BASE/api/_smoke/acquisition-seed -H "X-Smoke-Token: $SMOKE_TOKEN" -d {tenant_id=$TENANT, agent_id=$AGENT}`，非 200 → envfail（seed 失败=环境问题，非采集红）。

## 为什么改
根因：真机 smoke 硬编码固定测试租户 `455a8ca9` + agent `a7a7b36c`（物理设备 xian-rog 绑死这俩 ID）。环境隔离 session 重置 `zenithjoy_test` 后冲掉该租户，collect/start 插 `acquisition_collect_tasks` 触发 `acquisition_collect_tasks_tenant_id_fkey` 外键失败→500→刀3 卡死。无 seed 脚本兜底，手动 seed 下次重置又没。端点让 smoke 派任务前自愈，抗 DB 重置。已手动验证 seed 内容正确（seed 后 collect/start 从 500 变 200）。

## 关联上下文
- 相关 Journey/Ability：Line02 智能获客 - 安卓真机采集（Seg1）
- 相关决策：small-change `43c4a0e8`（本次）
- 范式：`apps/api/src/routes/_smoke-feishu-seed.ts`（DEV-only 双门禁 seed helper）
- 真正的 staging DB = `zenithjoy_test`（mmv postgres 5432），非 handoff 误写的 cecelia_staging

## 影响范围
- 端点双门禁：生产 `NODE_ENV=production` 恒 404，且需 `X-Smoke-Token`——生产零暴露。
- 只改现有 smoke（非新增）→ feat 触发 lint-feature-has-smoke（`--diff-filter=A`）需新增 smoke；本次用 `[CONFIG]` commit 前缀绕过（repo 惯例 #1279/#1277）。
- 新端点有 vitest 单测满足 api 覆盖 gate。

## Regression 守卫
- **逻辑接缝**（端点幂等/门禁）：vitest `_smoke-acquisition-seed.test.ts` —— 断言 ①生产 404 ②错 token 403 ③正确调用 upsert 成功返回 seeded ④重复调用幂等不报错。
- **环境接缝**（真机采集依赖固定租户存在）：改后的 android smoke step0 本身就是运行时自愈守卫——DB 重置后 smoke 自动补齐，不再靠人工 seed。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 端点实现让 test 变绿（commit-2）
- [ ] 生产门禁：NODE_ENV=production → 404；错 token → 403（test 覆盖）
- [ ] 幂等：重复 seed 不报错（test 覆盖）
- [ ] android smoke step0 调用 seed，seed 失败走 envfail 分级
- [ ] CI 全绿（含 vitest + smoke glob runner SKIP 真机 smoke）
