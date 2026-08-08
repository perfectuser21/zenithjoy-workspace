# Contract DoD — W4 四象限合看页 + 员工回显 + 建单页（D4 前端）

## 元数据

| 字段 | 值 |
|---|---|
| TASK_ID | c33a0160-53bc-48b5-ac92-4f7ae5cedcd7 |
| SPRINT_DIR | sprints/w4-quadrant-page-d4b |
| 生成时间 | 2026-08-08 |
| 合同版本 | v1 |

---

## DoD 条目

### [DOD-1] 路由注册

- [ ] `App.tsx` 中注册 `/acceptance/:runKey/quadrant` 路由，指向 `QuadrantPage.tsx`
- [ ] `App.tsx` 中注册 `/acceptance/new` 路由，指向 `NewRunPage.tsx`
- [ ] 路由注册后 `npm run build`（或 `vite build`）无 TypeScript/ESLint 报错

---

### [DOD-2] QuadrantPage.tsx 新增

- [ ] 文件位于 `apps/staff-hub/src/pages/QuadrantPage.tsx`
- [ ] 包含 `data-testid="quadrant-matrix"` 根容器
- [ ] 每格含 `data-testid="cell-{scenario_id}-ai"` 和 `data-testid="cell-{scenario_id}-human"`
- [ ] human_complete 未完成时渲染 `data-testid="quadrant-locked"`，文字为「员工验收未完成，合看页暂不可用」
- [ ] Brain 不可达时渲染 `data-testid="quadrant-degraded-banner"`
- [ ] step 14 整行含灰带标记（`data-step14="true"` 或对应 CSS class）
- [ ] S13-c4 格含「本版无受控手段制造频控场景」文字，不含裁决按钮（INV-5）
- [ ] 缺格（na）含「不适用」文字

---

### [DOD-3] 分歧格展开

- [ ] 点击分歧格后 `data-testid="divergence-{cell_id}"` 出现
- [ ] `data-testid="divergence-ai-{cell_id}"` 左侧 AI 证据区存在
- [ ] `data-testid="divergence-human-{cell_id}"` 右侧人列证据区存在
- [ ] 非分歧格点击不触发展开

---

### [DOD-4] 主理人裁决按钮

- [ ] reviewer token 下：`data-testid="adjudicate-green-{cell_id}"` 和 `data-testid="adjudicate-red-{cell_id}"` 在分歧格展开区可见
- [ ] staff token 下：裁决按钮不渲染（不在 DOM 中）
- [ ] 点击后按钮禁用，显示「裁决中...」
- [ ] 成功后按钮消失，格状态更新
- [ ] 失败后显示错误提示，允许重试
- [ ] 调用 `POST /api/staff/acceptance/adjudication` body 格式正确

---

### [DOD-5] 员工 ack + 关闭复盘

- [ ] staff token 下 `data-testid="review-ack-btn"` 在裁决完成后可见
- [ ] ack 成功后按钮变为 disabled，文字为「已确认」
- [ ] `data-testid="review-ack-note"` 可选文本框存在
- [ ] staff token 下不渲染 `data-testid="review-closed-btn"`
- [ ] reviewer/发起人 token 下，所有员工 ack 后渲染 `data-testid="review-closed-btn"`
- [ ] staff token 如触发 review-closed，UI 捕获 403 并显示「权限不足，只有发起人或主理人可关闭复盘」，不白屏

---

### [DOD-6] 侧边栏角标与仪式通知

- [ ] 侧边栏「验收」NavLink 含 `data-testid="acceptance-nav-badge"` 元素
- [ ] 角标数字反映待处理项数量（待裁决 + 待 ack）
- [ ] 建单成功后 `data-testid="ritual-notification"` 出现

---

### [DOD-7] NewRunPage.tsx 新增

- [ ] 文件位于 `apps/staff-hub/src/pages/NewRunPage.tsx`
- [ ] `data-testid="new-run-form"` 表单容器存在
- [ ] 以下 data-testid 均存在：`new-run-tenant-account`、`new-run-phone-model`、`new-run-client-id`、`new-run-task-no`、`new-run-passphrase`、`new-run-scenarios-observed`、`new-run-device-reboot-at`
- [ ] `data-testid="new-run-submit"` 在 mandatory 场景码未全勾选时为 `disabled`
- [ ] 禁用时显示「请勾选所有必选场景（{N}个未勾选）」提示
- [ ] 5 个 mandatory 场景码（S1/S4/S5/S6/S7）全勾选后提交按钮可点击
- [ ] S4 勾选时 device_reboot_at 变为必填
- [ ] 提交成功后跳转 `/acceptance` 并触发仪式通知

---

### [DOD-8] lib.mjs 改为只读模式

- [ ] `scripts/acceptance-spec/lib.mjs` 的 `renderHtml()` 产出 HTML 不含 `<select>` 元素
- [ ] 产出 HTML 不含三态操作按钮（「通过」/「不通过」/「无法验证」选择控件）
- [ ] 产出 HTML 将所有「暂时无法验证」「N/A」等旧措辞替换为「无法验证」
- [ ] 规程内容（步骤说明、判定标准）仍完整呈现

---

### [DOD-9] 反代层安全验证

- [ ] 确认 vite proxy 配置仅做透传（changeOrigin: true），不回补 AI 列
- [ ] E2E 断言 `/api/staff/acceptance/quadrant` 响应 JSON 不含 `ai_raw` 键
- [ ] E2E 断言不含 `ai_column` 键
- [ ] 在 `apps/staff-hub/vite.config.ts` 添加注释说明此项已由服务端保证

---

### [DOD-10] E2E 测试覆盖

- [ ] `sprints/w4-quadrant-page-d4b/tests/quadrant-e2e.spec.ts` 存在且可运行
- [ ] 覆盖 contract-draft.md 中 [BEHAVIOR-1] 至 [BEHAVIOR-9] 的验收项
- [ ] 测试文件亦追加至 `apps/staff-hub/e2e/acceptance.spec.ts`（合看页、建单页、裁决流程新增段落）
- [ ] CI 环境下（Brain 不可达）测试不因降级路径误报 FAIL
- [ ] `npm run test:e2e`（或项目对应 playwright 命令）执行后，所有新增 test case 至少通过降级路径断言

---

### [DOD-11] 代码质量

- [ ] 无 `console.log`、注释代码、未使用 import
- [ ] 单文件不超过 500 行
- [ ] `npm run lint`（ESLint + TypeScript）零 error
- [ ] 无 `*New.tsx` / `*Old.tsx` / `*Backup.*` 临时文件
- [ ] commit 顺序遵循 PRD 开发顺序建议（commit-1 为失败 E2E，commit-2 起为实现）

---

## manual:bash 验收命令

### 合看页路由可访问

```bash
cd /workspace && npx playwright test sprints/w4-quadrant-page-d4b/tests/quadrant-e2e.spec.ts --grep "合看页路由" --reporter=line
```

### 建单页 mandatory 场景码校验

```bash
cd /workspace && npx playwright test sprints/w4-quadrant-page-d4b/tests/quadrant-e2e.spec.ts --grep "建单页" --reporter=line
```

### lib.mjs 只读 HTML 验证

```bash
cd /workspace && node scripts/acceptance-spec/cli.mjs generate > /tmp/acceptance-gen.html && node -e "
const html = require('fs').readFileSync('/tmp/acceptance-gen.html', 'utf8');
const checks = [
  ['无 <select>', !/<select/i.test(html)],
  ['无暂时无法验证', !/暂时无法验证/.test(html)],
  ['无 N/A 旧措辞（独立N/A）', !/\\bN\\/A\\b/.test(html)],
];
let pass = true;
for (const [name, ok] of checks) {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name);
  if (!ok) pass = false;
}
process.exit(pass ? 0 : 1);
"
```

### 反代层 AI 列不透传验证

```bash
cd /workspace && npx playwright test sprints/w4-quadrant-page-d4b/tests/quadrant-e2e.spec.ts --grep "ai_raw" --reporter=line
```

### ESLint + TypeScript 全量检查

```bash
cd /workspace && npm run lint 2>&1 | tail -20
```
