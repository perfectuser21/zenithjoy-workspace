# Learning: Pipeline 审核评分前台显示

**分支**: cp-03311211-pipeline-review-scores
**日期**: 2026-03-31
**影响范围**: zenithjoy dashboard PipelineOutputPage + cecelia orchestrator/routes

## 根本原因

后端 executeCopyReview/executeImageReview 已接入 callLLM 并返回逐条规则评分（rule_scores）和通过状态（review_passed），但整条链路存在三处断点：

第一处：orchestrator 的 `_executeStageTask` 存储 review 结果时，只保存了 `review_issues` 和 `review_passed`，丢弃了 `rule_scores` 和 `llm_reviewed` 字段，导致评分数据从未入库。

第二处：`/stages` API 的 SQL SELECT 语句未包含 `payload->'rule_scores'` 和 `payload->>'llm_reviewed'`，即使数据库有值也无法返回给前端。

第三处：前端 `StageInfo` TypeScript 类型未定义 `review_passed`、`rule_scores`、`llm_reviewed` 字段，也没有任何 UI 来渲染这些字段。

## 解决方案

1. **orchestrator**：在存储 payload 时条件性追加 `rule_scores` 和 `llm_reviewed`，同时处理 `llm_review`（旧命名）→ `llm_reviewed: true` 的映射
2. **routes**：SQL 增加 `payload->'rule_scores' AS rule_scores` 和 `payload->>'llm_reviewed' AS llm_reviewed`，response 中用 `if (row.xxx !== null) entry.xxx = ...` 条件附加
3. **前端**：扩展 `StageInfo` 接口，在阶段卡片中渲染通过/失败徽章和逐条评分列表

## 关键经验

- cecelia 的 CI 只对 `pull_request` 事件触发 L1-L4，但合并冲突的 PR 不会触发 `synchronize` 事件。每次 main 分支有新 commit 合并进来后，都需要立即 `git merge origin/main` 解决冲突，否则后续 push 不会触发 CI。
- `check-dod-mapping.cjs` 只读 `.prd.md` 的第一个 `## 成功标准` 章节（到下一个 `#` 级标题为止）。若 `.prd.md` 有多个 `## 成功标准`，必须把当前 PR 的条目添加到第一个章节里，否则 DoD 追溯检查会失败。
- feat PR 的 L3 要求必须有测试文件变更（`feat PR 必须包含测试文件改动`）。即使代码本身功能正确，也需要在已有测试文件里添加至少一个新测试用例。
