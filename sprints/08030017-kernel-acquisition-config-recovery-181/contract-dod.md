---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Kernel acquisition 有效配置原子守卫

**范围**: 仅修复 PUT/PATCH acquisition config 对当前租户有效 keyword bounds 的原子校验。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 真 Postgres 集成 smoke 覆盖冲突、合法 PATCH/PUT、完整 schema、受控并发和双租户隔离
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts','utf8');for(const s of ['合法部分 PATCH','合法完整 PUT','完整响应 schema','并发部分更新','FOR UPDATE','tenantB'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] 共享冻结 Red fixture 未被本 Sprint 修改
  Test: git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: PUT 单字段 min 造成有效配置冲突时 400 且双租户零写入 [接缝×2]
  动作: 租户 A 已有 min=3/max=10，仅 PUT min=11
  预期观察: HTTP 400、完整 error schema、error.code=INVALID_CONFIG，A 整行含 updated_at 及 B 均不变
  等待预算: 10s
  留证: vitest stdout 与 A/B 真 Postgres 写前写后断言
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "PUT 仅提高 min 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化"'

- [ ] [BEHAVIOR] [L2] B-02: PATCH 单字段 max 造成有效配置冲突时 400 且双租户零写入 [接缝×2]
  动作: 租户 A 已有 min=3/max=10，仅 PATCH max=2
  预期观察: HTTP 400、完整 error schema、error.code=INVALID_CONFIG，A/B 均不变
  等待预算: 10s
  留证: vitest stdout 与 A/B 真 Postgres快照
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "PATCH 仅降低 max 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化"'

- [ ] [BEHAVIOR] [L2] B-03: 合法部分 PATCH 只改请求字段并返回完整 schema [接缝×2]
  动作: 对 A 仅 PATCH min=8，同时保存 B 快照
  预期观察: HTTP 200；A 为 min=8/max=10；B 不变；顶层及全部 data keys/types 完整
  等待预算: 10s
  留证: vitest stdout、response keys 与 A/B DB 查询
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "合法部分 PATCH 成功且只改变请求字段并保持完整响应 schema 与双租户隔离"'

- [ ] [BEHAVIOR] [L2] B-04: 合法完整 PUT 与 min=max 成功并可读回 [接缝×2]
  动作: 对 A PUT min=12/max=12
  预期观察: HTTP 200；完整 success schema；响应与 DB 上下界均为 12
  等待预算: 10s
  留证: vitest stdout、response schema 与 DB 读回
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "合法完整 PUT 与 min=max 等值边界成功持久化并可读回"'

- [ ] [BEHAVIOR] [L2] B-05: 非上下界合法部分 PUT 不被误拒 [接缝×2]
  动作: 仅 PUT dm_per_day=31
  预期观察: HTTP 200；只改变 dm_per_day，上下界不变，禁用字段 result/min/max 不出现
  等待预算: 10s
  留证: vitest stdout、完整 response schema 与 DB diff
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "未涉及上下界的合法部分 PUT 不被误拒且只改变请求字段"'

- [ ] [BEHAVIOR] [L2] B-06: 同租户并发按锁后实际可见配置原子校验 [接缝×2]
  动作: 外部事务锁住 A 行后并发 PATCH min=9 与 max=8，再释放 blocker
  预期观察: 两请求恰一 HTTP 200、一 HTTP 400 INVALID_CONFIG；最终 min<=max；B 不变
  等待预算: 15s
  留证: vitest stdout、两个 status、最终 A/B Postgres 查询
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "并发部分更新按锁后实际可见配置原子校验且最终 min<=max"'

## Invariant 映射

- INV-1 N/A：不触及 cortex learning；不以结构检查冒充全链。
- INV-2：写入与校验由同一 `DB_URL` 解析。
- INV-3 N/A：不触及 agents 表。
- INV-4 N/A：不新增 status 枚举。
- INV-5 N/A：不触及 watchdog recovery。
- INV-6：B-01/B-02/B-06 同时断言语义字段和 DB 状态。
- INV-7 N/A：不改依赖或 audit 白名单。
- INV-8 N/A：不触及 relay 心跳。
- INV-9：毕业前运行既有 TDD 顺序与覆盖门禁。
- INV-10：manual oracle 使用真实 exit code 并保留 vitest stdout。
- INV-11 N/A：BEHAVIOR 不使用 manual:node。
- INV-12：先 Red 后实现，失败不得吞掉。
- INV-13：共享 Red fixture 只读。
- INV-14 N/A：无周期扫描。
- INV-15 N/A：无付费外部调用。
- INV-16 N/A：无跨模块时间常数。
- INV-17 N/A：纯 local_api，不涉及设备。
- INV-18：target_environment 明确为 local_api。
- INV-19 N/A：本角色不调用 judge API。
- INV-20 N/A：不新增 varchar/path 字段。
- INV-21 N/A：不是退役能力复活。
- INV-22：冲突显式返回 400，不依赖外层 catch 猜测。
- INV-23：真 DB 不可用即 FAIL。
- INV-24 N/A：不触及 journey_features report。
- INV-25 N/A：不触及 controller 状态机。
- INV-26 N/A：不新增 host 白名单。
- INV-27 N/A：不触及 headed payload。
- INV-28 N/A：不做退役判断。
- INV-29：事务异常必须回滚，不吞错。
- INV-30：复用既有 acquisition_config，不新增表。
- INV-31 N/A：不新增后台 job。
- INV-32 N/A：不新增重叠字段或展示层。
- INV-33：PUT/PATCH/DoD/E2E 对 INVALID_CONFIG 和零写入语义一致。
- INV-34 N/A：不使用 git rev-parse 判 ref。
- INV-35 N/A：不使用部署 worktree。
- INV-36：E2E 所有失败 exit 非零。
- INV-37 N/A：不做部署判变。
- INV-38：测试真实执行 API/DB。
- INV-39：Test Contract 固定四列且路径用 backtick。
- INV-40：Red commit 仅精确 add 本 Sprint test。
- INV-41：真实相邻路由/service/DB 覆盖原子接缝。
- INV-42 N/A：不新增 cron。
- INV-43：Generator 不 merge。
- INV-44 N/A：不依赖 headed shell 环境。
- INV-45：仅使用任务允许的 Kernel context，按本次真实路由核对。
- INV-46：禁止修改共享 CI 和 quality allowlist。
- INV-47：盲评前禁止 merge。
- INV-48：smoke 失败不可吞掉。
- INV-49 N/A：不改 brain/src。
- INV-50 N/A：不新增 task_type。
- INV-51 N/A：不新增常驻服务。
- INV-52 N/A：不新增 launch service。
- INV-53 N/A：不改 launchd patrol。
- INV-54：全部 BEHAVIOR 可机检且失败非零。
- INV-55：本会话仅当前 proposer 任务。
- INV-56 N/A：无 UIA 或环境坐标。
- INV-57：API↔Postgres 未真验前为 logic-done-pending。
- INV-58：测试种 A/B 两租户并断言隔离。
- INV-59：DB_URL 环境注入，不进 git/log。
- INV-60：仅随机 tenant key 与数值，无 PII。
- INV-61：沿用现有 tenant middleware，不新增无鉴权端点。
- INV-62：所有读写 scope 到 header 对应租户并验证跨租户不变。
