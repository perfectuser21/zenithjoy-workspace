# Sprint PRD — 路③ 结构化工作台 Sprint E · S4 加厚 rollup/lookup 聚合

## OKR 对齐

- **对应 KR**：line11 员工知识中枢 / 路③ 结构化工作台（GP `c86e37ff-3307-4b1a-80d9-3b00b8450554`）
- **当前进度**：S1/S2/S3/S4 骨干已交付（Sprint A/B/C/D 已合并入 base）
- **本次推进预期**：在 S4「关联连得上」之上加厚 rollup/lookup 聚合（不新增 S5，rollup 是 relation 的直接延伸）

## 背景

S4 relation 已上线，员工能把一张表的记录挂到另一张表。但关联的子记录还只能一条条看，看不到汇总。本刀在「连关联」之上补一层：员工给 relation 字段配一个 rollup 汇总字段，单元格直接看到聚合值（count/sum/min/max/concat）或 lookup 取关联行某字段展示。采**读时计算不落库**，零新建表。承接已 APPROVED 提案 v5（A37-A41、J13-J15、墙裁定），本刀只实现，不改设计。

## Golden Path（核心场景）

员工从 [给某 relation 字段配 rollup 汇总字段] → 经过 [选目标字段+聚合函数 → 读时计算] → 到达 [单元格看到聚合值]

具体：
1. 员工在已有 relation 字段的表里新增一个 **rollup 字段**：选「本表哪个 relation 字段 + 目标表哪个字段 + 聚合函数」，函数支持 **count / sum / min / max / concat**；另有 **lookup** 字段类型直接取关联行某字段展示（无关联表时选择器空态、不可建）
2. 建字段时做**类型×函数校验**：sum/min/max 只允数值字段，非法组合（如 sum 配文本）**400 拒绝** + 明确文案，非静默返错值/NaN
3. 打开表格 → rollup 单元格顺 relation 的目标 row_ids 去目标表捞值**聚合**并**只读**展示；**读时计算不落库**——子记录一改，下次打开汇总值自动最新
4. **组织隔离**：聚合基数只含本 org 存活目标行，库里越权脏行不进聚合、零泄露；lookup/concat 多值按 row_order 升序逗号拼接不截断
5. relation 字段被删 / 目标字段被删 / 目标表被软删 → rollup 单元格**失效降级**（值置 null + degraded 标记 + 可见占位），不悬空、不 500、不白屏
6. **墙裁定**：rollup 聚出的富数据算「database 表内容」，同口径挡在路① 问答检索域外——读时计算不落库天然不入检索表，读服务钉死 `workbench-rollup.service.ts` 不被 knowledge 检索特征文件 import

## 边界情况

- **数值规整**：JSONB 数值可能以 string 存（粘贴导入一律文本），sum/min/max 聚合前先 `Number()` 规整，非数值目标行跳过 + degraded，**绝不字符串拼接冒充 sum**；种子须含一行 string 型数字（如 `"12"`）验证被正确计入 sum
- **多值展示**：一个 relation 指向多行时 concat/lookup 按 row_order 升序、`, ` 分隔拼接不截断；非文本先格式化（date=`YYYY-MM-DD` / number=`String()` / person=显示名 / select=选项标签）
- **「仅自己」私有表目标行**：聚合只计本会话可见 + 本 org 行，不泄露对方行值（A31 延伸到聚合基数）
- **断网弱网**：rollup 只读不写，读失败走单元格可见失败提示，无待重试输入
- 复用 `workbenchAuthGuard` 会话鉴权，rollup 端点同挂 G0 机械闸，**禁 header/body 兜底身份**

## 范围限定

**在范围内**：rollup 字段类型（配置三元组存 `db_fields.options`）+ lookup 字段类型 + count/sum/min/max/concat/lookup 六函数 + 类型×函数校验 + 读时聚合服务（钉死 `workbench-rollup.service.ts`）+ 组织隔离（聚合基数 org 二次校验）+ 失效降级三支（删 relation 字段/删目标字段/软删目标表）+ 数值规整 + 多值格式化 + rollup 只读单元格渲染 + rollup 字段配置器 UI + 墙裁定守卫（A41 固定 grep 靶）+ rollup E2E spec 接进既有 `e2e-knowledge-hub-path3.yml`

**不在范围内**：公式字段 formula（跨字段算式，后刀加厚，提案 P2-13）；rollup 落库缓存方案（J13 已否决 REC=读时计算）；新增 S5 或新建任何物理表（rollup 聚合值不物化，配置存 `db_fields.options`）

## 假设

- [ASSUMPTION: base = origin/main @ 468dc573c 已含 Sprint A/B/C/D（五表 + `workbench.ts` 路由族 + `workbench-auth.ts` + `workbench-relations.service.ts` relationCandidates/backrefs 解析链 + `workbench-views.service.ts` 读时降级范式 A22 + `retrieval-exclusions.ts` + `e2e-knowledge-hub-path3.yml`），本刀在其上叠加]
- [ASSUMPTION: rollup 采读时计算不物化 → 无新增物理表 → 无需改 A35 排除清单；仅把 rollup 读服务名纳入 A41 前向兼容锚守卫，rollup spec 接进 path3 workflow paths 与 windows job]

## 预期受影响文件

- `apps/api/src/services/workbench-rollup.service.ts`：**新增**（A41 钉死路径），读时聚合纯读服务，六函数 + 数值规整 + 失效降级，不并入他文件
- `apps/api/src/services/workbench.service.ts`：FIELD_TYPES 加 rollup/lookup + 建字段时类型×函数校验
- `apps/api/src/services/workbench-rows.service.ts`：读行时挂聚合（顺 relation 目标行聚合）
- `apps/api/db/migrations/2026XXXX_workbench_rollup.sql`：CHECK 白名单幂等扩容（+rollup +lookup）
- `apps/staff-hub/src/components/WorkbenchRowGrid.tsx` 等：rollup 只读单元格渲染 + rollup 字段配置器 UI
- `apps/staff-hub/e2e/structured-workbench-rollup.spec.ts`：**新增** rollup 真浏览器 E2E spec
- `.github/workflows/e2e-knowledge-hub-path3.yml`：把 rollup spec 加进 `paths` 与 windows job

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: GP §2 已确立 INV（G0/G1/G2）+ area/journey_feature 隔离铁律，随 Sprint D 同 line 复用 -->
- [会话取org] org_id 只从 better-auth 会话解析、零请求头；rollup 聚合基数的 org 判定同源。禁 `X-Tenant-Id`/`body.tenant_id`/`tenantContextOptional`/`X-Bypass-Tenant`/`staffGuard` 明文头兜底（来源: area/G0）
- [org_id_NOT_NULL] 五张表 `org_id NOT NULL`；聚合基数只含本 org 存活目标行，库里越权脏行不进聚合（来源: area/G0）
- [无运行时DDL] schema 只走 migration，无运行时 DDL；rollup 采读时计算不落库、配置存 `db_fields.options`，不建新表（来源: 合同 §10 / J13/J14）
- [反枚举统一404] 跨企业访问统一 404，同文案同响应形状，耗时不构成可区分信号（来源: journey_feature）
- [软删可还原] 删表/删字段/删行全部软删可还原，rollup 依赖失效时安全降级不留悬空指针（来源: journey_feature）
- [墙·方向一] database 表内容不进路① 问答检索域；rollup 富数据同口径挡外，读服务钉死路径不被 knowledge 检索特征文件 import（来源: journey_feature/A35）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability golden path（Sprint A/B/C/D），按步骤摘要 -->
- S1 建得出表(Sprint A): 建本组织表 → 8 类字段元数据 → 工作台列表 → 空状态模板 → 表级可见性(仅自己/组织) → 软删+30天回收站 → 审计行
- S2 数据进得来(Sprint B): AG Grid 表格视图 → 行 CRUD(field_id) → 乐观锁 409 → 剪贴板粘贴导入 → 行详情面板 → 软删行+回收站 → JSON 全量导出 → ≤5000 行上限
- S3 视图切得开(Sprint C): 筛选/排序(JSONB + field_id 白名单) → 看板拖卡换列 → 视图切换器 → ViewPrefs 读写 → 「指派给我」全局视图
- S4 关联连得上(Sprint D): relation 字段类型 + 目标表配置 → 行选择器建关联(目标 row_id 数组落 db_rows.data) → 单元格显示标题+点击跳转 → 反向引用面板 → 删行/删表/删字段引用安全失效 → 组织隔离三向 + 私有表零泄露

## NFR 约束

<!-- 来源: decisions category=nfr 为空；PrepPRD 未显式指定超时/频控 -->
- 超时/延迟: 待定（PrepPRD 未指定）；rollup 读时计算无缓存，工作台单表 ≤5000 行 N+1 读可接受（J13 依据）
- 频控: N/A
- 版本要求: AG Grid 锁 32.2.1（不升 v33）
- 可观测: rollup 聚合/降级失败必须单元格可见提示，**禁静默吞异常**；类型×函数非法组合须 400 明确文案非静默 NaN

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 按 `windows_cloud` 填 Playwright（GitHub Actions windows-latest），接进 `e2e-knowledge-hub-path3.yml` 的 windows-real-browser job。

```bash
# 占位：proposer 将填 windows_cloud Playwright 脚本
# 期望验收点（自然语言）：真浏览器双企业种子下——建 relation 字段 → 配 rollup 字段(选目标字段+聚合函数) →
#   单元格显示 count/sum/min/max/concat 正确聚合值(含 string 数字计入 sum)、lookup 取值多值逗号拼接 →
#   sum 配文本字段建字段 400 拒绝(类型×函数校验) → 删 relation/目标字段/软删目标表三支单元格降级占位(不白屏) →
#   库里改目标行 org 后聚合基数不含该行(组织隔离) → knowledge 检索特征文件 import rollup 服务守卫报红(墙裁定 A41)。
#   windows job conclusion == success 才算过。
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/staff-hub 浏览器 UI（rollup 字段配置器 + 聚合值只读单元格渲染），须真浏览器验收
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy UI 死规则走 GitHub Actions windows-latest 干净 VM，接进既有 e2e-knowledge-hub-path3.yml
## journey_id: da60cb26-5635-4f51-a1f3-a80013f6d69d
## step_id: line11/structured_workbench#step4（S4 关联连得上·rollup 加厚）
