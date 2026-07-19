# 小改动 PrepPRD：Path2 dashboard 真实 Playwright E2E + 账号绑定页 Android/Windows 流程拆分

## 改什么

两件独立但都是今天真机验证音频判定 fix 时被用户当场发现的缺口，合并成一次 sprint：

**1. 补一个真正驱动浏览器点击的 Playwright E2E spec**

`golden-path-2-smoke.sh` 号称是"Path 2 golden path smoke"，但 Step5/Step8 等涉及"客户在 dashboard 操作"的步骤全部是裸 `curl` 调 API，从来没有一个测试真正在浏览器里点过"开始采集"按钮。新增 `apps/dashboard/e2e/acquisition-tasks-collect-start.spec.ts`，覆盖：打开 `/area/acquisition/tasks` → 填关键词 → 点"开始采集"按钮 → 断言真的调用了 `POST /api/acquisition/collect/start` 且 body 里 `keywords` 数组正确 → 断言页面刷新出新任务。

**2. 账号管理页拆分 Android / Windows 绑定流程**

`apps/dashboard/src/pages/AcquisitionAccountsPage.tsx` 的"绑定新小号"区块目前只有一个流程——"开始绑定（弹独立 Chrome 扫码）"，这其实是 Windows/PC 专属的绑定方式（PC 上开 Chrome 扫码登录）。按 Path2 蓝图，Android 小号是人直接在手机 ZenithJoy Agent 里切换抖音账号，中台通过 `DeviceAccountScanService` 被动检测到，**不需要点网页上的任何按钮**。但页面上完全没有告诉用户这个区别，看起来像只有一种绑定方式，用户拿手机准备绑定时会误以为要点这个网页按钮。

拆成两个并列小节：
- 「Windows/PC 绑定」：保留现有输入框 + "开始绑定（弹独立Chrome扫码）"按钮，原样不动
- 「Android 绑定」：纯说明文字，无按钮——"在手机 ZenithJoy Agent App 里，切换到你要绑定的抖音小号 → 中台会在下方账号列表自动检测到，无需在此操作"

## 为什么改

用户在真机验证音频判定 fix 时，亲自走了一遍 dashboard 页面（"我在前台"），发现账号绑定页两种设备的绑定方式混在一起看不出区别，追问后发现更深层问题：这个项目从来没有过真正驱动浏览器点击的 Path2 E2E 测试，之前所有"E2E已跑通"的验证都只到 API/curl 层，没有验证客户实际会用的网页交互路径。

## 关联上下文
- 相关 PR：#1404（音频转写判定三缺口修复）+ #1407（body限制修复）——今天真机验证这两个 PR 的成果时发现的衍生缺口
- 相关历史决策：8dbe91ee（机器管理页/账号管理页设备类型 UI 区分历史教训，本次是同类问题在账号绑定"操作流程"层面的 recurrence，不是"展示"层面）
- 已登记后续任务：decision 5c570680（CI 缺两道机器闸门，本次不做，另开 sprint）

## 影响范围
- `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`：只拆分"绑定新小号"区块的展示，不改任何 API 调用逻辑，不影响已绑定小号列表/健康状态渲染
- 新增一个 Playwright spec 文件，不改动任何生产代码路径之外的行为
- 不涉及后端改动

## 验收标准
- [ ] `acquisition-tasks-collect-start.spec.ts` 新增，真实驱动 Playwright 点击"开始采集"按钮，断言调用了正确的 API + body
- [ ] `AcquisitionAccountsPage.tsx` 绑定区块拆成 Android/Windows 两个并列小节，Windows 保留原有 Chrome 扫码流程，Android 只有说明文字无按钮
- [ ] 现有 `acquisition-config.spec.ts`/`acquisition-ia-redesign.spec.ts` 等既有 Playwright spec 无回归
- [ ] CI 全绿（含 windows-latest Playwright job）
