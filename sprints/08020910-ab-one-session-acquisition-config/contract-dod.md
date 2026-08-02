---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Acquisition configuration effective validation

**范围**：只修复 `PUT /api/acquisition/config` 对 merged/effective configuration 的校验时序。
**大小**：S

## ARTIFACT 条目

- [x] [ARTIFACT] 共享 Red fixture 与 commit `0dc4e3c0` 完全一致
  Test: git diff --quiet 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts

- [x] [ARTIFACT] Test Contract 指向仓库已注册、L4 收集的共享测试文件
  Test: node -e "const fs=require('fs');const r=fs.readFileSync('test-registry.yaml','utf8');if(!r.includes('path: apps/api/tests/routes/acquisition-dispatch.test.ts'))process.exit(1)"

- [x] [ARTIFACT] sprint E2E 验收脚本落地且由 CI workflow 收集
  Test: node -e "const fs=require('fs');if(!fs.existsSync('sprints/08020910-ab-one-session-acquisition-config/e2e-verify.sh'))process.exit(1);const ys=fs.readdirSync('.github/workflows').filter(f=>/\.ya?ml$/.test(f)).map(f=>fs.readFileSync('.github/workflows/'+f,'utf8')).join('\n');if(!ys.includes('sprints/08020910-ab-one-session-acquisition-config/e2e-verify.sh'))process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] [L2] B-01: partial patch 合并当前配置后越界时返回 400 且零写入
  动作: 对当前 `keywords_per_round_max=5` 的 tenant 提交 `{keywords_per_round_min:10}`。
  预期观察: route 同步返回 HTTP 400，`error.code=INVALID_CONFIG`，pool 调用中不存在 acquisition_config INSERT。
  等待预算: 0s
  留证: Vitest verbose 输出中目标测试 PASS 与断言位置。
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/routes/acquisition-dispatch.test.ts -t "partial patch cannot make merged keyword bounds invalid" --reporter=verbose'

- [x] [BEHAVIOR] [L2] B-02: 非法配置沿用 400 INVALID_CONFIG 与不写库语义
  动作: 对 tenant 提交既有非法数值请求。
  预期观察: route 同步返回 HTTP 400、错误码 `INVALID_CONFIG`，且不调用 acquisition_config INSERT。
  等待预算: 0s
  留证: Vitest verbose 输出中 `PUT /config 非法数值` case PASS。
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/routes/acquisition-dispatch.test.ts -t "PUT /config 非法数值" --reporter=verbose'

- [x] [BEHAVIOR] [L2] B-03: 合法 update 继续返回 200 并 upsert
  动作: 对 tenant 提交现有合法配置 patch；完整有效配置同样由相同 validator 接受。
  预期观察: route 同步返回 HTTP 200，响应 data 反映新值，且存在 acquisition_config INSERT/upsert。
  等待预算: 0s
  留证: Vitest verbose 输出中合法 route case 与完整 bounds validator case PASS。
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/routes/acquisition-dispatch.test.ts -t "PUT /config 合法|validateConfigPatch" --reporter=verbose'

- [x] [BEHAVIOR] [L2] B-04: acquisition dispatch route 相关回归全绿
  动作: 运行共享测试文件的完整 route/service 回归集。
  预期观察: 所有既有合法、非法、认证与 tenant 隔离 case 全部通过，无 skip。
  等待预算: 120s
  留证: Vitest verbose 完整输出与 exit code 0。
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/routes/acquisition-dispatch.test.ts --reporter=verbose'

## Invariant 覆盖映射

- INV-01 单会话串行：N/A（流程纪律，由 Controller 台账与单线程执行证明）。
- INV-02 禁止环境硬编码：N/A（本修复不新增环境值）。
- INV-03 真环境验证：共享 Red 为 route/service L2；真实 PG 缺口已在合同“未覆盖真实链路清单”登记，不冒充 L3。
- INV-04 多租户测试：由 `B-04` 中既有 tenant 隔离与 header 驱动 case 覆盖。
- INV-05 凭据安全：N/A（本修复不接触凭据）。
- INV-06 日志脱敏：N/A（本修复不新增日志）。
- INV-07 端点鉴权：由 `B-04` 中无 tenant 401 case 覆盖。
- INV-08 租户隔离：由 `B-01` 当前 tenant 读取与 `B-04` tenant 隔离 case 覆盖。
- INV-09 语义成功：由 `B-01` 的三信号与 `B-03` 的 200+data+INSERT 覆盖。
- INV-10 Test Contract 四列：由 `contract-draft.md` 的四列表机械结构覆盖。
- INV-11 Red 精确提交：由共享 Red commit `0dc4e3c0` 与首个 ARTIFACT diff 检查覆盖。
- INV-12 禁止 Generator 合并：N/A（Controller 在 Step 6 人工 blind A/B gate 执法）。

## 完成条件

- [x] 共享 Red 命令在旧生产代码上记录 actual 200 / expected 400。
- [x] 生产实现后 `B-01` 转绿，且共享测试文件零 diff。
- [x] `B-02`–`B-04` 全绿。

Controller 后置门禁：exact-head CI、Evaluator 与 Judge 必须绑定同一 PR head SHA 并 PASS；PR 保持 OPEN，停在 human-review/blind A/B gate。
