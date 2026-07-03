# Bug PrepPRD：Line02 智能获客两处跨租户数据泄露

## 症状
1. `GET /api/acquisition/leads` 返回全平台所有租户最新 500 条 leads，无租户过滤——任意登录用户能看到其他客户的获客数据。
2. `POST /comment-score-result` 用 `SELECT id FROM zenithjoy.tenants LIMIT 1` 给评论/lead 认领"随便一个租户"，导致抓到的评论可能写进跟本次采集任务无关的另一个客户账号下。

## 根因假设
`acquisition.ts` 里存在两套并行的租户识别机制：一部分端点走 `tenantContextOptional` 中间件从登录 session 解析 `req.tenantId`，另一部分（这两处）从未接入该机制，写 SQL 时要么完全漏了 `WHERE tenant_id`，要么用 `LIMIT 1` 兜底猜租户。

## 关联上下文
- Journey：Line 02（客户智能获客路径）
- 相关 Issue：无已登记（今天调研中新发现，未被 #1057/#1074/#1075/#1077 覆盖）
- 无法查询 Brain decisions（API 不可达）

## 修法
1. `apps/api/src/routes/acquisition.ts` `GET /leads`（~L498-508）：接入 `tenantContextOptional`（或强制 `tenantContext`），SQL 加 `WHERE tenant_id = $1`。
2. `apps/api/src/routes/acquisition.ts` `POST /comment-score-result`（~L411-413）：删除 `SELECT id FROM tenants LIMIT 1`，改为从该评论所属的 `acquisition_collect_tasks`（按 `collect_task_id`/`keyword_task_id`）反查真实 `tenant_id`。

## Regression Test 计划
- Test 1：造两个租户各自的 leads，用租户 A 的 session 调 `GET /leads`，断言结果里不包含租户 B 的记录（当前实现会 FAIL，因为返回全部）。
- Test 2：造一个属于租户 B 的 collect_task，调 `comment-score-result` 上报结果，断言写入的 lead 的 `tenant_id = 租户B`，不是 `tenants` 表里排第一的任意租户（构造多租户场景让"取第一个"必然对不上，即可稳定复现）。
- 两个 test 都是纯逻辑接缝（DB 查询 + SQL 过滤条件），CI test 即可，不需要环境自检。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] CI 全绿
- [ ] 两个 test 永久留在 CI 里当 regression test
