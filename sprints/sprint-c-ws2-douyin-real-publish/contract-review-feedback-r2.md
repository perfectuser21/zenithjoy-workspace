# Contract Review Feedback — Round 2

**Reviewer 角色**：Skeptical staff engineer
**审查对象**：`contract-draft.md` round 2（加了 Risks 栏）+ `contract-dod-ws3.md` round 2（正向校验）

## RUBRIC SCORES

```json
{
  "dod_machineability": 8,
  "scope_match_prd": 9,
  "test_is_red": 9,
  "internal_consistency": 8,
  "risk_registered": 8
}
```

总分 42/50（round 1 = 38/50，进步 +4 — 非 PIVOT 信号）。

### 评分证据（与 round 1 比较）

- **DoD 机检性 = 8**（持平）：仍是 psql / node -e / supertest / spawnSync 真命令。
- **Scope 匹配 PRD = 9**（持平）：1:1 覆盖未变。
- **Test 真红 = 9**（持平）：测试文件未变。
- **内部一致 = 8**（+1）：ws3 dod 改成正向校验 `grep require qr-login` + 加 `await requireLogin` 防 require-but-no-call 作弊。新加 Playwright class 选择器禁用规则跟 R3 mitigation 一致。
- **风险登记 = 8**（+3）：新加 Risks 栏含 R1-R5 5 条具名 risk + 每条 mitigation + cascade 失败处理 + 严禁 silent retry。覆盖了抖音风控 / xian-pc 离线 / UI 改版 / lead 扫码超时 / Windows 路径兼容 5 个真用户场景。

## VERDICT: APPROVED

Round 2，阈值 7/10。
全部 5 维 ≥ 7（最低分 8）→ APPROVED。

GAN 收敛（round 1 的 1 个 block 项已修，无新 meta-attack 冒头，合同未膨胀）。

## 进入下一阶段

- task-plan.json 5 workstream 线性 DAG 已就绪
- 可调 /harness-generator 启动 Generator 写 5 ws 实现
- 提醒 Generator：
  - TDD commit 顺序（commit 1 = 测试 Red，commit 2 = 实现 Green）
  - 加厚两段式（commit A 删 dryrun + replaces_old_thin，commit B 写新）
  - R3 mitigation：Playwright 选择器禁用 class，用 data-testid / aria-label / role
  - 各 ws 错误必须显式 failed + reason，严禁 silent fallback / silent retry
