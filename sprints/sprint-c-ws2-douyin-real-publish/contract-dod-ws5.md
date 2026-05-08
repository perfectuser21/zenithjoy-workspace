---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: smoke 升级 + Lead 自验 template + evidence

**范围**: golden-path-1-smoke.sh 升级支持 type=video + 反向 article 测试 + Lead 自验模板 + CI evidence 校验
**大小**: S
**依赖**: WS4（lead 自验需要全链路通）

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke Step 6 用 type=video 不用 image
  Test: grep -E '"type"\s*:\s*"video"' .github/workflows/scripts/smoke/golden-path-1-smoke.sh | head -1 | grep -q .

- [ ] [ARTIFACT] smoke 含 type=article 反向测试
  Test: grep -E '"type"\s*:\s*"article"' .github/workflows/scripts/smoke/golden-path-1-smoke.sh | head -1 | grep -q .

- [ ] [ARTIFACT] smoke 校验 agent.log 含 type=video 路由
  Test: grep -E 'grep.*type=video.*publish-douyin-video' .github/workflows/scripts/smoke/golden-path-1-smoke.sh | head -1 | grep -q .

- [ ] [ARTIFACT] Lead 自验模板存在
  Test: ls .agent-knowledge/golden-path-1/lead-acceptance-template.md

- [ ] [ARTIFACT] Sprint 2.1a evidence 占位文件存在
  Test: ls .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md

- [ ] [ARTIFACT] CI evidence 校验脚本/workflow 存在
  Test: (ls .github/workflows/lead-acceptance-check.yml 2>/dev/null) || grep -rE "lead-acceptance-sprint-2\.1a" .github/workflows/ | head -1 | grep -q .

## BEHAVIOR 索引（实际测试在 tests/ws5/）

见 `tests/ws5/lead-acceptance-validator.test.ts`，覆盖：
- evidence 文件不存在 → 校验 exit 1
- 文件含抖音 URL + 扫码字眼 → 校验 exit 0
- 文件含 'preset cookie' / '预置 cookie' 字眼 → 校验 exit 1（防作弊）
- smoke step 6 跑 type=video 不跑 image（grep 验证）
