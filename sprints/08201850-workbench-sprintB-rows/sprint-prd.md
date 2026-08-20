# Sprint PRD — 结构化工作台 S2「数据进得来」（录数据：行 CRUD + 行内编辑 + 乐观锁）

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：+2%（路③ 结构化工作台 4 刀中的第 2 刀）

## 背景

Sprint A（PR#1680）已交付 G0/G1/G2 三道门 + S1「建得出表」，**但表里一行数据都录不进去**——`db_rows` 只建了表、无任何写入路径，且该表**缺 `version` 列**。本刀交付 GP 合同 S2 段承诺：「在表格视图增/改/删行、行内编辑即存；别人同时改了同一格你会**看到冲突提示而不是静默覆盖**；能从剪贴板粘贴一片表格批量导入；每行点开有详情面板；删错的行 30 天内找得回；整表数据随时能 JSON 导出拿走」。

## Golden Path（核心场景）

员工从 [工作台点开一张自己组织的表] → 经过 [表格视图建行 → 行内改格即存 → 粘贴批量导入 → 展开行详情 → 删行进回收站] → 到达 [刷新后数据逐字还在，整表可 JSON 导出拿走]

具体：

1. 员工在工作台列表点表名 → 进入**表格视图**，按序展示该表全部未删行（空表显示零行 + 「新增行」入口）
2. 点「新增行」→ 表格出现一行空白行并落库，刷新后仍在
3. 双击任一单元格改值 → **失焦即存**（8 类字段各有对应编辑器：文本/长文本/数字/日期/单选/多选/人员/URL）→ 刷新页面值逐字不变
4. 同事同时改了同一行 → 你提交时**看到「该行被改过，你的改动未保存」的可见提示**（单元格错误态），你打的内容仍在编辑器里、库里是对方先提交的值；刷新看到对方的值后可重新提交
5. 从表格软件复制一片区域 → 在表格里粘贴 → 按行落库，表里没有的列**自动建为「文本」类型字段**
6. 点行首展开**行详情面板** → 看到该行字段全集（长文本为多行编辑区），改动同样即存
7. 删一行 → 该行离开表格进回收站、30 天内可还原且全字段逐字回归；点「导出 JSON」→ 拿到该表全量行 JSON，内容与库中一致、不含任何他组织数据

## 边界情况

- **写回失败（500/断网）**：单元格进入可见错误态，**原输入仍留在编辑器内**，就地重试不用重打；禁乐观回滚静默、禁全量重拉掩盖失败（Sprint A 前端与 dashboard `CustomerListPage` 的「保存后全量 reload」范式**不得继承**）
- **粘贴超上限**：粘贴使总行数超 **5000** → 整批拒绝、库中零新增、提示含当前上限与已有行数；UI 侧「新增行」达上限时硬拦
- **跨组织**：以他组织身份读/改本表任一行 → 4xx 或空集，且本表对应行前后逐字未变；不可达与不存在**统一 404、同一文案、同一响应形状**
- **恶意输入**：字段名与单元格值注入 `<img src=x onerror=alert(1)>` → 渲染后该处 DOM 无 `img` 元素、文本节点等于原字符串；`__proto__` / `constructor` / `"; DROP TABLE db_rows; --` / 超长 emoji 串一律作为**数据值**落库，`information_schema` 表清单未变、服务无 5xx
- **空/失效**：表被软删后其行不可读写；行详情面板打开时该行被他人删除 → 可见提示而非白屏

## 范围限定

**在范围内**：
- `db_rows` 补 `version`（乐观锁基线，Sprint A migration 漏了此列）与 `created_by` 列的增量 migration
- 行 CRUD API：建行 / `PATCH /rows/:id`（通用路由，全部字段走稳定 `field_id`，无 colId 特例）/ 软删行 / 行回收站与还原 / 批量粘贴导入 / 单表 JSON 全量导出
- 乐观锁：提交带基线 `version`，不匹配返 **409** + 可见冲突提示
- staff-hub 表格视图 + 行内编辑即存 + 8 类字段编辑器/渲染器 + 行详情面板 + 5000 行 UI 硬拦
- 全部新增端点挂 Sprint A 已有的 `workbenchAuthGuard`，行数据带 `org_id`；新增路由文件进 A2 静态守卫扫描域

**不在范围内**（后续刀）：
- S3 全部（筛选/排序/看板/视图切换器/ViewPrefs/「指派给我」）与 S4 全部（Relation/行选择器/反向引用面板/反枚举）
- 公式 / rollup / 日历视图 / 画廊视图 / **CSV 导出**（JSON 导出即本刀数据主权兜底）/ CSV 文件导入（最小档=剪贴板粘贴）/ 字段类型变更 / 行级权限 / 附件字段 / 多人实时协同 / 对外 API / 服务端行模型 / AG Grid v33 升级
- 表改名与改可见性、字段的 UPDATE/DELETE 端点（Sprint A 未做，本刀不补，留 S4 删字段时一并处理）

## 假设

- [ASSUMPTION: `db_rows.version` 与 `created_by` 由本刀增量 migration 补，不回改已合并的 `20260820_120000_structured_workbench.sql`（A 刀 smoke 对其形状有断言）]
- [ASSUMPTION: 表格按合同 J8 移植 `apps/dashboard` 已锁的 AG Grid **32.2.1**（staff-hub 当前无此依赖，需新增依赖 + 新写 light 主题 + className 全重写；两 app 同为 React 18.2 + Vite 7.3.2，无版本冲突）]
- [ASSUMPTION: 组织归属一律取 `req.workbenchIdentity.orgId`（A 刀 `middleware/workbench-auth.ts:78-104` 从 `tenant_members` 查得）绝不从 body/header 取；粘贴自动建列一律「文本」（合同 J9）不做类型推断；payload 的 `gp_anchor` 仍为 A 刀的 `#step1`，本刀实际推进 **S2/step2**，建 PR 时锚应为 `#step2`]

## 预期受影响文件

- `apps/api/db/migrations/<新时间戳>_workbench_rows_version.sql`：`db_rows` 补 `version INTEGER NOT NULL DEFAULT 1` 与 `created_by`
- `apps/api/src/routes/workbench.ts` + `apps/api/src/services/workbench.service.ts`：行端点族与其服务实现（乐观锁/粘贴导入/导出/行回收站）。⚠️ A 刀 `routes/workbench.test.ts` 钉了「端点恰好 9 个」，须同步改
- `apps/staff-hub/src/pages/WorkbenchPage.tsx` + 新增表格视图页/组件 + `src/lib/workbenchFetch.ts`（行 fetch 函数）+ `apps/staff-hub/package.json`（新增 ag-grid 32.2.1）
- `.github/workflows/scripts/smoke/structured-workbench-smoke.sh`（S2 段断言，A2 扫描域自动含新增路由文件）+ `apps/staff-hub/e2e/structured-workbench.spec.ts` + `.github/workflows/e2e-knowledge-hub-path3.yml`（S2 真浏览器链路）

## NFR 约束

<!-- 来源: decisions category=nfr 查得 0 条（step 级 0；journey_feature 级因 task.ability_id 为 null 无法查）；以下取 GP 合同（已批准）显式值 -->
- 单表行数上限 **5000**（thin 期，UI 硬拦建行 + API 整批拒绝，合同 J12）；并发冲突走行级 `version` 乐观锁，不匹配返 **409**（合同 J2，⚠️ 接缝级）
- 跨组织不可达统一 **404**，同一文案与响应形状（合同 J5）；端点命名空间 `/api/knowledge/db/*` 挂 `workbenchAuthGuard` 同族闸（合同 J11）
- 可观测：行写入/删除/还原须落 `db_audit`（`org_id NOT NULL`，照 A 刀 `createTable` 审计范式）
- 版本锁：AG Grid 钉死 **32.2.1**（不跟 v33，主题 API 断代）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 三源加载数：step 级 0 条、journey_feature 级 0 条（task.ability_id 为 null）、area 级 88 条 -->
<!-- area 88 条中 57 条为 [capture-triage] harness 流程 learning、非产品铁律，按膨胀控制取与本 sprint 有关的 2 条；产品铁律主源取 GP 合同 §6/§7（已批准，本路 SSOT） -->
- [组织归属] 一律取 `req.workbenchIdentity.orgId`，绝不从 body/header 取；行数据 `org_id NOT NULL`（来源: GP 合同 J10 / area）
- [禁明文身份头] 路③ 源码对 `X-Tenant-Id` / `X-User-Email` / `X-Feishu-User-Id` / `X-Bypass-Tenant` / `tenantContextOptional` / `selfHealOwnerMember` / `staffGuard` 七个字面量零命中，新增路由文件必须进 A2 扫描域（来源: GP 合同 A2）
- [正向对照] 隔离断言必须成对：反向拒绝之外，同一次运行内必须有本组织正向 2xx 且拿到自己的数据，防「一律 403/404」假绿（来源: GP 合同 A3/A8）
- [禁静默覆盖] 并发同格必须 409 + 可见提示；禁 last-write-wins（来源: GP 合同 J2）
- [禁静默吞失败] 写回失败必须单元格可见且**保留用户输入**；禁全量重拉掩盖、禁乐观回滚静默（来源: GP 合同 S2 承诺原文）
- [软删可还原] 删行为软删，物理行仍在，30 天内可逐字还原（来源: GP 合同 A16）
- [无运行时 DDL] 用户建表/建列不产生物理表；`information_schema` 表清单与 migration 声明集合恒等（来源: GP 合同 J1/A10）
- [用户输入不进标识符位] 用户字段名/值一律作为数据值走绑定参数（仓库无 ORM，手写 SQL 标识符位绑不了参数）（来源: GP 合同 J1）
- [变异证明] ⚠️ 断言必须 proven-to-fire：注掉 version 检查 A13 转红、软删改物理删 A16 转红（来源: GP 合同 §6）
- [禁写死环境假设值] 阈值/坐标/假设调用方传值禁止写死，要么从环境推导要么真验（来源: area 级 `[系统]禁止写死环境假设值`）
- [多端完整性] 涉及多种设备/OS 类型时展示层须区分，字段有但下游 UI 未接线判 FAIL（来源: area 级多设备 UI 区分决策）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: GET /journeys/da60cb26/golden-paths 返回 0 条（journey 未挂 ability golden_path），按 Sprint A 实际合并产物（PR#1680 @ 42889f83）手工补齐 -->
- Sprint A · G0 组织闸: Step1 `workbenchAuthGuard` 从 better-auth 会话取 memberId → Step2 查 `tenant_members` 得 orgId（多组织 409 不取第一条）→ Step3 挂 `routes/workbench.ts:37` router 顶层覆盖全部端点 → Step4 A2 静态守卫扫七个明文头字面量零命中
- Sprint A · G1 旧洞修复: Step1 `routes/fields.ts` 四端点挂 `tenantContext` → Step2 `field_definitions` 加 `tenant_id` + 回填 → Step3 两 smoke 脚本改带身份头 → Step4 dashboard `/works/fields` 真浏览器回归不变
- Sprint A · G2 备份底线: Step1 `db-backup.yml` 定时 pg_dump → Step2 `restore-drill.sh` 还原到临时库逐条比对五表
- Sprint A · S1 建得出表: Step1 工作台列表页 + ≥2 个开箱模板一键建表 → Step2 建表 UI 定义 8 类字段 → Step3 表元数据落 `db_tables`/`db_fields`（`org_id NOT NULL`，schema `zenithjoy.`）→ Step4 表级可见性「仅自己」为真访问控制 → Step5 删表二次确认输入表名 + 软删 + 30 天回收站还原 → Step6 建表不产生运行时 DDL
- Sprint A · 已建未用: `db_rows` / `db_view_prefs` / `db_audit` 三表已在 migration 中建好（`db_rows` **无 version 列**，本刀须补）；`retrieval-exclusions.ts` 已列五张表名

## E2E 验收

> Planner 初稿留占位。最终脚本由 proposer 在 GAN 阶段按 `target_environment=windows_cloud` 产出（PowerShell + Playwright 真浏览器，接进已有的 `.github/workflows/e2e-knowledge-hub-path3.yml` 的 `windows-real-browser` job，该 job 无 job 级事件条件门，勿改其触发形态）。

```bash
# 占位：proposer 按 windows_cloud 填入 e2e-verify.ps1 + Playwright spec
# 期望验收点（自然语言，对应 GP 合同 A12–A19 八条门禁断言）：
#   A12 行内编辑 8 类字段各一次 → 失焦即存 → 刷新逐字不变（真浏览器 + 真 DB 回读）
#   A13 双会话取同一 version 各 PATCH 同一格 → 第二个 409、库中值=第一个提交的值、UI 出现冲突提示；变异证明：注掉 version 检查必须转红
#   A14 注入写回 500 → 单元格可见错误态且 DOM 取值等于用户所打内容（禁静默回滚/全量重拉）
#   A15 粘贴 N 行 M 列 → 落库恰 N 行；未匹配列自动建「文本」字段；超 5000 整批拒绝且库中零新增
#   A16 删行进回收站，30 天内还原后全字段逐字回归、物理行仍在；变异证明：改物理 DELETE 必须转红
#   A17 单表 JSON 全量导出：行数/字段集与库一致，grep 不到他组织数据
#   A18 XSS 窄面：字段名与单元格值注入 <img src=x onerror=alert(1)> → DOM 无 img 元素、文本等于原串；A19 对抗输入（__proto__ / constructor / "; DROP TABLE db_rows; -- / 超长 emoji）全作为数据值落库，information_schema 未变、无 5xx
#   另：A1/A3 范式在「行」这一层复跑（跨组织行读写拒绝 + 本组织正向 2xx 成对，防一律拒绝的假绿）
```

## journey_type: user_facing
## journey_type_reason: 交付物含 apps/staff-hub 表格视图页与行内编辑交互，员工在真浏览器里直接操作。
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 任何 UI 走 GitHub Actions windows-latest 干净 sandbox（全局 E2E 路由死规则），且 GP 合同 A32/A33 已钉死 `.github/workflows/e2e-knowledge-hub-path3.yml` 的 windows-real-browser job。
## journey_id: da60cb26-5635-4f51-a1f3-a80013f6d69d
## step_id: line11/structured_workbench#step2（GP 合同 S2「数据进得来」）
