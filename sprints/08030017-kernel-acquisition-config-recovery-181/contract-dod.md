---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Kernel acquisition 有效配置守卫恢复

**范围**: 仅修复 PUT/PATCH acquisition config 对当前租户合并后 keyword bounds 的校验。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 真实 Postgres 集成测试覆盖 PUT/PATCH 对称冲突、并发可见当前值、合法更新和双租户隔离
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts','utf8');for(const s of ['PUT 仅提高 min','PATCH 仅降低 max','实际可见当前配置','合法部分更新','合法完整更新','tenantB'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] 共享冻结 Red fixture 未被本 Sprint 修改
  Test: git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: PUT 仅提高 min 造成有效配置冲突时拒绝且双租户零写入 [接缝×2]
  动作: 租户 A 已有 min=3/max=10，仅 PUT keywords_per_round_min=11
  预期观察: HTTP 400、error.code=INVALID_CONFIG，租户 A 整行及租户 B 均不变
  等待预算: 10s
  留证: vitest stdout 与两个租户的 Postgres 写前/写后断言
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "PUT 仅提高 min 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化"'

- [ ] [BEHAVIOR] [L2] B-02: PATCH 仅降低 max 造成有效配置冲突时拒绝且双租户零写入 [接缝×2]
  动作: 租户 A 已有 min=3/max=10，仅 PATCH keywords_per_round_max=2
  预期观察: HTTP 400、error.code=INVALID_CONFIG，租户 A 整行及租户 B 均不变
  等待预算: 10s
  留证: vitest stdout 与两个租户的 Postgres 写前/写后断言
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "PATCH 仅降低 max 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化"'

- [ ] [BEHAVIOR] [L2] B-03: 合法部分更新只改变请求字段并保持租户隔离 [接缝×2]
  动作: 对租户 A 仅 PUT keywords_per_round_min=8，同时保存租户 B 快照
  预期观察: HTTP 200；A 为 min=8/max=10；B 完全不变
  等待预算: 10s
  留证: vitest stdout 与 A/B 两租户 Postgres 查询结果
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "合法部分更新成功持久化且只改变请求字段并保持双租户隔离"'

- [ ] [BEHAVIOR] [L2] B-04: 合法完整更新与 min=max 等值边界成功 [接缝×2]
  动作: 对租户 A PUT keywords_per_round_min=12 与 keywords_per_round_max=12
  预期观察: HTTP 200；响应与 DB 两字段均为 12
  等待预算: 10s
  留证: vitest stdout 与 Postgres 读回结果
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "合法完整更新与 min=max 等值边界成功持久化并可读回"'

- [ ] [BEHAVIOR] [L2] B-05: 后续请求按实际可见当前配置校验且失败不更新时间 [接缝×2]
  动作: 先成功写入 min=9/max=10，再 PATCH max=8
  预期观察: 第二请求 HTTP 400 + INVALID_CONFIG，整行含 updated_at 与第二请求前相同
  等待预算: 10s
  留证: vitest stdout 与 Postgres 整行快照 diff
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "后续请求按实际可见当前配置校验且非法请求不更新时间"'

## Invariant 映射

- INV-1 N/A：不触及 cortex learning 路径；本合同使用真实 API/DB，不声明结构检查等价全链。
- INV-2：B-01 至 B-05 的写入侧与校验侧均由同一 `DB_URL` 解析，禁止双默认值。
- INV-3 N/A：不触及 agents 表。
- INV-4 N/A：不新增 status 枚举。
- INV-5 N/A：不触及 watchdog/orphan recovery。
- INV-6：B-01/B-02/B-05 同时断言 HTTP 语义字段与真实 DB 状态，不以 `ok:true` 代替。
- INV-7 N/A：不改依赖或 audit 白名单。
- INV-8 N/A：不触及 relay 心跳。
- INV-9：Generator 毕业提交前必须运行仓库既有 `lint-tdd-commit-order` 与 `check-test-coverage` 门禁。
- INV-10：B-01 至 B-05 的 manual oracle 以真实 exit code 为 verdict，并由 vitest stdout 证明解释器启动。
- INV-11 N/A：本合同不使用 `manual:node -e` BEHAVIOR；ARTIFACT node 命令无 JavaScript模板插值。
- INV-12：遵守 smoke 铁律；先保留共享 Red，再实现点绿。
- INV-13：遵守 smoke 铁律；不得修改共享 Red fixture。
- INV-14 N/A：本单无周期扫描状态。
- INV-15 N/A：本单无周期扫描或付费外部调用。
- INV-16 N/A：本单无跨模块时间常数。
- INV-17 N/A：本单纯 local_api，不涉及设备环境路由。
- INV-18：任务 payload 已指定 `target_environment=local_api`，合同与其一致。
- INV-19 N/A：本角色不调用 Brain judge API；下游仍须返回规定 verdict shape。
- INV-20 N/A：本单不新增 varchar/path 写入。
- INV-21 N/A：本单不是退役能力复活，不读取已删除代码。
- INV-22：冲突失败分支必须显式 HTTP 400，不依赖异常或外层 catch 猜测。
- INV-23：遵守 smoke 铁律；真实 DB 不可用即 FAIL。
- INV-24 N/A：不触及 journey_features report。
- INV-25 N/A：不触及 controller merge/report 状态机。
- INV-26 N/A：不新增 host/环境白名单。
- INV-27 N/A：不触及 headed relay 点火 payload。
- INV-28 N/A：不做模块退役判断。
- INV-29 N/A：不新增后台 job 或 catch 吞错。
- INV-30：复用 acquisition_config 前已定位现有读写方与 schema；不新增表。
- INV-31 N/A：不新增后台 job。
- INV-32 N/A：不新增重叠字段、设备类型或展示层。
- INV-33：PUT、PATCH、DoD 与 E2E 对 `INVALID_CONFIG` 和零写入使用同一语义。
- INV-34 N/A：不使用 git rev-parse 判 ref。
- INV-35 N/A：测试不以真实 worktree 作为部署根，不触碰生产资源。
- INV-36：所有 E2E 失败路径 exit 非零，禁止 warning 降级。
- INV-37 N/A：不做部署判变。
- INV-38 N/A：测试是真执行 API/DB，不使用 source-only readFileSync 测试。
- INV-39：Test Contract 保持固定四列，Test File 用 backtick。
- INV-40：Generator 的 Red 提交只允许精确 add 本 Sprint test 路径。
- INV-41 N/A：不验证调度接线；真实相邻 API/service/DB 已覆盖。
- INV-42 N/A：不新增 cron。
- INV-43：Generator 只推分支，不自行 merge；merge 权归 controller。
- INV-44 N/A：不依赖 headed relay 子 shell 环境继承。
- INV-45：仅复用任务明确允许的 Kernel-owned commit，并已按本次 PRD/派发重新核对路径与断言。
- INV-46：共享 CI workflow 和 quality allowlist 不在授权 files 范围，禁止修改。
- INV-47：盲评前禁止合并；若外部提前合并必须核对 verdict SHA 与 PR head SHA。
- INV-48：遵守 smoke 铁律；测试失败不可吞掉。
- INV-49 N/A：不改 brain/src，不新增共享 smoke allowlist。
- INV-50 N/A：不新增 task_type。
- INV-51 N/A：不新增常驻服务。
- INV-52 N/A：不新增 LaunchAgent/LaunchDaemon。
- INV-53 N/A：不新增宿主服务或 launchd patrol manifest。
- INV-54：遵守 smoke 铁律；所有断言可机检且失败非零。
- INV-55：本会话只串行执行当前 Harness proposer 任务。
- INV-56 N/A：不涉及 UIA、屏幕坐标或真机环境假设。
- INV-57：唯一接缝为 local_api↔Postgres；真目标未验前标 `logic-done-pending`。
- INV-58：B-01 至 B-03 默认种两个租户并断言互不串。
- INV-59：`DB_URL` 仅由环境注入，不写 git、不输出日志。
- INV-60：测试数据仅随机 tenant key 与数值配置，不记录 PII/聊天内容。
- INV-61：沿用现有 `tenantContextOptional` 鉴权，不新增无鉴权端点。
- INV-62：所有读写以请求上下文 tenant key 定点查询；B-01 至 B-03 显式验证跨租户不变。
