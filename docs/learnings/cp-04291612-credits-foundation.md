# Learning: PR-C 积分基建（Credits Foundation）

**任务**: tenant_credits/credit_transactions 表 + service + charge 中间件 + 充值/扣减 API（不接入业务端点）
**分支**: cp-04291612-credits-foundation
**完成日期**: 2026-04-29

---

### 根本原因

ZenithJoy SaaS 双轨产品（Free 用云积分 / Paid 解锁本地 Agent）需要积分账户作为计费基座。
之前每个 tenant 没有"账户"概念，即使 PR-B 注册赠送 100 积分也没有地方落库。本 PR 做基建：表 + service + 中间件 + 三个 API（GET balance / GET transactions / POST recharge），不动业务端点，避免 PR 太大。

### 关键决策

1. **隔离粒度 = tenant（不是 user）**：与 multi-tenant 隔离层一致——同公司多人共享额度。
2. **balance ≥ 0 CHECK 约束 + SELECT...FOR UPDATE**：双保险防止并发超扣。CHECK 是最后防线（DB 直拒），FOR UPDATE 是性能路径（同事务串行扣减）。
3. **流水表 amount 正负设计**：正数=充值，负数=消耗，单表查倒序就是完整账单——比"两个表 union"简单。
4. **CREDIT_COSTS 写代码常量不写表**：单价是产品决策（5/10），不是用户配置。写常量便于 grep + 编译期检查 reasonKey 拼写。
5. **不接入业务端点**：把基建和"接入"拆成两个 PR。中间件 createCreditCharger 工厂模式，业务接入只需要 `app.use(...tenantContext, createCreditCharger('ai_writing'), handler)` 一行。

### 发现的关键事实

1. **vi.mock 在 ESM 下要小心闭包变量初始化时机** — 把 `client` 对象塞 default 的 `__client` 属性是项目内 helper 模式（不是 hoisting bug）；走 `(pool as any).__client` 拿 spy。
2. **route 测试需先 install deps** — worktree 是新建的，node_modules 不存在；vitest 报 `Cannot find package 'better-auth/node'`，跑 `npm install` 即可。
3. **mock pool 要支持 .connect()** — 涉及事务的服务，mock 需返 `{ default: { query, end, connect } }`，否则 service 调 pool.connect() 直接 undefined。
4. **lint-feature-has-smoke 不查 test/migration 文件** — 但本 PR 改了 `apps/api/src/`（service/middleware/route），所以必须有 smoke.sh。已加 credits-smoke.sh + 接到 ci-l4-e2e-smoke.yml smoke-api-contract job。
5. **test-registry.yaml 末尾原有损坏条目** — 上个 PR (PR-3) merge 时遗留，本 PR commit-1 顺手修复（auth-bridge 和 better-auth-api 两条登记错位）。

### 下次预防

- [ ] 业务端点接入积分（PR-E）记得：tenantContext **必须**在 createCreditCharger 之前挂载。
- [ ] 充值前端 UI（PR-D）需要给 super-admin 加"对公司充值"入口；普通用户暂不开放主动充值（决策待）。
- [ ] PR-B 的 initial_grant 接入：用户注册后调 `recharge(tenantId, 100, 'initial_grant', { source: 'auto_signup' })`，metadata 留审计痕迹。
- [ ] 长期：如果业务出现"积分批量退款"需求，credit_transactions 加 `reverses_id UUID`（指向被退款的 tx），保持流水不可变 + 可追溯。
- [ ] 跨租户充值（POST /recharge）只允许 super-admin，未来如果开放经销商角色，要把 super-admin 拆成 RBAC 权限码（CREDIT_RECHARGE_ANY）。
