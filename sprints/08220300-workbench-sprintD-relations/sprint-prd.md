# Sprint PRD — 路③ 结构化工作台 Sprint D · S4 关联连得上（跨表 Relation）

## OKR 对齐

- **对应 KR**：line11 员工知识中枢 / 路③ 结构化工作台（GP `c86e37ff-3307-4b1a-80d9-3b00b8450554`）
- **当前进度**：S1/S2/S3 已交付（Sprint A/B/C 已合并入 base）
- **本次推进预期**：闭合 S4 = golden path 最后一步「关联连得上」，路③四步走完

## 背景

员工的同构工作项散在多张表里（客户表、跟进表、订单表），需要像 Notion Relation 一样把一张表的记录挂到另一张表上。base 已交付建表(S1)/录数据(S2)/切视图(S3)。本刀做基础 Relation：字段类型 + 单向配置 + 双向展示，不做 rollup/lookup 聚合（留后刀）。数据落 zenithjoy 库，按组织隔离。

## Golden Path（核心场景）

员工从 [表A 配置 relation 字段] → 经过 [挑目标表记录建关联 → 双向可见] → 到达 [点关联项跳目标记录]

具体：
1. 员工在表A新增一个 **relation 类型字段**，配置目标表 = 表B（选择器只列出**本组织**的表）
2. 在表A某一行点该 relation 单元格 → 弹出行选择器，列出表B**本组织**记录 → 勾选若干条 → 保存（目标 row_id 数组存进 `db_rows.data` JSONB，不新建表）
3. 单元格显示被关联记录的标题；**点关联项 → 跳转到表B对应记录**
4. 打开表B被引用的那条记录详情 → **反向引用面板列出「谁引用了我」**（表名 + 行标题）；「仅自己」表的反向面板仅表主可见
5. 删除表B被关联的记录 → 表A引用**安全失效**（置空 + 单元格可见标记），不留悬空引用、不跳 404 白屏

## 边界情况

- **跨组织隔离**：只能关联本组织的表与记录；A 企业用 B 企业**真实存在**的 table_id/row_id 与**随机不存在**的 id 各调多次，响应状态码/响应体/文案/字段形状**逐字节相同**（反枚举，不泄露存在性）
- **读路径二次校验**：把目标行 org 直接在库里改成他企业后展开 relation → 命中校验渲染占位，**不泄露对方数据**
- **「仅自己」表零泄露**：他人不得建关联到别人私有表；导出含指向私有表 relation 的表时，导出文件 **grep 不到对方行标题**（只有 id 占位）
- **删目标表**：目标表进回收站 → 从回收站还原后引用自动恢复
- 空关联单元格 / 目标记录已全删 → 显示占位，非白屏
- 复用 `workbenchAuthGuard` 会话鉴权，**禁 header/body 兜底身份**

## 范围限定

**在范围内**：relation 字段类型 + 目标表配置 + 行选择器 UI + 反向引用面板 + 点击跳转 + 组织隔离三向（写入校验目标表 org / 读路径二次校验 / 统一 404）+ 删行·删表·删字段三级引用处理 + 「仅自己」表在关联处零泄露 + 路③ relation E2E spec 接入既有 `e2e-knowledge-hub-path3.yml`

**不在范围内**：rollup / lookup / 公式聚合（后刀加厚）；relation 值优先存 `db_rows.data` JSONB，不新建关联表（如目标表字段配置元数据必须落库，走 `db_fields` 既有列/JSONB 或最小 migration）

## 假设

- [ASSUMPTION: base = origin/main 已含 Sprint A/B/C（`db_tables/db_fields/db_rows/db_view_prefs/db_audit` 五表、`workbench.ts` 路由族、`workbench-auth.ts`、`retrieval-exclusions.ts`、`e2e-knowledge-hub-path3.yml`），本刀在其上叠加，不重造]
- [ASSUMPTION: 路级 A33 workflow / A35 排除清单 base 已落地，本刀只需把 relation 的物理表写入 `db_rows.data`（不新增物理表 → 无需改 A35 清单），并把 relation spec 接进 path3 workflow 的 `paths` 与 windows job]

## 预期受影响文件

- `apps/api/src/routes/workbench.ts`：新增 relation 字段类型的行选择器数据端点 + 反向引用（谁引用了我）查询端点
- `apps/api/src/services/*`：relation 值读写（`db_rows.data` 目标 row_id 数组）+ 读路径二次校验目标行 org + 删行/删表引用安全失效处理
- `apps/staff-hub/src/pages/WorkbenchTablePage.tsx` 等：relation 字段编辑器 + 行选择器 + 反向引用面板 + 单元格渲染与跳转
- `apps/staff-hub/e2e/structured-workbench-relations.spec.ts`：**新增** relation 真浏览器 E2E spec
- `.github/workflows/e2e-knowledge-hub-path3.yml`：把 relation spec 加进 `paths` 与 windows job 步骤

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: GP §2 已确立 INV（G0/G1/G2）+ area/journey_feature 隔离铁律，三源合并 -->
- [会话取org] org_id 只从 better-auth 会话解析、零请求头；relation 读写的目标 org 判定同源。禁 `X-Tenant-Id`/`body.tenant_id`/`tenantContextOptional`/`X-Bypass-Tenant`/`staffGuard` 明文头兜底（来源: area/G0）
- [org_id_NOT_NULL] 五张表 `org_id NOT NULL`；跨企业不可见不可关联，写入校验目标表 org + 读路径二次校验目标行 org（来源: area/G0）
- [无运行时DDL] schema 只走 migration，无运行时 DDL；relation 值优先存 `db_rows.data` JSONB，不建新关联表（来源: 合同 §10）
- [反枚举统一404] 跨企业访问统一 404，同文案同响应形状，耗时不构成可区分信号（来源: journey_feature）
- [软删可还原] 删表/删字段/删行全部软删可还原，关联引用安全失效不留悬空指针（来源: journey_feature）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: GP §8 Sprint A/B/C 已交付 golden path（API 累积 FR 投影为空，据合同重建） -->
- S1 建得出表(Sprint A): 建本组织表 → 8 类字段元数据 → 工作台列表 → 空状态模板 → 表级可见性(仅自己/组织) → 软删+30天回收站 → 审计行
- S2 数据进得来(Sprint B): AG Grid 表格视图 → 行 CRUD(`PATCH /rows/:id` 走 field_id) → 乐观锁 409 → 剪贴板粘贴导入 → 行详情面板 → 软删行+回收站 → JSON 全量导出 → ≤5000 行上限
- S3 视图切得开(Sprint C): 筛选/排序(filterModel/sortModel → JSONB + field_id 白名单) → 看板拖卡换列 → 视图切换器 → ViewPrefs 读写 → 「指派给我」全局视图 → 视图组件独立渲染

## NFR 约束

<!-- 来源: decisions category=nfr 为空；PrepPRD 未显式指定超时/频控 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: N/A
- 版本要求: AG Grid 锁 32.2.1（不升 v33）
- 可观测: relation 保存/展开失败必须单元格可见提示，**禁静默吞异常**

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 按 `windows_cloud` 填 Playwright（GitHub Actions windows-latest），接进 `e2e-knowledge-hub-path3.yml` 的 windows-real-browser job。

```bash
# 占位：proposer 将填 windows_cloud Playwright 脚本
# 期望验收点（自然语言）：真浏览器双企业种子下——建 relation 字段配目标表 → 挑本组织记录建关联 →
#   单元格显示目标标题、点击跳转成功 → 目标记录详情反向面板列出引用来源 →
#   删目标行后引用置空+可见标记（不悬空）→ 跨企业 table_id/随机 id 响应逐字节相同（反枚举）→
#   导出含私有表 relation 时 grep 不到对方行标题。windows job conclusion == success 才算过。
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/staff-hub 浏览器 UI（relation 字段编辑器/行选择器/反向面板/跳转），须真浏览器验收
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy UI 死规则走 GitHub Actions windows-latest 干净 VM，接进既有 e2e-knowledge-hub-path3.yml
## journey_id: da60cb26-5635-4f51-a1f3-a80013f6d69d
## step_id: line11/structured_workbench#step4（S4 关联连得上）
