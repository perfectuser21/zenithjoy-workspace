# Red 证据 — 路③ Sprint C（S3 视图切得开）

commit 1 (Red)：合同 tests/ 已随 contract import 存在于分支（relay 常态），本 commit = DoD.md + 本证据。

## vitest 收集执行结果（实现未写时，合同 4 文件真被收集真跑真红）

```
配置：apps/api/vitest.workbench-views.config.ts
命令：cd apps/api && npx vitest run --config vitest.workbench-views.config.ts --reporter=json
testResults(files)=4  numTotalTests=20  numPassedTests=2  numFailedTests=18  exit=1
```

## 逐用例状态（18 红 / 2 绿）

> 2 绿是既有行为未被本刀改动的旁证（GET rows 默认形状、跨表 field_id 已有 404 口径）；
> 视图端点族（GET/POST/PATCH/DELETE views、assigned-to-me）、filter/sort 参数、groupRowsByField 纯函数
> 在 origin/main 上都不存在，对应用例全红。

```
[failed] views-crud.test.ts › 建视图返 201 且 keys 恰好十个，禁用字段名一个不出现，三键真落 db_view_prefs
[failed] views-crud.test.ts › GET views 纯读零写入副作用，空表返 views 空数组与 active_view_id 为 null
[failed] views-crud.test.ts › 删视图只删偏好三表逐字不变，且 remaining 计数正确
[failed] views-crud.test.ts › 删到最后一个视图返 400 LAST_VIEW_PROTECTED 且该行仍在
[failed] views-filter-sort.test.ts › 按文本字段筛返回集合完全一致
[failed] views-filter-sort.test.ts › 按数字字段排是数值序不是字典序
[passed] views-filter-sort.test.ts › 不传参数时响应与 Sprint B 逐字相同
[failed] views-filter-sort.test.ts › 原始 SQL 片段返 400 且表清单未变
[failed] views-filter-sort.test.ts › 跨表 field_id 返 404 同形
[failed] views-group-type.test.ts › 七类非单选字段做分组一律 400 GROUP_FIELD_TYPE_INVALID
[failed] views-group-type.test.ts › single_select 做分组正向 200 —— 堵「一律 400」的假绿
[failed] views-group-type.test.ts › 400 时视图 prefs 逐字未变 —— 不进看板也不留半截状态
[failed] views-group-type.test.ts › 未分组三态：null 缺键 空串三行全归未分组列，有值行归其选项列
[failed] views-isolation-degrade.test.ts › 他企业会话读改删视图一律 404 同形
[failed] views-isolation-degrade.test.ts › 同组织他人读改删本人视图一律 404 同形，且列表里零命中
[failed] views-isolation-degrade.test.ts › 本组织正向拿到自己的视图 —— 堵「一律 404」的假绿
[failed] views-isolation-degrade.test.ts › 已删字段的视图降级且 degraded 为 true
[passed] views-isolation-degrade.test.ts › 他企业 field_id 写入返 404 同形
[failed] views-isolation-degrade.test.ts › prefs 存 field_id 而非字段名，改显示名后视图不失效
[failed] views-isolation-degrade.test.ts › 视图三动作全部落 db_audit
```
