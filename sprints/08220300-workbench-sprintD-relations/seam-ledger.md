# 接缝清单 — 路③ Sprint D · S4 关联连得上

「碰真实世界的点」逐条登记（合同 ⚡ 接缝 vs 逻辑 规则）。逻辑断言 CI 绿=真 done；接缝断言必须在真目标验证。

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | done 判定 |
|---|--------|----------------|----------------|-----------|
| 1 | relation 值读写 ↔ `db_rows.data` JSONB | 关联值以目标 row_id 数组真落 JSONB、真反查 | linux job 真 Postgres：`test:workbench-relations` + smoke `--a27/--a30/--a31` 段 psql 验数组落库 | 真 PG 验过才 done |
| 2 | 读路径二次校验 ↔ 真库脏数据 | 直接改库把目标行 org 改成他企业后展开候选 | smoke `--a27-only` 真 UPDATE org_id 注入 + 断言候选剔除 | 真库篡改注入验过才 done |
| 3 | 点关联项跳转 ↔ 真浏览器 DOM | 单元格点击→跳转目标记录详情面板 | windows_cloud（GHA windows-latest）真浏览器 `@relation-jump` + 截图 | windows job success + 截图才 done（CI 绿≠done） |
| 4 | 反向面板可见性 ↔ 真双会话 | 「仅自己」表反向面板仅表主可见 | 真会话 alice/bob 两 cookie 反查断言（vitest + windows `@relation-backref`） | 真双会话验过才 done |
| 5 | 无运行时 DDL ↔ 真 information_schema | 建字段+建关联全程 schema 不变 | 真 PG information_schema 前后快照逐字节比对 | 真库快照验过才 done |

逻辑断言（CI 绿=真 done）：Response Schema keys 完整性/禁用字段反向断言（纯响应形状）、404 优先于 400（路由分支逻辑）、变异开关 proven-to-fire（源码注入+段红判定）。

**无 logic-done-pending 项**：所有接缝均有对应真目标验证通道（linux 真 PG job + windows 真浏览器 job），无「只在假环境验过就标 done」的点。
