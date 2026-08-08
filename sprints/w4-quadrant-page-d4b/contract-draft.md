# Contract Draft — W4 四象限合看页 + 员工回显 + 建单页（D4 前端）

## 元数据

| 字段 | 值 |
|---|---|
| TASK_ID | c33a0160-53bc-48b5-ac92-4f7ae5cedcd7 |
| SPRINT_DIR | sprints/w4-quadrant-page-d4b |
| PRD 来源 | sprints/w4-quadrant-page-d4b/sprint-prd.md |
| 生成时间 | 2026-08-08 |
| 合同版本 | v1（首轮，无 reviewer feedback） |
| 目标环境 | mac_web（本机 Playwright，localhost:5174） |

---

## 真机边界声明

**本 sprint 零真机动作。**

PrepPRD 含 `android` 名词，均属 theater 闸语境化背景说明（`acceptance-spec/line02-android.yaml` 上游规格引用），本 sprint 自身交付物 **AI 仅读 staging 页面，不发起任何安卓设备操作、APK 安装、采集触发或客户端交互**。

E2E 验收走 `mac_web`（本机 Playwright，localhost:5174），不走 `windows_cloud`。

---

## [BEHAVIOR] 行为合同条目

### [BEHAVIOR-1] 合看页路由可访问

**描述**：`/acceptance/:runKey/quadrant` 路由存在，访问后渲染三态之一——矩阵、锁定提示、降级提示。

**前提**：Staff Hub 在 localhost:5174 可访问，路由已在 `App.tsx` 注册。

**断言**：
- `data-testid="quadrant-matrix"` 可见（human_complete 已完成且 Brain 可达）
- 或 `data-testid="quadrant-locked"` 可见（human_complete 尚未完成）
- 或 `data-testid="quadrant-degraded-banner"` 可见（Brain 不可达）
- 以上三选一，页面不白屏、不抛未捕获异常

**来源**：FR-1、NFR-2、NFR-3

---

### [BEHAVIOR-2] 九组合矩阵格状态叠色渲染

**描述**：合看页矩阵每格按 (AI verdict, 人列 verdict) 组合色正确渲染，格元素含 `data-testid`。

**前提**：`GET /api/staff/acceptance/quadrant?run_key={runKey}` 返回含 `matrix` 字段的合法响应，服务端 AI 列原始数据已裁剪（`ai_raw` 字段不存在）。

**断言**：
- 响应 JSON 中不含 `ai_raw` 或 `ai_column` 字段（NFR-4）
- 每格元素 `data-testid="cell-{scenario_id}-ai"` 和 `data-testid="cell-{scenario_id}-human"` 存在
- step 14 整行含 `data-testid` 属性包含灰带标记（CSS class 或 `data-step14="true"`）
- S13-c4 格文字包含「本版无受控手段制造频控场景」（INV-5）
- 缺格（`na: true`）格含「不适用」文字或对应 `data-testid`

**来源**：FR-1、INV-1、INV-5

---

### [BEHAVIOR-3] 分歧格展开后双证据区可见

**描述**：点击分歧格（AI verdict ≠ 人列 verdict 的格）后，展开左右并排双证据区。

**前提**：矩阵中存在至少一个分歧格。

**断言**：
- 点击分歧格后 `data-testid="divergence-{cell_id}"` 容器出现
- `data-testid="divergence-ai-{cell_id}"` 左侧 AI 证据区可见
- `data-testid="divergence-human-{cell_id}"` 右侧人列证据区可见
- 两区域并排展示（不重叠、不隐藏）

**来源**：FR-2

---

### [BEHAVIOR-4] 主理人裁决按钮仅 reviewer token 可见

**描述**：`reviewer` token 登录后，分歧格展开区显示裁决按钮组；`staff` token 登录后，裁决按钮不可见。

**前提**：存在分歧格，用户已登录（`useAuth()` context 提供 `user.role`）。

**断言**：
- reviewer token 下：`data-testid="adjudicate-green-{cell_id}"` 和 `data-testid="adjudicate-red-{cell_id}"` 可见
- staff token 下：上述按钮不存在于 DOM 中
- 点击「判绿」/「判红」后，按钮禁用并显示「裁决中...」文字
- 调用 `POST /api/staff/acceptance/adjudication` body 含 `{ run_key, cell_id, verdict }`，verdict ∈ `{ 绿, 红 }`
- 成功后按钮消失，格状态更新

**来源**：FR-3、INV-2

---

### [BEHAVIOR-5] 员工 ack + 异议 note + 关闭复盘按钮权限

**描述**：裁决完成后员工看到「我已看过裁决」按钮并可填写异议 note；staff token 无法触发关闭复盘且不崩溃。

**前提**：已完成裁决动作，用户以 staff token 登录。

**断言**：
- `data-testid="review-ack-btn"` 在裁决后对 staff 可见
- 点击 ack 后，`data-testid="review-ack-note"` 文本框出现（可选填写）
- ack 成功后按钮变为 disabled 状态，文字为「已确认」
- staff token 下 `data-testid="review-closed-btn"` 不显示
- reviewer/发起人 token 下，所有员工 ack 后 `data-testid="review-closed-btn"` 出现
- staff token 如以任何方式触发 review-closed（绕过 UI），后端返回 403，前端显示「权限不足，只有发起人或主理人可关闭复盘」，不白屏（NFR-1）

**来源**：FR-4、NFR-1、INV-2

---

### [BEHAVIOR-6] 侧边栏待办角标显示

**描述**：侧边栏「验收」NavLink 显示待处理项角标 `(N)`，仪式发起后出现通知提示条。

**前提**：Staff Hub 正常加载，存在待处理验收项。

**断言**：
- `data-testid="acceptance-nav-badge"` 存在于侧边栏 DOM 中
- 角标数字 N 等于待处理项数量（含待裁决 + 待 ack 的格）
- 建单成功后，`data-testid="ritual-notification"` 提示出现（toast 或内联）

**来源**：FR-5

---

### [BEHAVIOR-7] 建单页 7 字段渲染与 mandatory 场景码强制校验

**描述**：`/acceptance/new` 渲染建单表单，7 个字段全部存在，scenarios_observed 5 个 mandatory 场景码未全勾选时提交按钮禁用。

**前提**：路由 `/acceptance/new` 已注册，租户列表可从后端拉取（或降级为自由文本输入）。

**断言**：
- `data-testid="new-run-form"` 容器存在
- 以下 data-testid 均存在：`new-run-tenant-account`、`new-run-phone-model`、`new-run-client-id`、`new-run-task-no`、`new-run-passphrase`、`new-run-scenarios-observed`、`new-run-device-reboot-at`
- `data-testid="new-run-submit"` 在未全勾选 mandatory 场景码时为 `disabled`
- 提交按钮禁用提示文字含「请勾选所有必选场景」和缺失数量
- scenarios_observed 5 个 mandatory 场景码全勾选后，提交按钮变为可点击（INV-3）
- device_reboot_at 在勾选 S4 系列场景码时变为 required（视觉标记 + 提交阻断）
- 提交成功后跳转 `/acceptance`，触发 FR-5 仪式通知

**来源**：FR-6、INV-3

---

### [BEHAVIOR-8] lib.mjs generate 产出只读 HTML

**描述**：`node scripts/acceptance-spec/cli.mjs generate` 产出的 HTML 不含三态操作控件，所有第三态措辞统一为「无法验证」。

**前提**：`scripts/acceptance-spec/lib.mjs` 的 `renderHtml()` 已改为只读模式。

**断言**：
- 产出 HTML 字符串不含 `<select>` 元素
- 产出 HTML 字符串不含三态操作 `<button>`（「通过」/「不通过」/「无法验证」选择按钮）
- 产出 HTML 字符串不含「暂时无法验证」「N/A」等旧措辞
- 产出 HTML 字符串中所有第三态措辞统一为「无法验证」
- 规程内容（步骤说明、判定标准）仍完整呈现（INV-6）

**来源**：FR-7、INV-6

---

### [BEHAVIOR-9] 反代层不透传 AI 列原始数据

**描述**：前端从 `/api/staff/acceptance/quadrant` 收到的响应中，不含 `ai_raw` 或 `ai_column` 字段。

**前提**：后端 cecelia#4714 服务端裁剪已上线；反代层（vite proxy）仅透传。

**断言**：
- E2E 拦截 `/api/staff/acceptance/quadrant` 响应 JSON，断言不含 `ai_raw` 键
- 断言不含 `ai_column` 键
- 如 Brain 不可达，跳过此项（降级路径合法）

**来源**：FR-8、NFR-4、INV-1

---

## ## E2E 验收段

本合同 E2E 验收走 `mac_web`（本机 Playwright，localhost:5174），对应测试文件：
`sprints/w4-quadrant-page-d4b/tests/quadrant-e2e.spec.ts`

执行命令：
```bash
cd /workspace && npx playwright test sprints/w4-quadrant-page-d4b/tests/quadrant-e2e.spec.ts --reporter=line
```

lib.mjs 只读断言执行命令：
```bash
cd /workspace && node scripts/acceptance-spec/cli.mjs generate > /tmp/acceptance-gen.html && node -e "
const html = require('fs').readFileSync('/tmp/acceptance-gen.html', 'utf8');
const hasSelect = /<select/i.test(html);
const hasOldText = /暂时无法验证/.test(html);
console.log('select存在:', hasSelect, '旧措辞存在:', hasOldText);
if (hasSelect || hasOldText) process.exit(1);
console.log('PASS: lib.mjs generate 产出 HTML 符合只读规范');
"
```

---

## ## 未覆盖真实链路清单段

| 链路 | 未覆盖原因 | 处理方式 |
|---|---|---|
| reviewer token 真实登录流程 | CI 沙盒无真实 reviewer 账号 | 用 mock auth context 注入 `user.role = 'reviewer'` |
| human_complete 状态等待真实员工完成 | Brain 在 CI 沙盒不可达 | E2E 测试用 `quadrant-locked` 或 `quadrant-degraded-banner` 降级路径合法通过 |
| POST adjudication 真实写库验证 | CI 沙盒无 Brain 写权限 | 仅断言 UI 状态变化（按钮禁用 + 消失），不验证 DB 写入 |
| scenarios_observed mandatory 码列表动态拉取 | acceptance-spec/line02-android.yaml 不在 mac_web CI 上 | 硬编码 S1/S4/S5/S6/S7 于测试中，与 yaml 定义对齐 |
| 租户下拉 `GET /api/staff/acceptance/tenants` | 端点可能不存在（PRD ASSUMPTION） | 建单页测试验证降级为自由文本输入的行为 |
