# Sprint Report — CRM 客户状态历史追踪

**Task ID**: 5d090237-6046-410a-97a6-2bb0c91db411  
**Sprint Dir**: sprints/07081012-crm-status-history  
**Journey**: Line04 客户私域 AI 接管  
**PR**: https://github.com/perfectuser21/zenithjoy-workspace/pull/1172  
**Head Commit**: 16a1b917  
**CI**: 70/70 pass  
**Judge**: APPROVED  

---

## 交付物

### 新增
- `apps/api/db/migrations/20260708_120000_create_crm_customer_status_history.sql` — 建表 + 索引 + 幂等回填
- `apps/api/src/db/pool.ts` — 命名导出包装（可 vi.mock 拦截）
- `apps/api/src/middleware/auth.ts` — bodyWechatIdToParam + requireCsWriteAccess 导出
- `apps/api/src/utils/resolveTenantId.ts` — 可 mock 的租户解析工具
- `sprints/07081012-crm-status-history/tests/crm-status-history.test.ts` — 合同测试 B1-B6（11 测试）
- `.github/workflows/scripts/smoke/crm-status-history-smoke.sh` — CI smoke gate
- `sprints/07081012-crm-status-history/e2e-verify.sh` — E2E 回归脚本

### 修改
- `apps/api/src/routes/crm.ts` — PUT /customers/status 改为事务模式，写入 crm_customer_status_history

### 测试
- 3 个 unit test 文件（pool/auth/resolveTenantId）
- test-registry.yaml 新增 4 条记录

---

## 修复的 CI 问题（7 处）

1. `customer_id UUID→BIGINT` FK 类型不匹配
2. `vi.hoisted()` mock 提升正确用法
3. auth.test.ts lint 未用参数警告
4. test-registry orphan check 缺 3 个 unit test
5. lint-test-pairing 缺配套 test 文件
6. **PostgreSQL `$1 uuid vs text` 类型推断冲突** ← 核心 Bug，拆为 $1(TEXT)/$6(UUID)
7. e2e-verify.sh 在无 VALID_TOKEN 时误打 API

---

## 合同覆盖（B1-B6）

| 行为 | 验证方式 | 结果 |
|------|---------|------|
| B1 新客户首次写 status → old_status=NULL 历史行 | vitest + CI smoke | ✓ |
| B2 status 变化 → 新增历史行（old/new 正确） | vitest | ✓ |
| B3 重复 status → 不写历史 | vitest | ✓ |
| B4 upsert 失败 → 事务回滚无残留 | vitest mock DB error | ✓ |
| B5 多租户隔离 → tenant_id 不串 | vitest 双租户断言 | ✓ |
| B6 migration 幂等 → 重跑不重复插入 | CI INSERT 0 0 | ✓ |

---

## Path 推进

**Line04 Path 4** Step 2 数据基础就绪：  
`crm_customer_status_history` 表为"推进速度"A/B 测试指标提供数据底座。  
每次客户状态流转自动记录 `(tenant_id, customer_id, old_status, new_status, changed_at)`，  
支持未来计算平均停留时长、转化漏斗、阶段耗时分布。
