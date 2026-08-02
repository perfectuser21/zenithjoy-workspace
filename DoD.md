---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Kernel acquisition effective-config guard

**范围**: 仅修复现有 acquisition config PUT/PATCH 对当前租户有效 keyword bounds 的校验与原子持久化。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 真 Postgres 集成 smoke 覆盖 7 个 PRD 场景，包含完整 PUT、整行业务字段 diff、双租户隔离与无行首次并发
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts','utf8');for(const s of ['completeConfig','changedBusinessKeys','tenantB','tenantNew','新租户首次并发 upsert'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] 共享冻结 Red fixture 相对冻结 SHA 未改
  Test: git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts

- [ ] [ARTIFACT] 新增真 Postgres 集成测试已登记到测试注册表
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('test-registry.yaml','utf8');if(!c.includes('sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts'))process.exit(1)"

- [ ] [ARTIFACT] Final E2E 使用 Dashboard 同形 session cookie 且禁止 X-Tenant-Id 绕过鉴权
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/08030017-kernel-acquisition-config-recovery-181/contract-draft.md','utf8');const e=c.split('## E2E 验收')[1].split('## 探索提示')[0];if(!e.includes('Cookie: ${AUTH_COOKIE_A}')||!e.includes('UNAUTH_CODE')||e.includes('X-Tenant-Id'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: PUT 仅提高 min 的冲突更新以 400 拒绝且双租户零写入 [接缝×2]
  动作: 租户 A 已有 min=3/max=10，仅 PUT min=11，同时保存 A/B 完整行快照
  预期观察: HTTP 400、error.code=INVALID_CONFIG；A 行含 updated_at 与 B 行均完全不变
  等待预算: 10s
  留证: Vitest stdout、HTTP body 与 A/B 真 Postgres 写前写后快照断言
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "PUT 仅提高 min 的无效有效态返回 400 INVALID_CONFIG 且两租户整行零持久化"'

- [ ] [BEHAVIOR] [L2] B-02: PATCH 仅降低 max 的冲突更新以 400 拒绝且双租户零写入 [接缝×2]
  动作: 租户 A 已有 min=3/max=10，仅 PATCH max=2，同时保存 A/B 完整行快照
  预期观察: HTTP 400、error.code=INVALID_CONFIG；A 行含 updated_at 与 B 行均完全不变
  等待预算: 10s
  留证: Vitest stdout、HTTP body 与 A/B 真 Postgres 写前写后快照断言
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "PATCH 仅降低 max 的无效有效态返回 400 INVALID_CONFIG 且两租户整行零持久化"'

- [ ] [BEHAVIOR] [L2] B-03: 合法部分 PATCH 只改请求字段并保持双租户隔离 [接缝×2]
  动作: 对 A 仅 PATCH min=8，并保存 A 业务整行与 B 完整行快照
  预期观察: HTTP 200；A 的 min=8/max=10，A 业务字段 diff 恰为 min，B 完整行不变
  等待预算: 10s
  留证: Vitest stdout、response body、changedBusinessKeys 与 A/B DB 快照
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "合法部分 PATCH 只改变请求字段且保持双租户隔离"'

- [ ] [BEHAVIOR] [L2] B-04: 合法非上下界部分 PUT 不误拒且只改请求字段 [接缝×2]
  动作: 对 A 仅 PUT dm_per_day=31，并保存 A 业务整行与 B 完整行快照
  预期观察: HTTP 200；A 业务字段 diff 恰为 dm_per_day，bounds 原值不变，B 完整行不变
  等待预算: 10s
  留证: Vitest stdout、changedBusinessKeys 与 A/B DB 快照
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "合法非上下界部分 PUT 只改变请求字段且保持双租户隔离"'

- [ ] [BEHAVIOR] [L2] B-05: 合法完整 PUT 含全部字段且 min=max 成功可读回 [接缝×2]
  动作: 对 A PUT completeConfig 的全部 16 个既有配置字段，其中 min=max=12
  预期观察: HTTP 200；response 与 DB 整行匹配全部请求字段；B 完整行不变
  等待预算: 10s
  留证: Vitest stdout、完整请求/response 匹配与 A/B DB 查询
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "合法完整 PUT 含全部配置字段且 min=max 时整行持久化可读回"'

- [ ] [BEHAVIOR] [L2] B-06: 已有租户并发 patch 按实际可见配置串行判定 [接缝×2]
  动作: A 已有 min=3/max=10，同时 PATCH min=9 与 max=8
  预期观察: 两请求恰一 200、一 400 INVALID_CONFIG；最终 A 的 min<=max，B 完整行不变
  等待预算: 15s
  留证: Vitest stdout、两个 HTTP status/body 与最终 A/B DB 快照
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "已有租户并发部分更新按实际可见配置串行校验且最终合法"'

- [ ] [BEHAVIOR] [L2] B-07: 新租户首次并发 upsert 不创建无效有效态 [接缝×2]
  动作: 确认新 tenant 无配置行，同时 PATCH min=5 与 max=4；两补丁单独对默认配置均合法、合并后冲突
  预期观察: 两请求恰一 200、一 400 INVALID_CONFIG；仅一行被创建且 min<=max，B 完整行不变
  等待预算: 15s
  留证: Vitest stdout、两个 HTTP status/body 与新 tenant/B 的最终 DB 快照
  Test: manual:bash -c 'DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "新租户首次并发 upsert 串行校验且不会创建无效有效态"'

- [ ] [BEHAVIOR] [L2] B-08: 真实 local_api 以 Dashboard session-cookie 鉴权完成双租户全链 [接缝×2]
  动作: 启动真实 apps/api HTTP app；先无 cookie 请求，再用 A/B 两个 disposable better-auth session cookie 依次执行非法 PUT/PATCH、合法部分 PATCH 与合法完整 PUT
  预期观察: 无 cookie=401；A/B cookie 各自解析到对应 tenant；非法请求 400 INVALID_CONFIG 且 A/B 全量快照不变；合法更新可读回且 B 不变
  等待预算: 120s
  留证: /tmp/kernel-acquisition-api.log、各 HTTP body、A/B 写前写后 JSON、psql 最终不变量与脚本 exit code
  Test: manual:bash -c 'awk '\''/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'\'' sprints/08030017-kernel-acquisition-config-recovery-181/contract-draft.md > /tmp/kernel-effective-config-e2e.sh; bash /tmp/kernel-effective-config-e2e.sh'

- [ ] [BEHAVIOR] [L2] B-09: 冻结 Red fixture 不改而由实现点绿
  动作: 比对共享 fixture 与冻结 SHA 后，真启动 apps/api Vitest 执行指定 Red smoke
  预期观察: fixture diff 为空；目标 smoke 从已记录的 200!=400 Red 转为 1/1 passed
  等待预算: 30s
  留证: git diff exit code、Vitest 解释器启动行及 1 passed stdout
  Test: manual:bash -c 'git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts && npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t "partial patch cannot make merged keyword bounds invalid" --reporter=verbose'

## Invariant 映射

- INV-1 N/A：不触及 cortex learning，且不以 source inspection 冒充本 Sprint 真 DB 验收。
- INV-2：B-01 至 B-07 的写入与校验只使用同一 `DB_URL` 解析逻辑。
- INV-3 N/A：不触及 agents 表。
- INV-4 N/A：不新增 status 枚举。
- INV-5 N/A：不触及 watchdog recovery。
- INV-6：B-01/B-02/B-06/B-07 同时断言 HTTP 语义字段和 DB 真状态。
- INV-7 N/A：不改依赖或 audit 白名单。
- INV-8 N/A：不触及 relay 心跳。
- INV-9：测试毕业后必须运行既有 TDD 顺序与覆盖门禁。
- INV-10：B-01 至 B-09 使用真实 exit code；B-08/B-09 留下解释器启动和 pass 输出。
- INV-11 N/A：BEHAVIOR 不使用 manual:node 双引号插值。
- INV-12：冻结 Red 先失败、实现后转绿；失败不得吞掉。
- INV-13：共享 Red fixture 只读，B-09 机械 diff。
- INV-14 N/A：无周期扫描。
- INV-15 N/A：无付费外部调用。
- INV-16 N/A：无跨模块时间常数。
- INV-17 N/A：纯 local_api，不涉及设备。
- INV-18：target_environment 明确为 local_api。
- INV-19 N/A：本角色不调用 judge API。
- INV-20 N/A：不新增 varchar/path 字段。
- INV-21 N/A：不是退役能力复活。
- INV-22：有效态冲突显式返回 400，不依赖外层 catch。
- INV-23：真 Postgres 不可用时 B-01 至 B-07 全部 FAIL。
- INV-24 N/A：不触及 journey_features report。
- INV-25 N/A：不触及 controller 状态机。
- INV-26 N/A：不新增 host 白名单。
- INV-27 N/A：不触及 headed payload。
- INV-28 N/A：不做退役判断。
- INV-29：DB/事务错误必须回滚并返回失败，不吞错。
- INV-30：复用既有 `zenithjoy.acquisition_config`，不新增表。
- INV-31 N/A：不新增后台 job。
- INV-32 N/A：不新增重叠字段或展示层。
- INV-33：PUT/PATCH/DoD/E2E 对 INVALID_CONFIG、零写入和合法兼容语义一致。
- INV-34 N/A：不使用 git rev-parse 判 ref。
- INV-35 N/A：不使用部署 worktree。
- INV-36：E2E 任一路径失败均传播非零 exit。
- INV-37 N/A：不做部署判变。
- INV-38：B-01 至 B-07 真执行 production routers/middleware/service/Postgres；B-08 另走完整 HTTP app socket + session cookie。
- INV-39：Test Contract 固定四列且 Test File 路径用 backtick。
- INV-40：Red commit 只允许精确 add 本 Sprint test 文件。
- INV-41：真实相邻 router/service/DB 覆盖被改的原子接缝。
- INV-42 N/A：不新增 cron。
- INV-43：Generator 只推分支，禁止自行 merge。
- INV-44 N/A：不依赖 headed shell 继承。
- INV-45：仅使用允许的 Kernel proposal context并核对本次真实路由。
- INV-46：禁止修改共享 CI workflow 和 quality allowlist。
- INV-47：盲评 A/B verdict 前禁止 merge。
- INV-48：所有 smoke 失败不可吞掉。
- INV-49 N/A：不改 brain/src。
- INV-50 N/A：不新增 task_type。
- INV-51 N/A：不新增常驻宿主服务。
- INV-52 N/A：不新增 LaunchAgent/Daemon。
- INV-53 N/A：不改 launchd patrol。
- INV-54：B-01 至 B-09 可机检且失败非零。
- INV-55：本会话只执行当前 proposer 任务。
- INV-56 N/A：无屏幕坐标/UIA/env 假设。
- INV-57：API↔Postgres 接缝未真验前为 logic-done-pending。
- INV-58：B-01 至 B-07 均种至少 A/B 两租户并断言隔离。
- INV-59：DB_URL 从环境注入，不进 git/log。
- INV-60：租户 ID 随机生成且无 PII，不记录完整敏感配置。
- INV-61：沿用现有 tenant middleware，不新增无鉴权端点。
- INV-62：Final E2E 所有读写按 better-auth session scope，集成 smoke 按生产 `X-Feishu-User-Id` 回落 scope；B-01 至 B-08 验证跨租户不变。
contract_branch: cp-harness-propose-r4-e74484fc-r35bbaf33-a25
sprint_dir: sprints/08030017-kernel-acquisition-config-recovery-181
