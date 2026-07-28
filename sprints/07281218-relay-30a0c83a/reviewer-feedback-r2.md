# Reviewer Feedback — R2（合同评审）

**Sprint ID:** 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a  
**评审轮次:** R2  
**评审时间:** 2026-07-28  
**VERDICT: REVISION**

---

## Rubric Scores（7 维）

```json
{
  "rubric_scores": {
    "iron_law_coverage":       { "score": 4, "max": 5, "verdict": "PASS" },
    "assertion_executability": { "score": 4, "max": 5, "verdict": "PASS" },
    "internal_consistency":    { "score": 2, "max": 5, "verdict": "FAIL" },
    "edge_case_coverage":      { "score": 4, "max": 5, "verdict": "PASS" },
    "cumulative_fr_regression":{ "score": 4, "max": 5, "verdict": "PASS" },
    "contract_doc_format":     { "score": 5, "max": 5, "verdict": "PASS" },
    "prd_alignment_accuracy":  { "score": 3, "max": 5, "verdict": "WARN" }
  },
  "overall_verdict": "REVISION"
}
```

---

## 打回原因

### ❌ 主要问题：A3 判定点与当前测试代码不一致（内部一致性 FAIL）

**问题描述：**

`contract-draft.md` Phase A 判定点 A3 声称：
> `T3 全通过：ability_acceptance.status === 'active'`，技术断言 `abilityGp.status === 'active'`

但实际情况：
- `scripts/product-map/__tests__/product-map.test.js` T3 当前断言：`assert.equal(abilityGp.status, 'proposed')`
- `product-map/product-map.yaml` 当前值：`status: proposed`

**风险：** dev 执行时如果只修改了 `product-map.yaml`（status: active），但漏掉更新 `product-map.test.js` T3 断言，会出现以下两种情况之一：
1. test.js T3 仍断言 `proposed` → T3 FAIL → Phase A 合同 E2E 失败，CI 红
2. dev 先升级 YAML 后跑测试，T3 断言 `active` 但测试名仍写 `proposed` → 混乱

`contract-dod.md` DoD 中 `[Fix] product-map 保序` 一节列出了 `product-map.yaml: ability_acceptance.status: active`，但**没有**将以下作为独立交付物列出：
> `scripts/product-map/__tests__/product-map.test.js`：T3 断言从 `proposed` 改为 `active`

sprint-prd.md 的 ASSUMPTION 中有提示，但 DoD 没有落地为可核查的 checkbox 交付物。

**修复要求（必须）：**

在 `contract-dod.md` 的 `[Fix] product-map 保序` 段，添加以下 checkbox：

```
- [ ] `scripts/product-map/__tests__/product-map.test.js`：T3 测试名和断言从 `status=proposed` 改为 `status=active`
```

在 `contract-draft.md` A3 判定点下方或备注中，补充说明：
> 注：T3 通过条件依赖两项同步修改——(1) product-map.yaml status: active；(2) product-map.test.js T3 断言改为 active。

---

### ⚠️ 次要问题：铁律3（日志脱敏）对应断言描述不精确

**问题描述：**

`contract-draft.md` 铁律覆盖表第3行：
> 铁律3 [日志脱敏] 对应断言：`API 单测 T6 断言无 email 泄漏到 error 响应体`

但 `tests/ability-acceptance.api.test.ts` T6 实际测试名：
> `T6: acceptance_run.created_by 等于请求头 X-User-Email（非 null 非空）`

T6 测的是 **审计字段写入**（audit field），不是 **PII 不泄漏到 error body**。
合同中没有真正针对"email 不出现在 error 响应体"的独立测试断言。

**处理方式（建议，不强制阻塞）：**
- 方案A（推荐）：将铁律3的对应断言描述改为 `API 单测 T6 验证 created_by 审计字段写入；铁律3(PII日志脱敏)通过代码审查+无硬编码断言覆盖`
- 方案B：在 API 单测中补一个专项断言：错误响应体不泄露 email 到非 data 字段

> 此问题不强制打回，但建议修复以避免铁律3在 CI 中形同虚设。

---

## 通过项（不需要修改）

- ✅ R1 三项格式硬检查全部修复：`[BEHAVIOR]` 5条（≥4）、`## E2E 验收` 段存在、`manual:bash` 2条
- ✅ 铁律 7/7 全覆盖（覆盖意图清晰）
- ✅ Phase B B1-B9 全部有具体 curl 断言 + 期望值
- ✅ Phase C C1-C5 全部有具体 Playwright selector + toBeVisible 断言
- ✅ Phase D 部署验收 D1-D6 清单完整（真环境 curl + psql 验证）
- ✅ e2e-contract.sh 已实现、可执行、覆盖 B1-B9 全9条
- ✅ 边界情况 E1-E5 覆盖全面
- ✅ 累积 FR 回归 R1/R2/R3 有对应断言
- ✅ package.json 已含 ajv@^8.20.0 + ajv-formats@^3.0.1

---

## 修复清单（最小修复，解除阻塞）

**必须修复（解除 REVISION）：**

1. `contract-dod.md` → `[Fix] product-map 保序` 段，新增 checkbox：
   ```
   - [ ] `scripts/product-map/__tests__/product-map.test.js`：T3 测试名和断言从 `status='proposed'` 改为 `status='active'`
   ```

2. `contract-draft.md` → A3 判定点（或备注），补充说明 T3 通过依赖 test.js 同步更新。

**建议修复（不阻塞，提升质量）：**

3. 铁律3对应断言描述改为准确反映 T6 实际测试内容，或补一个 PII 泄漏专项断言。
