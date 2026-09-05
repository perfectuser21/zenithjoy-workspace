# Handoff：adb-controller-bridge preflight account_verified 因不存在的 platform 字段恒为 false（PR#1779）

- task_id: `unknown`（本次为直接委派的 bug 修复，未经 `POST /api/brain/tasks` 注册）｜ verdict: **PASS** ｜ 2026-09-05

## 完成

- 根因确认：`scripts/openclaw/adb-controller-bridge.sh` 的 `cmd_preflight` 用
  `select(.agent_id==$aid and .platform=="douyin" and .role=="burner" and .status=="active")`
  过滤 `GET /api/agent/burner/sessions` 返回的 session 列表；读 `apps/api/src/routes/agent-burner.ts`
  确认该端点 SQL `SELECT` 列表根本没有选 `platform` 这一列（`platform='douyin'` 只在 `WHERE`
  子句里，是查询条件，端点本身就是 douyin 专用端点）。真实返回对象没有 `platform` key，
  `.platform=="douyin"` 恒等于 `null=="douyin"=false`，导致 `account_verified` 无论真实账号
  是否 active 都永远误判为 false。真机验证实锤：agent `e017953c-bc65-47e0-913e-a2ed5eb54993`
  实际有 2 个 `status=active` 抖音小号（"大湖成长之路（Ai+）"、"秦军餐饮"），但 preflight 一直报
  `account_verified=false`。
- 修法：`cmd_preflight` 过滤条件去掉 `.platform=="douyin"`，只保留
  `agent_id==$aid and role=="burner" and status=="active"`。
- TDD 两次 commit：commit `45fed5bf`（RED）修正已有成功用例的 mock 为真实字段形状（不含
  `platform`，之前 mock 恰好带了假 `platform` 字段掩盖了 bug）+ 新增用真机实测两条真实数据的
  regression 用例；commit `4bc497c0`（GREEN）修复代码，两条测试转绿。
- 本地验证：`node --test scripts/openclaw/**/*.test.js` 56/56 通过（该测试文件已在
  `ci-l3-code.yml` 的 `openclaw-scripts-test` 必过 job 里）；`shellcheck` 无警告。
- CI 全绿后 auto-merge 合并（squash commit `b6e9f759`）。

## 没完成

- 无。这是一个单点明确 bug 的最小修复，不含额外范围。

## 下一步

- 完成，无下一步。（PrepPRD 里提到：看了一下返回对象里 `agent_hostname`/`computed_online_status`
  等字段目前没发现明显误用，暂不做额外改动——如未来需要更精确判定"是不是要找的这个抖音账号"，
  可另开小改动评估是否要用这些字段加强判断。）

## 数据源

`scripts/openclaw/adb-controller-bridge.sh`（`cmd_preflight`）、
`scripts/openclaw/__tests__/adb-controller-bridge.test.js`、
`apps/api/src/routes/agent-burner.ts`（GET `/sessions` 端点，第 320-380 行）

## 决策引用

`f87c243a`（Brain strategic-decisions，category=bug-fix，本次根因与修法记录）

## 产物

PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1779 ｜ 分支: `cp-09051047-fix-preflight-platform-field` ｜ merge commit: `b6e9f759`
