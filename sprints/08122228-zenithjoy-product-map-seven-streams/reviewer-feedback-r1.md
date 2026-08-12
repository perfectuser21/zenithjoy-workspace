# GAN Round 1 Reviewer Feedback — verdict: REVISION

## 问题 1（阻塞，scope_match_prd）
line05/07/10 三条新 GP 强制要求 `steps` 数组非空，超出 PRD 授权范围。
PRD `[ASSUMPTION]`（sprint-prd.md 第45行）只授权 Proposer 定稿三条新 GP 的 **id/name**，未授权编造 steps 业务步骤内容。
但 `tests/contract.test.js` T4（第124行）与隐含的 DoD 断言强制要求 `gp.steps.length > 0`。
核实结论：
- `product-map.schema.json` 中 `steps` 字段本身可选（不在 `required` 列表）
- `renderProductMapMarkdown` 对空 steps 有 `|| '—'` 兜底
- 现有 `line_health`（line00, active, 真实业务能力）本身就没有 steps 字段
技术上无任何必要性，纯粹是合同范围蔓延，会逼 Generator 凭空编造未经验证的业务步骤描述写入这份"分类 SSOT"文件。
**修复要求**：删除该项非空断言，或改为可选/宽松检查（不得要求 line05/07/10 必须有 steps）。

## 问题 2（阻塞，DoD/E2E 容错不一致）
`contract-dod.md` Step7/Step8 的 BEHAVIOR 命令与 E2E 脚本对 `git diff origin/main...HEAD` 用 `2>/dev/null || true` 裸吞错误；
若 origin/main 不可达（沙盒/无网络场景常见），`CHANGED` 静默退化为空字符串，导致"Cecelia 零改动""无越界文件""smoke 文件未改"三项边界检查全部空判通过（vacuous pass）。
而 `tests/contract.test.js` T7（167-192行）自己写了更健壮的 fallback（失败时改比对 `git diff HEAD`），两者行为不一致。
**修复要求**：DoD manual:bash 与最终 E2E 脚本比照 `contract.test.js` T7 补上同样的 fallback，不得裸吞错误导致空判通过。

## 其余核实通过，无需修改
- line00 二选一 deprecated 选 skill_acceptance：三重证据属实，站得住，维持
- line05/07/10 smoke 锚定真实性：三个文件均存在且内容非空，维持
- 18 条 GP 精确分布计数：手算核实完全正确，维持
- product-map.test.js T1/T3 冲突处理：已妥善纳入合同「已知约束」段，维持

## Rubric (7维标准)
```json
{
  "dod_machineability": 7,
  "scope_match_prd": 6,
  "test_is_red": 10,
  "internal_consistency": 8,
  "risk_registered": 7,
  "verification_oracle_completeness": 8,
  "ci_workflow_alignment": 10
}
```
