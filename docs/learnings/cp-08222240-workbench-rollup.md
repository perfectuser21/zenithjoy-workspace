# Learning — 路③ Sprint E · S4 加厚 rollup/lookup 聚合

**Sprint**: 08222228-workbench-rollup-sprintE · **GP**: line11 员工知识中枢 / 路③ 结构化工作台（c86e37ff）

## 做了什么

在 S4「关联连得上」之上加一层读时聚合：员工给 relation 字段配 rollup 汇总字段（count/sum/min/max/concat）
或 lookup 字段（取关联行某字段展示）。采**读时计算不落库**、配置存 `db_fields.options` 位序三元组、
**零新建物理表**。新增 1 个只读端点 `GET /tables/:id/rollups`，扩展 `POST /fields` 支持 rollup/lookup 类型×函数校验。

## 关键决策 / 踩坑

1. **读时计算不落库（J13）**：聚合值不物化，`GET /rollups` 每次顺 relation 目标 row_ids 现查目标表聚合。
   子记录一改下次读即最新，零一致性维护，守住「无运行时 DDL + 零新表」不变式。`information_schema`
   建 rollup 字段前后逐字节全等（DDL 断言不受 migrate 期 CHECK 扩容影响——那是 migrate 落地非运行时）。

2. **配置存位序三元组（J14）**：`options=[relation_field_id, target_field_id, fn]`（lookup 无 fn 位）。
   既有 `normalizeFields` 对 options 元素做 `String()` 强转，对象 schema 会被压成 `[object Object]`——
   位序 string[] 是零改动唯一适配，复用现有 JSONB 列。**count 的 target_field_id 传空串 `""`**。

3. **数值规整（A37）**：JSONB 数字可能以 string 存（粘贴导入一律文本）。sum/min/max 聚合前 `Number()`
   规整，`Number.isFinite` 过滤——string `"12"` 计入（52=10+30+12，**绝不字符串拼接冒充 sum**），
   非数值 `"abc"` 跳过 + `degraded=true`。空/缺值静默跳过不算脏（不 degrade），只有非空非数值才 degrade。

4. **两种 degraded 语义**：① 依赖失效（A39 删 relation 字段/目标字段/软删目标表）→ `value=null` + degraded；
   ② 数据质量（sum 混入非数值行跳过）→ `value=<有效聚合>` + degraded。**degraded=true 不强制 value=null**。

5. **org 隔离靠聚合基数二次校验（A38）**：`fetchTargetRows` 的 `AND r.org_id=$orgId` 把库里被越权
   改成他企业的目标行剔出聚合基数（count 减 1、sum 不含）。变异去掉该条件即 `--rollup-a38-only` 段红。

6. **A41 墙裁定钉死路径**：rollup 读逻辑必须落 `workbench-rollup.service.ts`，不并入 relation 服务——
   给守卫固定 grep 靶，避免『或等价路径』导致 must-not-import 恒空假绿。检索特征文件（`apps/api/src/knowledge/`）
   零 `workbench-rollup` 命中。读时计算不落库 → rollup 富数据天然不进任何可检索物理表，墙在数据层成立。

7. **失效降级复用 relation 解析链**：删 relation 字段后它不在 `getTable` 活字段清单里 → planField 解析
   不到 → degrade。目标表软删 → `getTable` 返 null → degrade。与 Sprint D relation 悬空安全失效同机制。

## 验收

vitest 4 文件 20 用例真 PG 全绿；smoke 五段（A37/A38/A39三支/A40/DDL）+ A41 守卫 + 4 变异 proven-to-fire
本地全过；windows_cloud 真浏览器 rollup 链（@rollup-build/lookup/degrade）接进既有 `e2e-knowledge-hub-path3.yml`。
