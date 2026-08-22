# 接缝清单 — 路③ Sprint E · S4 加厚 rollup/lookup 聚合

「碰真实世界的点」逐条登记（合同 ⚡ 接缝 vs 逻辑 规则）。逻辑断言 CI 绿=真 done；接缝断言必须在真目标验证。

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | done 判定 |
|---|--------|----------------|----------------|-----------|
| 1 | 聚合读 ↔ `db_rows.data` JSONB | rollup 顺 relation 目标 row_ids 去目标表捞值聚合；JSONB 数字以 string 存（`"12"`）须 `Number()` 规整计入 | linux job 真 Postgres：`test:workbench-rollup` A37 双企业种子 + smoke `--rollup-a37-only` psql 验 sum/min/max/concat/lookup 手算相等 | 真 PG 验过才 done |
| 2 | 聚合基数 org 二次校验 ↔ 真库脏数据 | 直接改库把目标行 org 改成他企业后读 rollup，被篡改行不进聚合基数 | vitest A38 真 UPDATE org_id 注入 + smoke `--rollup-a38-only` 断言 count 减1/sum 不含 | 真库篡改注入验过才 done |
| 3 | 失效降级三支 ↔ 真软删 | 删 relation 字段 / 删目标字段 / 软删目标表 → rollup 值 null+degraded | vitest A39 真软删真查 + smoke `--rollup-a39-only` 三支各 psql 验降级 | 真软删验过才 done |
| 4 | 类型×函数校验 ↔ 建字段真路径 | sum/min/max 配非 number 目标 → 400 拒绝，非静默 NaN | vitest A40 真建字段收 400 + smoke `--rollup-a40-only` | 真建字段拒绝验过才 done |
| 5 | 单元格聚合值展示 ↔ 真浏览器 DOM | 配 rollup 字段 → 单元格显示聚合值 / lookup 多值 / 失效降级占位 | windows_cloud（GHA windows-latest）真浏览器 `@rollup-build`/`@rollup-lookup`/`@rollup-degrade` + 截图 | windows job success + 截图才 done（CI 绿≠done） |
| 6 | 无运行时 DDL ↔ 真 information_schema | 建 rollup 字段 + 读聚合全程 schema 不变、零 rollup 物理表、配置存 options 不物化 | vitest A40 真 PG information_schema 前后快照逐字节比对 + smoke `--rollup-ddl-only` | 真库快照验过才 done |
| 7 | 墙裁定 ↔ 源码 import 图 | rollup 读服务钉死路径不被 knowledge 检索特征文件 import | A41 源码守卫脚本 `scripts/rollup-wall-guard.sh`（grep 靶固定，无需 DB） | 源码守卫绿 = done（纯逻辑接缝） |

逻辑断言（CI 绿=真 done）：Response Schema keys 完整性/禁用字段反向断言（纯响应形状）、404 优先于 400（路由分支逻辑）、A41 源码守卫、变异开关 proven-to-fire（源码注入+段红判定）。

**无 logic-done-pending 项**：所有接缝均有对应真目标验证通道（linux 真 PG job + windows 真浏览器 job），无「只在假环境验过就标 done」的点。J13 读时计算不落库 = 从根消解一致性接缝（无缓存 → 无过期），非 pending。
