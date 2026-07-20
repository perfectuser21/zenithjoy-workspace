# Bug PrepPRD：account-scan-result 落库丢失 error_code，无法诊断真机扫描失败原因

## 症状
真人真机测试连续 4 次 `account_scan` 任务全部返回 `{ok:false, account_ids:[]}`，用户已按提示授权了无障碍等权限，扫描依然失败。无法远程判断具体卡在哪一步（`OPEN_PANEL_FAILED`/`READ_FAILED`/`MUTEX_BUSY`）。

## 根因假设
Android 客户端 `AgentService.buildAccountScanResultBody` 组 POST body 时本来就带了 `error_code` 字段（`AgentServiceAccountScanTest.kt` 已验证），但服务端 `POST /account-scan-result`（`apps/api/src/routes/agent-burner.ts`）只解构了 `{ agent_id, request_id, ok, account_ids }`，UPDATE `publish_tasks.response` 时只存 `{ok, account_ids}`——`error_code` 字段被服务端完全忽略丢弃，导致查库看不到真实失败原因。

## 关联上下文
- 相关 Journey：客户智能获客路径（afa6abca-53c0-4815-8594-b7fb81ca547f），Path2 Step 7
- 相关 PR：#1424（引入该端点的 publish_tasks 闭环逻辑，本身遗漏了 error_code）
- 今天正在进行的真机联调阻塞点，P0

## 修法
`apps/api/src/routes/agent-burner.ts` 的 `/account-scan-result` handler：
1. 解构 body 时加上 `error_code`
2. `UPDATE ... SET response=$3::jsonb` 的 JSON 内容从 `{ok: !!ok, account_ids: ids}` 改为 `{ok: !!ok, account_ids: ids, error_code: typeof error_code === 'string' ? error_code : null}`

## Regression Test 计划
`apps/api/src/routes/agent-burner.test.ts`（已有 `describe('POST /account-scan-result...')` 块）新增用例：POST body 带 `error_code: 'OPEN_PANEL_FAILED'` 且 `ok:false`，断言 `UPDATE` 调用的 response 参数 JSON.parse 后包含 `error_code: 'OPEN_PANEL_FAILED'`。

> proven-to-fire：先在当前代码上跑这条新断言，确认因为 response 里没有 error_code 字段而报红，再实现后转绿。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] CI 全绿
