# Bug PrepPRD：adb-controller-bridge.sh preflight 里 account_verified 因不存在的 platform 字段永远误判为 false

## 症状
真机验证（rog，agent_id=e017953c-bc65-47e0-913e-a2ed5eb54993）跑 `adb-controller-bridge.sh preflight` 时，
`account_verified` 始终为 false，即便该 agent 在 `GET /api/agent/burner/sessions` 里实际有 2 个
`status="active"` 的抖音小号（"大湖成长之路（Ai+）"、"秦军餐饮"）。

## 根因假设 → 已确认为真根因
`scripts/openclaw/adb-controller-bridge.sh` 的 `cmd_preflight` 用
`jq --arg aid "$AGENT_ID" '[.data.sessions[]? | select(.agent_id==$aid and .platform=="douyin" and .role=="burner" and .status=="active")] | length > 0'`
过滤 session 列表，其中 `.platform=="douyin"` 这个条件所查的 `platform` key 在真实 API 响应里根本不存在。

读 `apps/api/src/routes/agent-burner.ts` GET `/sessions` 端点确认：
- SQL `SELECT` 列表（第 325-339 行）只选了 `account_label, role, status, bound_at, device_type,
  created_at, agent_id, uia_online, uia_checked_at, uia_error, agent_hostname, agent_nickname,
  agent_status, last_heartbeat_at, heartbeat_online, account_nickname`，叠加 JS 层算出的
  `computed_online_status`——**没有 `platform` 这一列**。
- `platform='douyin'` 只出现在 SQL `WHERE` 子句（第 346 行），是查询条件，不是返回字段。该端点
  本身就是 douyin 专用端点，不需要也不应该在返回结果里再判断 platform。

结论：`.platform=="douyin"` 恒等于 `null=="douyin"` → false，导致 `account_verified` 无论真实账号
是否 active 都永远为 false。

## 关联上下文
- 相关 Journey：线索/关键词获客（keyword_acquisition，GP_ANCHOR）；`adb-controller-bridge.sh` 由
  PR#1777（feat(openclaw): adb_controller → phonectl.sh 信号桥适配层）随 main 合并。
- 相关历史决策：`decisions/match` 查询未命中已有记录（本次为新发现）。

## 修法
1. `scripts/openclaw/adb-controller-bridge.sh` 的 `cmd_preflight`：jq select 去掉
   `.platform=="douyin"` 判断，只保留 `.agent_id==$aid and .role=="burner" and .status=="active"`。
2. `scripts/openclaw/__tests__/adb-controller-bridge.test.js`：
   - 修正已有成功用例的 mock session 对象为真实 API 响应字段形状（不含 `platform`），避免继续掩盖同类 bug。
   - 新增一条 regression 用例，直接用真机实测拿到的两条真实 session（脱敏后）作为 mock，断言
     `account_verified === true`。

## Regression Test 计划
新增/修正的 node:test 用例本身就是可复现该 bug 的 failing test：改动前，用真实字段形状的 mock 会让
`account_verified` 判定为 false（应为 true），测试失败；改完代码后测试转绿，且永久留在
`scripts/openclaw/__tests__/adb-controller-bridge.test.js` 里跑（CI 已接入该测试文件）。

逻辑接缝（纯 jq 过滤计算）→ regression test 足够，不需要额外环境自检。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] CI 全绿
