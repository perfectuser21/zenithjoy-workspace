---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 6: golden-path-4-smoke.sh + Lead 自验 evidence + CI 防作弊校验

**范围**: smoke 脚本端到端跑 6 step（每 step 真调 binary，REAL_PUBLISH=0 默认）；evidence 模板对齐 sprint-2.1a 风格 + 4 类真实证据强校验（cookie ≥50 字节、wechat_id 非占位、sent_at ISO8601、feishu_record_id rec...）+ LEAD_ACCEPTANCE_VALIDATION=strict 切换；CI workflow needs:[ws1..ws5] enforce；test-registry + lint-feature-has-smoke + lint-tdd-commit-order
**大小**: M
**依赖**: ws1, ws2, ws3, ws4, ws5

## ARTIFACT 条目

- [ ] [ARTIFACT] golden-path-4-smoke.sh 存在
  Test: test -f .github/workflows/scripts/smoke/golden-path-4-smoke.sh && [ -x .github/workflows/scripts/smoke/golden-path-4-smoke.sh ]

- [ ] [ARTIFACT] evidence 模板存在 + 章节齐
  Test: test -f .agent-knowledge/path-4/lead-acceptance-path4-sprint-1.md && grep -E "^## (Checklist|Evidence|Worker Machine|真扫码|真发|真审)" .agent-knowledge/path-4/lead-acceptance-path4-sprint-1.md | wc -l | awk '{ exit ($1 < 4) }'

- [ ] [ARTIFACT] golden-path-4-smoke.yml workflow 含 needs:[ws1..ws5]
  Test: grep -E "needs:.*\[(ws1.*ws2.*ws3.*ws4.*ws5|ws1, ws2, ws3, ws4, ws5)\]" .github/workflows/golden-path-4-smoke.yml

- [ ] [ARTIFACT] test-registry.yaml 注册 ws1-ws6
  Test: for ws in ws1 ws2 ws3 ws4 ws5 ws6; do grep -E "tests/$ws/" test-registry.yaml || exit 1; done

- [ ] [ARTIFACT] lint-feature-has-smoke 含 Path 4
  Test: grep -rE "golden-path-4|path-4|wechat-rpa" .github/workflows/lint-feature-has-smoke.yml

- [ ] [ARTIFACT] smoke 真调 binary ≥ 6 次
  Test: grep -cE "(curl|psql|node |python3?|ssh|playwright)" .github/workflows/scripts/smoke/golden-path-4-smoke.sh | awk '{ exit ($1 < 6) }'

## BEHAVIOR 索引（实际测试在 tests/ws6/）

见 `tests/ws6/smoke-shape.test.ts`、`tests/ws6/evidence-strict.test.ts`，覆盖：

- REAL_PUBLISH=0 bash golden-path-4-smoke.sh → exit 0
- smoke 输出 6 step 全 ✅（grep "Step [1-6].*✅|PASS"）
- smoke binary 出现 ≥ 6 次（curl|psql|node|python|ssh|playwright）
- smoke echo/printf 占位 ≤ 12 行（防 echo 假 PASS）
- OPENROUTER_API_KEY=invalid → smoke 中途失败 exit ≠ 0
- LEAD_ACCEPTANCE_VALIDATION=strict 时 evidence cookie ≥ 50 字节非空
- LEAD_ACCEPTANCE_VALIDATION=strict 时 evidence wechat_id 非占位（不是 test_wechat_001 / placeholder）
- LEAD_ACCEPTANCE_VALIDATION=strict 时 evidence sent_at ISO8601 在 sprint 完成日 ±2 天内
- LEAD_ACCEPTANCE_VALIDATION=strict 时 evidence feishu_record_id 含 rec[A-Za-z0-9]{6,}
- LEAD_ACCEPTANCE_VALIDATION=skip 时（PRD push 阶段）模板存在即 PASS
- ws1-ws6 第一个相关 commit 必须是 test( 前缀（TDD 顺序）
