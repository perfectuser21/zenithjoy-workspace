# 小改动 PrepPRD：工作机实时画面套手机外框

Brain task `90ed0bef-88dd-4828-b4c4-2f0ac592316a` · 路径 B · GP-Anchor: `line02/keyword_acquisition keep-green`

## 改什么

- 新增 `apps/dashboard/src/components/PhoneFrame.tsx`：纯 CSS 手机外框（深色机身、圆角、顶部灵动岛、左右侧键、屏幕区 9:19.5 等比），`children` 渲染在屏幕区内；`data-testid="phone-frame"`，屏幕区 `data-testid="phone-screen"`。
- `apps/dashboard/src/pages/WorkerLivePage.tsx` 左侧：用 `PhoneFrame` 包住 MJPEG `img` 与"画面不可用"遮罩，其余不动。
- `WorkersPage` 卡片不动。

## 为什么改

主理人 0920 反馈：实时画面只是一个黑矩形，要"一个 iPhone 的框"把画面框进去。

## 关联上下文

- 决策 e14297d4（控制塔第一刀，WorkerLivePage 来源）；PR #1884 刚把四台机房手机的画面推进来。
- 撞车检查：`gh pr list --search "PhoneFrame OR 手机外框 OR 实时画面"` 无 open PR。

## 影响范围

只改 dashboard 两个文件 + 两个测试文件。不改 API、不改协议。commit 类型 `style:`（纯样式，不触发 feat 的 smoke 闸）。

## 验收标准

- [ ] `PhoneFrame.test.tsx`：渲染 children、含灵动岛与屏幕区 testid（先红后绿）
- [ ] `WorkerLivePage.test.tsx` 补断言：实时画面 img 位于 `phone-screen` 内
- [ ] `npm test`（apps/dashboard vitest）全绿，`npm run typecheck`/lint 通过
- [ ] 合并后 staging `/dashboard/workers/<uuid>` 截图：外框可见、画面等比在屏幕区内
