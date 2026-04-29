# Learning: Free Tier 自动 Onboarding（PR-B）

**任务**: 注册即试用 — 不带 license_key 注册自动建 free tenant + 100 积分
**分支**: cp-04291611-free-tier-onboarding
**完成日期**: 2026-04-29

---

## 背景

PR #241 (PR-2) 桥接逻辑：注册不带 license_key → 用户存在但无 tenant → 调 `/api/works` 收 403 NO_TENANT。体验差。

主理人 2026-04-29 决策：**注册即试用**，每人自动 free tenant + 100 积分（积分本 PR 不做）。

## 实现

三层联动：

1. **Migration**：`licenses.tier` CHECK 约束加 `'free'`（旧 4 项 → 5 项），向前兼容（旧数据无 free 行不会失败）。
2. **license.service**：`Tier` 类型加 `'free'`，`TIER_QUOTA.free = 0`，`TIER_PREFIX.free = 'F'`，`FREE_TIER_DURATION_DAYS = 10*365`。`generateLicenseKey('free')` 输出 `ZJ-F-XXXXXXXX`。
3. **auth-bridge**：`bridgeNewUserToTenant` 重写，paid 路径不变；缺/无效/孤儿 license_key 走事务自动建 free license + free tenant + owner member。

## 设计权衡

### 为什么 Agent 注册不用改

`max_machines = 0` → 现有 PR #226 quota 检查会自然返回 `QUOTA_EXCEEDED`。free 用户云端能用、本地 Agent 不能装，符合产品决策。**0 行 Agent 代码改动**。

### 为什么 free 路径包事务，paid 路径不包

free 路径要写 4 张表（licenses → tenants → licenses UPDATE → tenant_members），任意一步崩溃就有脏 license。事务 + ROLLBACK 保证原子。

paid 路径只写 1 张表（tenant_members INSERT），ON CONFLICT DO NOTHING，不需事务。

### 为什么 paid 查询 DB 异常不 fallback 到 free

保守原则：DB 抖动时如果 fallback，可能给已经买了 license 的用户重复建 free 数据。返回 DB_ERROR 让用户重试更安全。

## 踩的坑

### 1. `if (!TIER_QUOTA[tier])` 不识别 0

free tier max_machines=0，原 `createLicense` 用 `if (!TIER_QUOTA[tier])` 判合法 tier，对 `0` falsy → 误判为非法。改成 `if (!(tier in TIER_QUOTA))` 才对。

### 2. PostgreSQL UNIQUE 冲突（23505）的 ROLLBACK 重试

free license_key 撞车（极小概率）需要重试。但事务里 INSERT 失败后必须先 `ROLLBACK + release client` 才能 retry，否则 client 状态卡住。我用 5 次重试上限。

### 3. role 必须走参数

测试断言 `expect(memberParams).toContain('owner')` —— 写死在 SQL 字面量里测试看不到 'owner' 在 params 数组。改成 `VALUES ($1, $2, $3)` + `[tenantId, userId, 'owner']` 解决。

### 4. admin POST tier='free' 应当拒绝

加了 free 到 `TIER_QUOTA` 后，`admin-license` 路由原本用 `tier in TIER_QUOTA` 判合法 → admin 能创建 free（不该）。改用白名单 `PAID_TIERS = ['basic','matrix','studio','enterprise']` 显式拒绝。

### 5. test-registry yaml 已坏（PR #242 留下）

`api-auth-tenant-bridge` 与 `dashboard-better-auth-api` 两条记录格式损坏，但不影响 CI 解析（只是看着乱）。我不修这个非任务范围的脏，只更新 PR-2 注释覆盖 PR-B。

## 测试矩阵

| 场景 | 入参 | 期望 reason | 期望表写入 |
|------|------|-------------|------------|
| 有效付费 license | `licenseKey='ZJ-VALID-001'` | `PAID_TENANT_LINKED` | tenant_members(role=member) |
| 无 license_key | `licenseKey=undefined` | `FREE_TENANT_CREATED` | licenses(free) + tenants(free) + tenant_members(owner) |
| 空字符串 license_key | `licenseKey='   '` | `FREE_TENANT_CREATED` | 同上 |
| license_key 不存在 | `licenseKey='ZJ-FAKE'` | `FREE_TENANT_CREATED` | 同上 |
| license revoked | DB 返回 status=revoked | `FREE_TENANT_CREATED` | 同上 |
| license 孤儿（无 tenant） | DB tenant_id=NULL | `FREE_TENANT_CREATED` | 同上 |
| 事务中段 DB 崩 | INSERT tenants 失败 | `DB_ERROR` | ROLLBACK 全无 |
| paid 查询 DB 崩 | SELECT licenses 失败 | `DB_ERROR` | 不走 fallback |

Smoke 6 step 验证完整链路（curl + psql）：注册 → DB 写入 → /api/works 200。

## 下次预防

- 任何 `Record<K, V>` 用 falsy 判 key 存在性都要小心 0/'' 等合法值
- 事务跨多张表必须 BEGIN/COMMIT/ROLLBACK + try/finally release client
- 涉及 admin 路由开放新枚举值必须做"是否允许 admin 经此 API 创建"决策

## 涉及文件

- `apps/api/db/migrations/20260429_161500_licenses_allow_free_tier.sql`
- `apps/api/src/services/license.service.ts`
- `apps/api/src/auth-bridge.ts`
- `apps/api/src/auth.ts`
- `apps/api/src/routes/admin-license.ts`
- `apps/api/tests/auth-bridge.test.ts`
- `apps/api/tests/services/license.service.test.ts`
- `.github/workflows/scripts/smoke/free-tier-onboarding-smoke.sh`
