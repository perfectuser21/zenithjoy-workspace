# TDD Red 证据 — 批量混剪加厚（frozen contract tests）

冻结合同测试已随 `chore(harness): import contract` 预置于 `sprints/09201034-batch-mashup-script-preview-candidates/tests/`，
Red 阶段不重复 checkout（TESTS_ALREADY_PRESENT 分支）。以下为实现前（HEAD=import contract）在真 Postgres 上执行冻结测试的红证据。

环境：真 Postgres（DB_URL / E2E_DATABASE_URL 指向 acceptance scratch 库，已 apply 全部 migration）。
命令：`npx vitest run sprints/09201034-.../tests/ --config vitest.sprint.config.ts`

结果：total 7 / passed 1 / failed 6

| 测试 | 状态 |
|---|---|
| Step3 候选带 thumbnailUrl 与 generatedCount（结果形状） | FAILED（generateCandidates 无 generatedCount/thumbnailUrl/renderStatus） |
| Step3 候选生成期 render_status 恒 pending（落库无真实渲染） | FAILED（mashup_candidates 无 render_status 列） |
| Step2 preview 返回重签 previewUrl 与 previewAvailable | FAILED（GET /api/materials/:id/preview 未注册 → 默认 404） |
| Step2 跨租户 preview 返回 404（租户隔离 INV-1） | PASSED（假红：端点未注册，Express 默认 404 恰好命中 404 断言；实现后为真实租户隔离 404，仍绿） |
| Step2 无凭据 preview 返回 401 | FAILED（端点未注册返回 404 而非 401） |
| Step1 AI 不可用降级 degraded fallback | FAILED（generateTemplateFromScript 未实现 → import 失败） |
| Step1 from-script 返回动态 slots 并落库 | FAILED（generateTemplateFromScript 未实现 → import 失败） |

注：`跨租户 preview 404` 一条在 Red 阶段因端点尚未注册、命中 Express 默认 404 而“假绿”——冻结测试字节不可改（CONTRACT IS LAW），此为其固有性质。实现 preview 端点后该断言由真实“素材不属于该租户→404”语义满足，Green 阶段仍绿，无回归风险。其余 6 条为真红，实现后全部转绿（见 green-evidence）。
