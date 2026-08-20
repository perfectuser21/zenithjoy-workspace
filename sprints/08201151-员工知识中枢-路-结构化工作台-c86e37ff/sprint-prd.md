# Sprint PRD — 员工知识中枢 路③ 结构化工作台 · Sprint A（底座与三道门）

## OKR 对齐

- **对应 KR**：员工知识中枢 Journey `da60cb26`（Staff Hub 结构化工作台）｜**当前进度** 0%（路③尚无交付）｜**本次推进预期** 25%（四刀 A/B/C/D 串行中的第一刀）

## 背景

员工手上出现一批需持续跟踪的同构工作项，需要在 **Staff Hub** 像 Notion database 一样建表/录数/筛排/切看板/连关联，组织隔离、可导出、删错可恢复。合同（`.harness/gp3-contract-v3.json`，CONTRACT IS LAW）把这件事切成四刀严格串行，本 sprint = **Sprint A**：只做底座（G0 权限 / G1 字段表隔离 / G2 备份 / JSONB 存储）+ S1 建表最小闭环。G2 必须在真实经营数据进表之前落地，放到后面就是明知故犯。

## Golden Path（核心场景）

员工从 [Staff Hub 结构化工作台入口] → 经过 [选模板或新建表、加自定义字段、设可见性] → 到达 [本组织工作台列表里看到这张表，删错还能从回收站还原]

具体：
1. 员工登录 Staff Hub，点进「结构化工作台」，空工作台先看到 ≥2 个开箱模板卡片
2. 员工点「新建表」，填表名，逐个添加自定义字段（文本/长文本/数字/日期/单选/多选/人员/URL 八类），选表级可见性（仅自己 / 组织可见），提交
3. 系统建表成功，该表出现在**本组织**工作台列表；刷新页面后字段定义（名/类型/选项/顺序）逐字还在
4. 同组织另一员工打开工作台：「组织可见」的表看得到；「仅自己」的表列表里没有，直接访问返 404（与随机不存在 id 的响应逐字节相同）；他企业员工任何路径都看不到
5. 员工点删表，二次确认输入表名后删除，表从列表消失；进回收站看到该表，30 天内点还原，表元数据与字段定义逐字回归

## 边界情况

- 同一 `feishu_user_id` 在 `tenant_members` 出现多组织行 → 启动自检 fail-closed 输出明确错误码，不静默取第一条
- 跨组织不可达与不存在**统一返 404、同一文案、同一响应形状**（反枚举）；二次确认输错表名 → 不执行删除
- 建表全程**不产生运行时 DDL**：跑完建表后 `information_schema.tables` 表清单与 migration 声明集合完全相同
- 用户输入的字段名与单元格值永远只作为**数据值**走绑定参数；渲染后必须是文本节点（XSS 窄面）
- 段① 给 `/api/fields` 挂鉴权后，`fields-smoke.sh` 与 `zenithjoy-smoke-audit.sh` 会被打成 401，**必须同刀改**为带身份头

## 范围限定

**在范围内**：
- **G0 权限底座**：`workbenchAuthGuard`（复用/泛化路① `knowledgeAuthGuard`），身份与组织归属只来自服务端会话；A2 静态守卫脚本（七个禁用字面量零命中）
- **G1 字段表隔离**：新建带 `org_id NOT NULL` 的字段元数据表（**绝不复用**旧 `zenithjoy.field_definitions`）；J7 四段：① `routes/fields.ts` 四端点挂 `[tenantContext, tenantBypass]` ② `field_definitions` 加 `tenant_id` migration + 回填 + `fields.service.ts` 五处 SQL 补条件 ③ 两个 smoke 脚本改带身份头 ④ dashboard 真浏览器回归对照（业务代码零改动）
- **G2 备份**：`pg_dump` 定时 workflow（`schedule` 持久载体）+ 恢复演练脚本与断言
- **存储底座**：JSONB 行存 migration —— `db_tables` / `db_fields` / `db_rows(id, table_id, org_id, data jsonb, version, deleted_at)` / `db_view_prefs` / `db_audit` 五表，全部 `org_id NOT NULL`，表/行/字段 id 一律 UUID
- **S1 建表最小闭环**：`/api/knowledge/db/tables` 端点族 + 字段元数据端点 + Staff Hub 工作台列表页 + 建表 UI + 8 类字段编辑器（渲染器可最简）+ 开箱模板 + 表级可见性（真访问控制，非显示过滤）+ 软删表回收站
- **A35 前向兼容锚**：`apps/api/src/knowledge/retrieval-exclusions.ts` 导出常量数组，逐字含五张表物理表名
- **smoke**：`.github/workflows/scripts/smoke/structured-workbench-smoke.sh`
- **独立 E2E workflow**：`.github/workflows/e2e-knowledge-hub-path3.yml`（`on:` 含 `pull_request`，`windows-latest` job **无 job 级 if 门**）

**不在范围内**（留后续 sprint，本刀一行不写）：
- **S2 录数据行内编辑**（Sprint B）：AG Grid 移植、行 CRUD、乐观锁 409、剪贴板粘贴导入、行详情面板、软删行、JSON 导出、5000 行上限拦截
- **S3 视图看板**（Sprint C）：筛选/排序、dnd-kit 看板、视图切换器、ViewPrefs 读写、「指派给我」全局视图
- **S4 关联**（Sprint D）：Relation 字段类型、行选择器、反向引用面板、删行/删字段的引用三级处理、A36 双数据种子交集检查
- **不删端点/表/service**（v1 下线 REC 已被 PR#1675→#1676 否决）；`packages/brain`、Cecelia 账本、`apps/dashboard` 业务代码、路① 知识端点与投影表、`tenant-context.ts` / `tenant-bypass.ts` / `staffGuard` 本体

## 假设

- [ASSUMPTION: 路① `knowledgeAuthGuard` 已在 `apps/api` 存在且可复用/泛化；若实际不存在则本刀自建等价会话鉴权闸，判据不变]
- [ASSUMPTION: A30 在本刀只覆盖「删表软删可还原」一支；删行/删字段/引用置空随 Sprint B/D 交付，本刀 smoke 不越界断言]
- [ASSUMPTION: 开箱模板数量取合同下限 ≥2 个]

## 预期受影响文件

- `apps/api/src/`：新增 `workbenchAuthGuard` 中间件、路③ `/api/knowledge/db/*` 端点族（命名空间不得复用 `/api/staff/workbench/*`）、`knowledge/retrieval-exclusions.ts`（A35 五表名清单）
- `apps/api/src/routes/fields.ts` + `fields.service.ts`：J7 段①② 挂鉴权 + 五处 SQL 补租户条件
- `apps/api/migrations/`：路③五表 migration + `field_definitions` 加 `tenant_id` 回填；`app.ts` 新增 1 行路③挂载（`:154` 的 `/api/fields` 挂载保留）
- `apps/staff-hub/`：工作台列表页 / 建表页 / 回收站页 + e2e spec
- `.github/workflows/`：备份 workflow、恢复演练、`e2e-knowledge-hub-path3.yml`、smoke-baseline.txt、`scripts/smoke/structured-workbench-smoke.sh`

## NFR 约束

<!-- 来源: 合同 lifelines_and_nfr（PrepPRD 主源）；decisions 表 category=nfr 查询返回空数组 -->
- 存储形态：JSONB 行存，**不做运行时 DDL**；字段 id 与显示名分离
- 标识：表/行/字段 id 一律 UUID；命名空间固定 `/api/knowledge/db/*`
- 字段类型创建后**不可变**（改类型 = 建新字段 + 手工迁移）
- 依赖版本锁 AG Grid `32.2.1`（不跟随 v33）、看板选型 `dnd-kit`、单表行数上限 thin 期 ≤5000 —— 三项本刀只记账，引入与拦截在 Sprint B/C
- 可用性：3 名非技术员工无文档 20 分钟内独立完成建表，2/3 达标
- 发布：AI 只部署 staging（`deploy-staff-hub-staging`），prod-hk 由主理人放行；G2 备份必须先于任何用户数据进表

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant。step 级 0 条、journey_feature 级不适用（task.ability_id 为 null）、area 级 88 条中 78 条为 [capture-triage] learning 噪声，下列为 [系统] 全量 8 条 + 与本 sprint 直接相关 2 条 -->
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串，让隔离漏洞当场暴露（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [真环境验证才算done] 依赖真机/生产 env/真实调用方的接缝断言必须在真目标上验证过才算 done，未真验只能标 logic-done-pending（来源: area）
- [禁写死环境假设值] 屏幕外坐标/阈值/假设调用方传 X/假设 .env 有 Y 禁止写死，要么从环境推导要么真机校准（来源: area）
- [单slot串行] 一个 slot 内任务串行，动手写代码的实现者同一时刻永远只有一个（来源: area）
- [表名认领] 建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [多设备UI区分] 新字段与既有字段语义重叠时必须本 sprint 内消解或建正式 decision + 挂任务队列，禁止只在文档里写「留给后续技术债 sprint」（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: GET /journeys/da60cb26/golden-paths 返回空数组（本 journey 尚未有 done/working ability 落库）；下列一条取自合同 G0 承接现状，非本 sprint 新做 -->
- 路①知识沉淀（合同 G0 承接现状）: Step1 员工会话经 knowledgeAuthGuard 鉴权 → Step2 身份/组织归属只来自服务端会话 → Step3 知识条目按组织隔离落库（本刀复用该闸，不得改弱）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=windows_cloud 填入真实脚本（.ps1 / Playwright spec + 真 API + 真 DB 双企业种子）
# 期望验收点（自然语言，对应合同 A1–A11 门禁）：
# 1. [A1/A34] 持 B 企业会话 + 伪造 X-Tenant-Id/body.tenant_id 指向 A 企业调路③每个写端点 → 4xx 或空集，A 企业行前后 SELECT diff 为空；把闸改回「有头则读头」该断言必须转红
# 2. [A2] 路③全部路由与中间件源码扫描七个禁用字面量零命中；任意插入其一守卫必须报红
# 3. [A3] 正向对照：A 企业真实会话调路③全部端点逐个返 2xx 且返回自己的数据（防「一律 403」假绿）
# 4. [A4] 五段全绿：①新字段元数据表 org_id NOT NULL 跨企业读改返 4xx/空集 ②不带身份调 /api/fields 四端点均返 401（当前 main 返 2xx，转绿即段①完成）③持 A 身份读改 B 的 field_definitions 返 4xx/空集且 B 行 diff 为空 ④真浏览器下 dashboard /works/fields 与作品详情自定义字段编辑功能不变 ⑤处置结果落 decisions
# 5. [A5] 从 pg_dump 备份还原到临时库，路③五表行数与关键字段逐条比对全等；备份+演练在 workflow schedule 有持久载体
# 6. [A6] 建一张带 8 类字段各一个的表，刷新后字段定义逐字相同，出现在本组织列表、不出现在他组织列表
# 7. [A7] 新组织空工作台显示 ≥2 个开箱模板；一键建表后表结构与模板声明逐字一致
# 8. [A8] 可见性「仅自己」正反双向同一次运行内成对执行：反向=同组织他人列表不含该表且 GET :id 返 404 且响应体与随机不存在 id 逐字节相同；正向=表主本人同时刻列表含该表、GET :id 返 2xx 且内容逐字一致；改成「一律拒绝」正向必须转红
# 9. [A9/A30①] 删表需二次确认输入表名（输错不执行）；删后 deleted_at 非空且物理行仍在；30 天内回收站还原后表元数据+字段定义逐字回归；软删改物理 DELETE 该断言必须转红
# 10. [A10] 建表不产生运行时 DDL：information_schema.tables WHERE table_schema='zenithjoy' 与 migration 声明集合完全相同
# 11. [A11] tenant_members 同一 feishu_user_id 多组织行时启动自检 fail-closed 并输出明确错误码
# 12. [A35①] retrieval-exclusions.ts 存在可解析且五个表名逐个字面量命中；删任一表名或删整个文件守卫必须报红
```

## journey_type: user_facing
## journey_type_reason: 交付物含 apps/staff-hub 的工作台列表页/建表页/回收站页，员工在真浏览器里直接操作，命中 UI 优先级最高档。
## target_environment: windows_cloud
## target_environment_reason: base_repo=zenithjoy，按全局 E2E 环境路由死规则 ZenithJoy 任何 UI/Dashboard 一律走 GitHub Actions windows-latest 干净 runner（本刀新建 e2e-knowledge-hub-path3.yml 承载）。
## journey_id: da60cb26-5635-4f51-a1f3-a80013f6d69d
## step_id: none（PrepPRD 未锚定 step 级坐标）
