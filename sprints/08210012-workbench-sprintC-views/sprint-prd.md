# Sprint PRD — 结构化工作台 S3「视图切得开」（表格视图 ↔ 看板视图 + 拖卡改值 + 视图配置持久化）

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：79%
- **本次推进预期**：+2%（路③ 结构化工作台 4 刀中的第 3 刀）

## 背景

Sprint A（PR#1680）交付三道门 + S1「建得出表」，Sprint B（PR#1685）交付 S2「数据进得来」——行 CRUD + 行内编辑 + `version` 乐观锁 + 粘贴导入 + 行回收站 + **表格视图**。但同一张表**只有表格视图这一种看法**：`db_view_prefs` 表 Sprint A 就建好了却**零读写**，员工筛不了、排不了、切不了看板，每次进来都是同一副默认样子。本刀交付 GP 合同 S3 段承诺：「同一张表按自己的条件筛、按任一列排、一键切表格↔看板（按任一单选字段分组，卡片拖拽换组即改值），下次进来还是你上次那个视图；拖拽没存上会当场看到卡片弹回+错误提示」。

## Golden Path（核心场景）

员工从 [打开一张已有数据的表] → 经过 [按列筛/排 → 一键切**看板视图**并选分组字段 → **拖卡**换列改值 → 隐藏用不上的列] → 到达 [换个会话重进这张表，还是上次那个视图配置，拖过的卡还在新列里]

具体：

1. 员工在**表格视图**里按某个文本字段筛、按某个数字字段排 → 表格当场只剩符合条件的行且按该列有序
2. 点视图切换器切到**看板视图** → 选一个**单选或多选**字段做分组列 → 卡片按该字段值分列展示，该字段无值的行归「未分组」列
3. 选了非单选/多选类型（如数字/日期）做分组 → **400 + 可见报错**，不进看板、不留半截状态
4. **拖**一张**卡**到另一列 → 该行分组字段值改成目标列的值并落库（走 Sprint B 的 `PATCH /rows/:id` + `version` 乐观锁）→ 刷新页面卡片**仍在**新列
5. 拖卡保存失败（500/断网/并发 409）→ 卡片**弹回原列** + 可见错误提示，绝不停在假位置
6. 在工具条隐藏若干列 → 分组/排序/隐藏列这套**视图配置持久化**到 `db_view_prefs`（按 `org_id` + `table_id` + `member_id`，存 `field_id` 非字段名）
7. 换一个会话重新登录进同一张表 → 视图类型/筛/排/分组/隐藏列**逐项与上次一致**；删掉某个视图后表与行数据**一行不少**，且**至少保留一个视图不可删空**

## 边界情况

- **视图偏好保存失败 / 反查不到**：保存失败 → 工具条出现「视图偏好未保存」可见提示（**禁静默吞异常**），本次会话内视图仍可用可重试；反查两分支（合同 J6）——指向**已删字段**的 prefs → 降级为默认视图（非白屏非 5xx），指向**他企业字段 id** 的 prefs → **404** 且响应体与「随机不存在 id」逐字节相同
- **删视图**：至少保留一个视图，删到最后一个时拒绝并给可见提示；删视图只删偏好记录，`db_tables` / `db_fields` / `db_rows` 逐字不变
- **分组/排序列引用**：GROUP BY / ORDER BY 一律走 `field_id` → 内部列名白名单映射；传非白名单 `field_id` 或 `id; DROP TABLE` 之类原始 SQL 片段 → 4xx，用户输入**永不进入标识符位**
- **跨组织**：以他组织身份读/写本表视图偏好 → 4xx 或空集，且本组织 prefs 前后逐字未变；不可达与不存在统一 404、同一文案同一响应形状
- **并发拖同一张卡**：双人拖同卡 → 后者 409 并弹回（复用 S2 乐观锁，不新造机制）

## 范围限定

**在范围内**：
- 视图偏好读写端点（`/api/knowledge/db/*` 命名空间，挂 Sprint A 已有的 `workbenchAuthGuard`）+ `db_view_prefs` 的 CRUD service
- 筛选/排序：AG Grid `filterModel` / `sortModel` → `db_rows.data` 的 JSONB 路径查询 + `field_id` 白名单映射
- 看板视图组件（**全新开发**，dnd-kit）：单选/多选字段分组、未分组列、拖卡换列改值、失败弹回
- 视图切换器（表格 ↔ 看板）+ 隐藏列 + 「指派给我」全局视图（人员字段的归集出口）；视图组件可脱离工作台页面**独立挂载渲染**（为路②「页面内嵌 database」预留边界，免返工）
- 新增路由/服务文件进 A2 静态守卫扫描域；视图变更落 `db_audit`

**不在范围内**（留 Sprint D）：
- **日历视图 / 画廊视图**、**跨表关联**（Relation 字段类型 / 行选择器 / 反向引用面板 / 反枚举统一 404）
- 公式 / rollup / CSV 导出 / 字段类型变更 / 行级权限 / 附件字段 / 多人实时协同 / 对外 API / 服务端行模型 / AG Grid v33 升级；表改名与改可见性、字段的 UPDATE/DELETE 端点（Sprint A/B 均未做，留 S4 删字段时一并处理）

## 假设

- [ASSUMPTION: 派发口径写的 `db_views` 与 GP 合同的 `db_view_prefs` 是同一张表——Sprint A `20260820_120000_structured_workbench.sql:88-99` 已建 `zenithjoy.db_view_prefs`（`table_id/org_id/member_id/prefs JSONB`，`org_id NOT NULL`），本刀**读写该既有表、不另建 `db_views`**，避免同语义双表]
- [ASSUMPTION: 分组字段类型限制取 thin_prd 的**单选或多选**（GP 合同 S3 原文只写「任一单选字段」，本刀按 thin_prd 放宽到含多选；多选值分列口径 = 该行在其每个选中值的列里各出现一次，拖卡只改被拖出/入的那一个值）]
- [ASSUMPTION: 拖卡落库复用 Sprint B 已交付的 `PATCH /rows/:id`（`routes/workbench.ts:285`）+ `version` 乐观锁**不新增行写入路径**，视图偏好走新端点；拖拽库按合同 J3 选 **dnd-kit**（staff-hub 当前无此依赖需新增），表格仍是 Sprint B 移植的 AG Grid 32.2.1 不升 v33]
- [ASSUMPTION: `payload.gp_anchor` 仍为 A 刀的 `#step1`，本刀实际推进 **S3/step3**，建 PR 时锚应为 `#step3`]

## 预期受影响文件

- `apps/api/src/routes/workbench.ts` + `apps/api/src/services/workbench.service.ts`：视图偏好端点族、筛排 JSONB 查询、`field_id` 白名单映射。⚠️ A 刀 `routes/workbench.test.ts` 钉了端点数量断言，B 刀已改过一次，本刀须同步再改
- `apps/staff-hub/src/pages/WorkbenchTablePage.tsx` + 新增看板视图/视图切换器/工具条组件 + `src/lib/workbenchFetch.ts`（视图偏好 fetch）+ `apps/staff-hub/package.json`（新增 `@dnd-kit/*`）
- `.github/workflows/scripts/smoke/structured-workbench-smoke.sh`（S3 段断言）+ `apps/staff-hub/e2e/structured-workbench-views.spec.ts` + `.github/workflows/e2e-knowledge-hub-path3.yml`（S3 真浏览器链路）

## NFR 约束

<!-- 来源: decisions category=nfr 查得 0 条（step 级 0 条；journey_feature 级因 task.ability_id 为 null 无法查）；以下取 GP 合同（已批准，本路 SSOT）显式值 -->
- 并发冲突复用行级 `version` 乐观锁，不匹配返 **409**（合同 J2，⚠️ 接缝级）；拖卡失败必须弹回 + 可见提示
- 分组字段类型非法（非单选/多选）返 **400** 且报错可见；跨组织不可达统一 **404**，同一文案与响应形状（合同 J5/J6）
- 端点命名空间 `/api/knowledge/db/*` 挂 `workbenchAuthGuard` 同族闸（合同 J11）；单表行数上限 **5000**（合同 J12，看板 client-side 分组在此量级内性能可接受）
- 版本锁：拖拽库 **dnd-kit**（合同 J3）、表格 AG Grid 钉死 **32.2.1**（不跟 v33，主题 API 断代）；可观测：视图偏好保存/删除须落 `db_audit`（`org_id NOT NULL`），保存失败禁静默吞

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 三源加载数：step 级 0 条、journey_feature 级 0 条（task.ability_id 为 null）、area 级 88 条 -->
<!-- area 88 条中多数为 [capture-triage] harness 流程 learning、非产品铁律，按膨胀控制取与本 sprint 有关的 2 条；产品铁律主源取 GP 合同 §6/§7（已批准，本路 SSOT），并承接 Sprint A/B 已确立条目 -->
- [组织归属] 一律取 `req.workbenchIdentity.orgId`，绝不从 body/header 取；`db_view_prefs.org_id NOT NULL`（来源: GP 合同 J10 / area）
- [禁明文身份头] 路③ 源码对 `X-Tenant-Id` / `X-User-Email` / `X-Feishu-User-Id` / `X-Bypass-Tenant` / `tenantContextOptional` / `selfHealOwnerMember` / `staffGuard` 七个字面量零命中，新增路由文件必须进 A2 扫描域（来源: GP 合同 A2）
- [正向对照] 隔离断言必须成对：反向拒绝之外，同一次运行内必须有本组织正向 2xx 且拿到自己的数据，防「一律 403/404」假绿（来源: GP 合同 A3/A8）
- [禁静默覆盖] 并发同格/同卡必须 409 + 可见提示；禁 last-write-wins（来源: GP 合同 J2）
- [禁静默吞失败] 写回与视图偏好保存失败必须可见；禁全量重拉掩盖、禁乐观回滚静默（来源: GP 合同 A14/A23，`CustomerListPage` 与 ViewPrefs 两处静默吞异常**不得继承**）
- [软删可还原] 删行/删表为软删，物理行仍在，30 天内可逐字还原（来源: GP 合同 A9/A16）
- [无运行时 DDL] 用户建表/建列/建视图不产生物理表；`information_schema` 表清单与 migration 声明集合恒等（来源: GP 合同 J1/A10）
- [用户输入不进标识符位] 用户字段名/值一律作为数据值走绑定参数；GROUP BY/ORDER BY 走 `field_id`→内部列名白名单（来源: GP 合同 J1/A25）
- [ViewPrefs 存 field_id] 视图偏好一律存 `field_id` 而非字段名，改字段显示名后视图不失效（来源: GP 合同 A21）
- [变异证明] ⚠️ 断言必须 proven-to-fire：去掉 `field_id` 白名单映射 A25 转红、注掉 version 检查冲突断言转红（来源: GP 合同 §6）
- [禁写死环境假设值] 阈值/坐标/假设调用方传值禁止写死，要么从环境推导要么真验（来源: area 级 `[系统]禁止写死环境假设值`）
- [多端完整性] 涉及多种设备/OS 类型时展示层须区分，字段有但下游 UI 未接线判 FAIL（来源: area 级多设备 UI 区分决策）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: GET /journeys/da60cb26/golden-paths 返回 0 条（journey 未挂 ability golden_path），按 Sprint A（PR#1680 @ 42889f83）/ Sprint B（PR#1685 @ 06c75dfa）实际合并产物手工补齐 -->
- Sprint A · G0 组织闸: Step1 `workbenchAuthGuard` 从 better-auth 会话取 memberId → Step2 查 `tenant_members` 得 orgId（多组织 409 不取第一条）→ Step3 挂 `routes/workbench.ts` router 顶层覆盖全部端点 → Step4 A2 静态守卫扫七个明文头字面量零命中
- Sprint A · G1 旧洞修复: Step1 `routes/fields.ts` 四端点挂 `tenantContext` → Step2 `field_definitions` 加 `tenant_id` + 回填 → Step3 两 smoke 脚本改带身份头 → Step4 dashboard `/works/fields` 真浏览器回归不变
- Sprint A · G2 备份底线: Step1 `db-backup.yml` 定时 pg_dump → Step2 `restore-drill.sh` 还原到临时库逐条比对五表
- Sprint A · S1 建得出表: Step1 工作台列表页 + ≥2 个开箱模板一键建表 → Step2 建表 UI 定义 8 类字段 → Step3 表元数据落 `db_tables`/`db_fields`（`org_id NOT NULL`）→ Step4 表级可见性「仅自己」为真访问控制 → Step5 删表二次确认输入表名 + 软删 + 30 天回收站还原 → Step6 建表不产生运行时 DDL
- Sprint B · S2 数据进得来: Step1 表格视图按序展示未删行 + 新增行落库 → Step2 行内编辑失焦即存、8 类字段各有编辑器、刷新逐字不变 → Step3 并发同格 `PATCH /rows/:id` 带基线 version 不匹配返 409 + 可见冲突提示 → Step4 写回失败单元格可见错误态且保留用户输入 → Step5 剪贴板粘贴批量导入、未匹配列自动建「文本」、超 5000 整批拒绝 → Step6 行详情面板 → Step7 软删行 + 30 天回收站还原 + 单表 JSON 全量导出不含他组织数据
- Sprint A/B · 已建未用: `db_view_prefs` 三键（`org_id`/`table_id`/`member_id`）+ `prefs JSONB` 已在 migration 建好但**零读写**，本刀首次接线；`db_audit` 已承接建表/删表/行写入审计

## E2E 验收

> Planner 初稿留占位。最终脚本由 proposer 在 GAN 阶段按 `target_environment=windows_cloud` 产出（PowerShell + Playwright 真浏览器，接进已有的 `.github/workflows/e2e-knowledge-hub-path3.yml` 的 `windows-real-browser` job，该 job 无 job 级事件条件门，勿改其触发形态）。

```bash
# 占位：proposer 按 windows_cloud 填入 e2e-verify.ps1 + Playwright spec
# 期望验收点（自然语言，对应 GP 合同 A20–A26 七条门禁断言）：
#   A20 四件套：按文本字段筛 / 按数字字段排 / 按单选字段分组 / 切表格↔看板，四项结果与预期集合完全一致
#   A21 视图偏好持久：设好筛+排+视图类型 → 换会话重进 → 逐项一致；库中存的是 field_id 而非字段名（改显示名后视图不失效）
#   A22 反查两分支：指向已删字段的 prefs → 降级默认视图（非白屏非 5xx）；指向他企业字段 id → 404 且与随机不存在 id 逐字节相同
#   A23 注入 ViewPrefs 保存失败 → UI 出现可见提示，禁静默吞异常
#   A24 看板拖卡换列 → 库中该行分组字段值改变；注入保存失败 → 卡片弹回原列 + 错误提示；双人拖同卡 → 后者 409 并弹回
#   A25 GROUP BY/ORDER BY 白名单：传非白名单 field_id、传 `id; DROP TABLE` 原始片段 → 4xx，用户输入从不进标识符位；变异证明：去掉白名单映射必须转红
#   A26 视图组件可在工作台页面之外独立挂载并正常渲染一张表
#   另：分组列选非单选/多选 → 400 可见报错；删视图后表与行数据一行不少、删到最后一个被拒（至少保留一个不可删空）；A1/A3 范式在「视图偏好」层复跑（跨组织读写拒绝 + 本组织正向 2xx 成对，防一律拒绝的假绿）
```

## journey_type: user_facing
## journey_type_reason: 交付物是 staff-hub 的看板视图/视图切换器/拖拽交互，员工在真浏览器里直接操作
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 任何 UI 一律走 GitHub Actions windows-latest 干净 VM（全局 E2E 环境路由死规则），且拖卡与视图切换必须真浏览器验证
## journey_id: da60cb26-5635-4f51-a1f3-a80013f6d69d
## step_id: line11/structured_workbench#step3
