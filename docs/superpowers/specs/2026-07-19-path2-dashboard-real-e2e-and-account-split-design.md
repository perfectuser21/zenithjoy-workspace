# Path2 dashboard 真实 Playwright E2E + 账号绑定页 Android/Windows 拆分 — 设计

## 背景

见 `sprints/07191452-path2-dashboard-real-e2e-and-account-split/prep-prd.md`。两件事：

1. `golden-path-2-smoke.sh` 从未有真正驱动浏览器点击的测试验证"客户在 dashboard 操作"这条路径，全部是 curl。
2. `AcquisitionAccountsPage.tsx` 的"绑定新小号"只有一个 Windows/PC 专属流程（弹 Chrome 扫码），Android 小号本该是人在手机上切换账号、中台被动检测，但页面完全没说明这个区别。

## 架构

### 1. Playwright spec：`apps/dashboard/e2e/acquisition-tasks-collect-start.spec.ts`

沿用仓库既有 Playwright 约定（见 `acquisition-config.spec.ts`）：`page.route()` stub 后端接口，不依赖真实运行的后端，验证"前端点击 → 正确调用 API → UI 正确响应"这条链路，运行方式与其它 dashboard spec 一致，走 CI 的 windows-latest Playwright job。

覆盖场景：
- `GET /api/agent/machines` stub 返回一台 `status: 'online'` 的机器（否则"开始采集"按钮会被禁用，测不到点击）
- `GET /api/agent/burner/sessions` stub 返回空列表（不测账号下拉这条分支，聚焦"开始采集"主路径）
- `GET /api/acquisition/collect-tasks` stub 初始返回空任务列表
- 打开 `/area/acquisition/tasks`
- 填关键词输入框（`placeholder` 含"关键词"）为 `"装修"`
- 点击 `getByRole('button', { name: '开始采集' })`
- stub `POST /api/acquisition/collect/start`，断言请求体 `keywords` 数组等于 `['装修']`
- 断言点击后按钮短暂进入 disabled/提交态，随后 `GET /api/acquisition/collect-tasks` 被重新调用（`await load()`）

不覆盖：账号下拉选择、多关键词分词、"无在线机器"禁用态——这些是后续可以补的分支，本次只补最核心的"客户填关键词点开始采集"这一条主路径的真实浏览器验证，对应 golden-path-2-smoke.sh 里长期缺失的那一环。

### 2. `AcquisitionAccountsPage.tsx`：绑定区块拆分

现状（"绑定新小号"整个 section）：一个输入框 + 一个"开始绑定（弹独立Chrome扫码）"按钮，隐含只针对 Windows/PC。

改为并列两个子区块（同一个 section 标题"绑定新小号"下面）：

**Windows/PC 子区块**（原样保留现有输入框+按钮，只是加个小标题区分）：
```
标题："💻 Windows / PC 绑定"
（原有的 input + 校验 + "开始绑定（弹独立Chrome扫码）"按钮，逻辑完全不变）
```

**Android 子区块**（纯说明文字，不调用任何 API，不需要 state）：
```
标题："📱 Android 绑定"
说明文字："在手机 ZenithJoy Agent App 里，切换到你要绑定的抖音小号——中台会自动检测到并出现在上方账号列表里，无需在此操作。"
```

两个子区块之间用一条分隔线/间距区分，保持视觉上"这是两条独立路径"而不是一个表单里的可选项。

`atCap`（已达10个上限）时的提示文案保持只覆盖 Windows 子区块（Android 绑定不受这个网页上限的限制，是设备侧检测，理论上不需要因为"网页表单达到上限"就隐藏 Android 说明——但这是本次不深究的边界情况，暂维持"达到上限就都不显示"的现状简化处理，不在本次范围内引入新的按 device_type 区分上限的逻辑）。

## 判定点

无新增判定点，本次不涉及对模糊现实的自动判断，纯 UI 展示层调整。

## 测试策略

**E2E（Playwright，windows-latest CI）**：
- `acquisition-tasks-collect-start.spec.ts`（新增）：验证"填关键词点开始采集"这条此前从未被真实浏览器测试覆盖的主路径

**Unit/Component**：
- 不需要新增——`AcquisitionAccountsPage.tsx` 的拆分是纯 JSX 展示层调整，不引入新的状态/逻辑分支，现有该页面若有 Playwright 覆盖（`acquisition-ia-redesign.spec.ts` 提到过 Hub 页链接）应确认拆分后其断言（如果有断言到"绑定新小号"按钮文字）仍然找得到对应元素，不需要专门新写单测。

**Integration**：不涉及，纯前端改动。

**Trivial**：无。

## 不包含
- 不改造 CI 闸门本身（decision 5c570680 已登记为独立后续 sprint）
- 不新增"账号下拉/多关键词"等分支的 Playwright 覆盖
- 不改动后端任何 API
