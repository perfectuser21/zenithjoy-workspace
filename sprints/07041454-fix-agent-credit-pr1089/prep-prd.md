# Bug PrepPRD：zenithjoy PR #1089 CI 失败（agent-credit API）

## 症状
Brain harness 自动生成的 PR #1089（"积分扣费/查询 API + pending-keyword-tasks 余额前置校验"）开出来后 CI 不绿：
- Lint — Test Pairing: FAIL（`apps/api/src/routes/agent-credit.ts` 缺配套 `agent-credit.test.ts`）
- API Test: FAIL
- Security Audit: FAIL
- L1/L3/L4 Gate: FAIL（上述失败的连锁反应）

## 根因假设
1. Test Pairing：dev agent 只写了实现文件，没配测试文件，触发项目强制的 lint-test-pairing 门禁
2. API Test / Security Audit：需要实际查日志才能确认，怀疑与 licenseAuth 中间件 mock 方式或 credits.service 依赖注入方式有关；Security Audit 大概率是扫描到硬编码密钥/不安全模式，需要具体核实

## 关联上下文
- 所属 Initiative：获客 Agent 安卓设备接入（Brain project_id 35968106-c7d4-4b82-8fa9-0da631b6ef32）
- 相关 Journey：客户智能获客采集闭环（journey_id afa6abca-53c0-4815-8594-b7fb81ca547f）
- 无匹配历史决策（decisions/match 返回空）

## 修法
在独立 worktree 里：
1. 补 `apps/api/src/routes/agent-credit.test.ts`（覆盖 balance/deduct 两个端点的正常/异常路径）
2. 查 API Test 失败的具体 assert，修复实现或测试
3. 查 Security Audit 失败的具体规则命中，按规则要求修复（不绕过/不加白名单例外，除非确认是误报）
4. push 更新，确认所有 CI 门禁转绿

## Regression Test 计划
新增的 agent-credit.test.ts 本身就是这次修复的回归测试，覆盖 401/403/400/200/402/500 六种响应路径，永久留在 CI 里。

## 验收标准
- [ ] failing 状态已复现确认（当前 PR CI 页面即为复现）
- [ ] agent-credit.test.ts 补齐并覆盖 balance/deduct 全部分支
- [ ] API Test 失败根因确认并修复
- [ ] Security Audit 失败根因确认并修复（不是靠加白名单绕过）
- [ ] CI 全绿
- [ ] PR #1089 合并
