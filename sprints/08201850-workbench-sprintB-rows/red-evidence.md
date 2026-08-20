# Red 证据 —— 路③ Sprint B（S2 录数据）合同测试首跑全红

命令：`cd apps/api && vitest run --config <本 sprint 收集配置> --reporter=json`
（收集配置 `apps/api/vitest.workbench-rows.config.ts` 属 Green 阶段交付物，Red 阶段用等价的临时配置跑，include 逐字相同。）

库：真 Postgres `zenithjoy_e2e`（禁 mock 边清单要求代码 ↔ db_rows/db_fields/db_audit 真读真写）。

```json
{
  "numTotalTestSuites": 8,
  "numTotalTests": 20,
  "numFailedTests": 20,
  "numPassedTests": 0,
  "success": false
}
```

**20 / 20 失败，0 通过** —— 行端点族与 `db_rows.version` 列在 origin/main 上都不存在，全红符合预期。

逐条失败用例：

- `rows-crud.test.ts`
  - failed · 建行返 201 且 version 为 1 — AssertionError: expected 404 to be 201 // Object.is equality
  - failed · 空表列行返零行且带 total 与 row_limit — AssertionError: expected 404 to be 200 // Object.is equality
  - failed · 八类字段各改一次逐字落库 — TypeError: Cannot read properties of undefined (reading 'row_id')
  - failed · 类型不符返 400 且该格逐字未变 — TypeError: Cannot read properties of undefined (reading 'row_id')
  - failed · 表已软删后其行不可读写 — TypeError: Cannot read properties of undefined (reading 'row_id')
- `rows-isolation-export.test.ts`
  - failed · 跨组织改行返 404 且原行逐字未变 — TypeError: Cannot read properties of undefined (reading 'row_id')
  - failed · 本组织正向读得到自己的行 — TypeError: Cannot read properties of undefined (reading 'row_id')
  - failed · 删行软删物理行仍在 — TypeError: Cannot read properties of undefined (reading 'row_id')
  - failed · 还原后全字段逐字回归 — TypeError: Cannot read properties of undefined (reading 'row_id')
  - failed · 导出行数与库一致且零他组织数据 — TypeError: Cannot read properties of undefined (reading 'row_id')
  - failed · 对抗输入作为数据值落库且表清单未变 — AssertionError: payload 触发了 5xx：<img src=x onerror=a: expected [ 201, 400 ] to include 404
- `rows-optimistic-lock.test.ts`
  - failed · 成功 PATCH 后 version 恰加一 — TypeError: Cannot read properties of undefined (reading 'row_id')
  - failed · 同基线并发提交恰一个 200 一个 409 — TypeError: Cannot read properties of undefined (reading 'row_id')
  - failed · 409 时库中该格等于先提交者的值 — TypeError: Cannot read properties of undefined (reading 'row_id')
  - failed · 基线 version 缺失或非数字返 400 而不是被当成放行 — TypeError: Cannot read properties of undefined (reading 'row_id')
- `rows-paste-limit.test.ts`
  - failed · 粘贴 N 行落库恰 N 行 — AssertionError: expected 404 to be 201 // Object.is equality
  - failed · 未匹配列自动建为文本类型 — AssertionError: expected 404 to be 201 // Object.is equality
  - failed · 超上限整批拒绝且库中零新增 — AssertionError: expected 404 to be 400 // Object.is equality
  - failed · 行数达上限时单条建行同样被拒 — AssertionError: expected 404 to be 201 // Object.is equality
  - failed · 不设环境变量时上限默认为 5000 — AssertionError: expected 404 to be 200 // Object.is equality

> `numTotalTestSuites` 实测为 8（vitest `getSuites()` 把「文件」与「describe」各算一个 suite，4 文件 × 2 = 8），
> 合同 r2 写的 `== 4` 在 vitest 3.2.6 上恒假。见 PR body 的 [CONTRACT_DEFECT] 段。
