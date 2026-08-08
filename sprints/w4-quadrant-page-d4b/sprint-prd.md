# Sprint PRD — W4 四象限合看页 + 员工回显 + 建单页（D4 前端）

## 元数据

| 字段 | 值 |
|---|---|
| TASK_ID | c33a0160-53bc-48b5-ac92-4f7ae5cedcd7 |
| SPRINT_DIR | sprints/w4-quadrant-page-d4b |
| JOURNEY_ID | 2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6 |
| GP_ID | 7790f728-f490-4243-b166-03f3250a0938 |
| GP_ANCHOR | 步2「部署被证明没坏」加厚 |
| TARGET_ENV | mac_web（本机 Playwright，localhost:5174，内网） |
| BASE_REPO | https://github.com/perfectuser21/zenithjoy-workspace.git |
| 法源 | decisions fdeb48aa（六条）+ decisions 8640ef58（三条，2026-08-07 拍板） |
| 已上主干 | D1(migration392-393) + D2(zj#1623) + D3(cecelia#4714) + D4后端(cecelia#4715) |
| 生成时间 | 2026-08-08 |

---

## 真机边界声明

**本 sprint 零真机动作。**

本单范围为 `apps/staff-hub` 前端 + 反代层，不涉及任何安卓设备操作、APK 安装、采集触发或客户端交互。PrepPRD 中出现「android/真机」名词，均属 theater 闸语境化背景说明——验收规程（`acceptance-spec/line02-android.yaml`）是此 sprint 数据模型的上游规格，但本 sprint 自身交付物中 **AI 仅读 staging 页面，不发起任何真机动作**。

E2E 验收走 `mac_web`（本机 Playwright，localhost:5174），不走 `windows_cloud`。

---

## OKR 对齐

- **Journey**：工厂 · F2 部署闭环（journey `2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6`）
- **GP 步骤**：步2「部署被证明没坏」——加厚（非新路）
- **当前状态**：D1 数据层 + D2 采证器 + D3 后端裁剪 + D4 adjudication 后端已上主干；前端四象限合看页、员工裁决回显、建单页表头字段尚未交付
- **本 sprint 目标**：交付 Staff Hub 前端全部 D4 界面，使「发版验收一体两面」流程在 UI 层闭环

---

## 背景

后端契约已全部上线：

- **cecelia#4714（D3 裁剪）**：SQL 列白名单 / view 参数 / 跨轮闸 / 三 token 分权 / 5223 人列写端点下线；填表视图不返回 AI 列
- **cecelia#4715（D4 后端）**：adjudication 裁决 API / hard 格裁决绿 P0 与 unverifiable 例外 / 聚合分流建任务 / 熔断
- **human_complete 后**合看页解锁，裁决/review-ack/review-closed 端点可直接调
- **规格 SSOT**：Brain golden_paths（7790f728）.proposal_doc（v7-final）

前端当前缺失：
1. 九组合矩阵合看页（四象限叠色 + 格状态渲染）
2. 分歧格双证据展开
3. 主理人裁决按钮（调 adjudication API）
4. 员工侧裁决回显 + ack + 异议 note + 关闭复盘按钮
5. 侧边栏待办角标 + 仪式发起通知
6. 建单页表头字段（含 scenarios_observed 强制勾选）
7. lib.mjs 收编（generate 改只读说明书 / 去三态按钮 / 第三态措辞统一）
8. 反代层对 AI 列同步不透传

---

## Golden Path（核心验收场景）

员工（`staff` token）在 Staff Hub → 验收模块 → 打开「合看页」→ 看到九组合矩阵（格×(AI列,人列) 叠色，device/scenario_class 标记，第 14 步灰带，S13-c4 图例）→ 点击分歧格展开左右并排双证据 → 主理人（`reviewer` token）看到裁决按钮 → 裁决后员工侧回显判决结果 → 员工点击「我已看过裁决」完成 review-ack → 发起人/主理人点击「关闭复盘」（员工打 review-closed 会 403）

建单入口：建单页表头 7 个字段全部填写，scenarios_observed 5 个 mandatory 场景码全部勾选，缺一不许推进提交按钮。

---

## Response Schema

调用的已上线后端端点：

```
# 合看页数据（human_complete 后解锁）
GET  /api/staff/acceptance/quadrant?run_key={run_key}
# 返回：{ matrix: Cell[][], ai_view: omitted（服务端裁剪，前端不收 AI 列原始数据）}

# adjudication 裁决（主理人 reviewer token）
POST /api/staff/acceptance/adjudication
Body: { run_key, cell_id, verdict: "绿" | "红" }
Response: { ok: true }

# 员工 review-ack
POST /api/staff/acceptance/review-ack
Body: { run_key, note?: string }
Response: { ok: true }

# 关闭复盘（发起人/主理人，员工打返回 403）
POST /api/staff/acceptance/review-closed
Body: { run_key }
Response: { ok: true } | 403

# 建单提交
POST /api/staff/acceptance/create-run
Body: { gp_id, tenant_account, phone_model, client_id, task_no, passphrase,
        scenarios_observed: string[5], device_reboot_at?: string }
```

**反代层透传规则（⑧要求）**：前端向 `/api/staff/acceptance/quadrant` 请求时，后端服务端裁剪已移除 AI 列原始数据（cecelia#4714 对齐）。前端不可在反代层做任何将 AI 列回补的操作。

---

## 功能需求（FR）

### FR-1 九组合矩阵合看页

**路由**：`/acceptance/:runKey/quadrant`（新增）

**UI 要素**：
- 格 = scenario × column(AI, 人) 叠色渲染，共 9 种组合色（见规格 §九组合矩阵）
- 每格标注：`device`（设备型号）、`scenario_class`（mandatory / unverifiable_this_version）
- 第 14 步（step 14）整行显示灰带（步骤灰带标记）
- S13-c4 格显示特殊图例：「本版无受控手段制造频控场景」
- 缺格（na: true）显示缺格图例（灰色占位 + 「不适用」文字）
- `data-testid="quadrant-matrix"` 根容器
- 每格 `data-testid="cell-{scenario_id}-{col}"` 其中 col ∈ `ai|human`

**数据来源**：`GET /api/staff/acceptance/quadrant?run_key={run_key}`（human_complete 后解锁）

**锁定提示**：若 `human_complete` 尚未完成，显示 `data-testid="quadrant-locked"` 提示「员工验收未完成，合看页暂不可用」

### FR-2 分歧格展开（双证据并排）

- 点击任何「分歧格」（AI 列 ≠ 人列 verdict 的格）展开详情
- 展开后左右并排：左侧=AI evidence 指针（截图链接 / 打表结论），右侧=人列 note（员工填写的意见）
- `data-testid="divergence-{cell_id}"` 容器
- `data-testid="divergence-ai-{cell_id}"` 左侧 AI 证据区
- `data-testid="divergence-human-{cell_id}"` 右侧人列证据区

### FR-3 主理人裁决按钮

**角色限制**：仅 `reviewer` token 可见裁决按钮；`staff` token 不可见

- 每个分歧格展开后，显示裁决按钮组：「判绿」/「判红」
- 点击后调 `POST /api/staff/acceptance/adjudication`，body `{ run_key, cell_id, verdict }`
- verdict ∈ `{ 绿, 红 }`
- 提交中状态：按钮禁用 + 显示「裁决中...」
- 成功后：按钮消失，格状态更新为裁决后颜色
- 失败后：显示错误提示，允许重试
- `data-testid="adjudication-{cell_id}"` 裁决容器
- `data-testid="adjudicate-green-{cell_id}"` 判绿按钮
- `data-testid="adjudicate-red-{cell_id}"` 判红按钮

### FR-4 员工裁决回显视图 + ack + 关闭复盘

**员工侧（`staff` token）**：
- 裁决完成后，格状态更新（绿/红）并标注「主理人已裁决」
- 显示「我已看过裁决」按钮（`data-testid="review-ack-btn"`），点击调 `POST /api/staff/acceptance/review-ack`
- ack 后可填写异议 note（可选文本框，`data-testid="review-ack-note"`）
- ack 成功后按钮变为「已确认」disabled 状态

**发起人/主理人侧**：
- 所有员工 ack 完成后，显示「关闭复盘」按钮（`data-testid="review-closed-btn"`）
- 调 `POST /api/staff/acceptance/review-closed`
- **员工 token 点击返回 403**：UI 显示错误提示「权限不足，只有发起人或主理人可关闭复盘」，不显示该按钮

### FR-5 侧边栏待办角标 + 仪式发起通知

- 侧边栏「验收」NavLink 添加角标，显示 `(N)` 其中 N = 待处理项数量（含合看页待裁决/待 ack 的格）
- `data-testid="acceptance-nav-badge"` 包裹角标数字
- 仪式发起时（建单后），侧边栏出现「新仪式已发起」提示条（toast 或内联提示）
- `data-testid="ritual-notification"` 通知容器

### FR-6 建单页（新增路由 `/acceptance/new`）

**字段（全部必填，缺一不许提交）**：

| 字段名 | `data-testid` | 类型 | 说明 |
|---|---|---|---|
| 测试用客户账号（验收专用租户下拉） | `new-run-tenant-account` | `<select>` | 验收专用租户列表，从后端拉取 |
| 手机型号 | `new-run-phone-model` | `<input>` | 自由文本 |
| 客户端编号 | `new-run-client-id` | `<input>` | 自由文本 |
| 本轮任务编号 | `new-run-task-no` | `<input>` | 自由文本 |
| 本轮暗号 | `new-run-passphrase` | `<input>` | 自由文本 |
| scenarios_observed（5 个 mandatory 场景码勾选） | `new-run-scenarios-observed` | 复选框组 | S1/S4/S5/S6/S7 等 mandatory 场景码，全部勾选才可提交 |
| device_reboot_at（条件字段） | `new-run-device-reboot-at` | `<input>` | 如勾选了 S4（需重启场景）则变为必填；其余情况选填 |

**提交规则**：
- 5 个 mandatory 场景码未全勾选时，提交按钮禁用，显示「请勾选所有必选场景（{缺失数量}个未勾选）」
- 提交成功后跳转 `/acceptance` 列表页，并触发 FR-5 仪式通知
- `data-testid="new-run-submit"` 提交按钮
- `data-testid="new-run-form"` 表单容器

### FR-7 lib.mjs 收编

**改动范围**：`scripts/acceptance-spec/lib.mjs` 的 `renderHtml()` 函数

1. **`generate` 改产只读判据说明书**：`cli.mjs generate` 输出的 HTML 改为「只读判据说明书」模式（展示规程内容，不含填写表单）
2. **去三态按钮**：移除 HTML 中员工可操作的「通过/不通过/无法验证」选择控件（填写入口统一迁移到 Staff Hub 前端 Detail Page）
3. **第三态措辞统一**：全文将原有不统一表述（「暂时无法验证」「N/A」等）统一改为「无法验证」

### FR-8 反代层 AI 列同步不透传

**改动范围**：`apps/staff-hub/vite.config.ts` 或代理中间件

- 确认反代层不会将 AI 列原始数据从后端透传到前端（cecelia#4714 已在服务端裁剪，此处为防护层）
- 若现有 vite proxy 仅做透传（changeOrigin: true），则此项**无需额外代码**，由 cecelia#4714 服务端保证，在 PRD 中标注「已由服务端保证，前端验证 response 中 ai_raw 字段不存在即可」

---

## 非功能需求（NFR）

| # | 项目 | 要求 |
|---|---|---|
| NFR-1 | 主体分离 | staff token 调 review-closed 返回 403，前端显示「权限不足」提示，不崩溃 |
| NFR-2 | 降级兼容 | Brain 不可达时合看页显示 `data-testid="quadrant-degraded-banner"` |
| NFR-3 | 合看锁 | human_complete 未完成时，合看页显示锁定提示而非白屏 |
| NFR-4 | 反代安全 | 前端收到的 quadrant 响应中不含 `ai_raw`/`ai_column` 原始字段，E2E 断言验证 |

---

## 边界情况

1. **主理人 reviewer token 与员工 staff token 在同一 session 的角色切换**：不在本 sprint 范围，两个角色对应不同账号登录
2. **scenarios_observed 的 mandatory 场景码列表**：从 `acceptance-spec/line02-android.yaml` 读取 `scenario_class: mandatory` 的格，不硬编码
3. **S13-c4 图例**：仅在合看页 S13 行第 4 列格显示特殊说明，不影响其他格
4. **`device_reboot_at` 条件字段**：仅当 scenarios_observed 中包含 S4 系列场景码时变为必填；其他情况为选填

---

## 范围限定

**在范围内**：
- `apps/staff-hub/src/pages/QuadrantPage.tsx`（新增）
- `apps/staff-hub/src/pages/NewRunPage.tsx`（新增）
- `apps/staff-hub/src/App.tsx`：添加 `/acceptance/:runKey/quadrant` 和 `/acceptance/new` 路由；侧边栏角标
- `apps/staff-hub/src/pages/AcceptanceDetailPage.tsx`：跳转入口到合看页
- `scripts/acceptance-spec/lib.mjs`：renderHtml 改产只读说明书，去三态按钮，第三态措辞统一
- `apps/staff-hub/e2e/acceptance.spec.ts`：新增合看页、建单页、裁决流程的 E2E 覆盖

**不在范围内**：
- 后端端点（D3/D4 已上线）
- 真机操作 / APK 安装 / 采集触发
- 多租户数据库迁移
- 移动端适配（本期仅桌面 Staff Hub）
- cecelia 端的任何改动（仅消费其 API）

---

## 假设

- [ASSUMPTION] `GET /api/staff/acceptance/quadrant` 端点由 cecelia#4715 已上线，返回九组合矩阵数据，AI 列原始数据已由服务端裁剪
- [ASSUMPTION] 验收专用租户列表由 `GET /api/staff/acceptance/tenants`（或现有 `/api/staff/acceptance/pending` 响应中包含）提供；若端点不存在，建单页租户下拉退化为自由文本输入
- [ASSUMPTION] `reviewer` token 和 `staff` token 的角色信息由 `useAuth()` context 中的 `user.role` 字段区分
- [ASSUMPTION] scenarios_observed mandatory 场景码定义与 `acceptance-spec/line02-android.yaml` 中 `scenario_class: mandatory` 保持同步

---

## E2E 验收清单（五项）

| # | 验收项 | 断言方式 | Pass 条件 |
|---|---|---|---|
| E2E-1 | 合看页路由 `/acceptance/:runKey/quadrant` 可渲染，降级路径正常 | Playwright `data-testid` | `quadrant-matrix` 或 `quadrant-locked` 或 `quadrant-degraded-banner` 三选一可见 |
| E2E-2 | 建单页 `/acceptance/new` 7 字段渲染，scenarios_observed 未全勾选时提交按钮禁用 | Playwright form assertion | `new-run-submit` 在缺少 mandatory 场景码勾选时为 `disabled`；全勾选后变为可点击 |
| E2E-3 | 分歧格展开后左右双证据区可见 | Playwright click + testid | 点击分歧格后 `divergence-ai-{cell_id}` 和 `divergence-human-{cell_id}` 均出现 |
| E2E-4 | lib.mjs generate 产出的 HTML 中不含三态操作按钮 | Node.js 断言 | 生成的 HTML 不含 `<select>` 或 `<button>` 等填写控件；所有「暂时无法验证」替换为「无法验证」 |
| E2E-5 | 员工 staff token 尝试关闭复盘时，UI 不崩溃并显示权限提示 | Playwright 403 error boundary | 见到「权限不足，只有发起人或主理人可关闭复盘」提示；页面不白屏 |

---

## 不变量（Invariants）

| # | 不变量 | 来源 |
|---|---|---|
| INV-1 | AI 列原始数据不得在前端渲染或存储（服务端裁剪后的合法响应不含 ai_raw 字段） | cecelia#4714 + FR-8 |
| INV-2 | staff token 调 review-closed 端点，服务端返回 403，不得在客户端绕过 | cecelia#4715 + NFR-1 |
| INV-3 | scenarios_observed 5 个 mandatory 场景码缺一，建单提交不得发出 | FR-6 |
| INV-4 | 合看页在 human_complete 完成前始终锁定（不展示格内容） | GP v7-final §合看闸 |
| INV-5 | S13-c4 格永远显示「本版无受控手段制造频控场景」图例，不可裁决 | GP v7-final §S13-c4 处置 |
| INV-6 | lib.mjs generate 产出 HTML 严格只读，不含任何填写控件 | FR-7 + decisions 8640ef58 |

---

## 开发顺序建议

```
commit-1: E2E 失败测试（合看页 + 建单页 + 裁决流程）
commit-2: QuadrantPage.tsx — 矩阵渲染 + 格状态叠色
commit-3: QuadrantPage.tsx — 分歧格展开 + 双证据并排
commit-4: QuadrantPage.tsx — 主理人裁决按钮 + 员工 ack + 关闭复盘
commit-5: NewRunPage.tsx — 建单表头 7 字段 + scenarios_observed 强制校验
commit-6: App.tsx — 路由注册 + 侧边栏角标 + 仪式通知
commit-7: lib.mjs — generate 改只读 + 去三态 + 措辞统一
commit-8: E2E 全绿验证
```

---

## 验收要求摘要（AI staging 验收）

本 sprint 由 AI 在 staging 页面只读验收，不触发任何真机动作。

**AI 验收步骤**：
1. 打开 Staff Hub（localhost:5174 或 staging URL）
2. 导航至 `/acceptance/new`，截图确认 7 字段表单渲染
3. 在 scenarios_observed 中不全勾选，断言提交按钮禁用
4. 若存在已完成的 run（human_complete），导航至 `/acceptance/{runKey}/quadrant`，截图合看矩阵
5. 截图中确认 S13-c4 图例文字、第 14 步灰带标记存在
6. 运行 `node scripts/acceptance-spec/cli.mjs generate`，确认产出 HTML 不含三态选择控件
