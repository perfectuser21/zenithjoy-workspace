# Staff Hub 验收模块（前端）设计

> 业务背景/Golden Path/判定点见 cecelia 仓库 `docs/superpowers/specs/2026-07-31-staff-hub-acceptance-prep-prd.md`（PR #4516 已合并，Brain 侧内网端点已上线生产 v1.267.156）。本文档聚焦 zenithjoy-workspace 这一侧的前端+代理层设计。

## 背景

Brain（美国机，Tailscale 100.71.151.105:5221）新增三个内网 acceptance 端点：
- `GET /api/brain/acceptance/pending` — 团队共享待验收清单（含每个 run 的判定项）
- `GET /api/brain/acceptance/runs?gp_id=` — 按 GP 查历史 run（按 created_at 倒序）
- `POST /api/brain/acceptance/results` — 提交判定项结果（任意子集，增量提交，字段：`check_key/result/note/submitted_by`）

Staff Hub（香港 VPS）需要新增"验收"模块，通过 `apps/api` 反代这三个端点（复用 `CECELIA_BRAIN_URL` 既有模式），前端渲染矩阵总览+按 Step 分组答题+历史查询。

## 架构决策

1. **反代层复用 line-health 模式**：`apps/api/src/services/acceptance.ts` 里用 `axios.get/post` 调 `CECELIA_BRAIN_BASE()/api/brain/acceptance/*`，读路径（pending/history）失败时降级返回 `degraded` 态（HTTP 仍 200，参照 `line-health.ts` 的三态模型：`ready`/`degraded`/`not_connected`——此处永远是 `ready`/`degraded` 二态，不存在 `not_connected`）；写路径（submit results）失败必须让错误冒泡为非 200，不能伪装成功（呼应 Brain 侧 PR 里"读路径可降级、写路径必须明确失败"的判定点）。
2. **路由挂 `apps/api/src/routes/staff.ts`**，跟 line-health 一样不新建独立路由文件（沿用现有文件的组织惯例，除非未来体量增长再拆）。
3. **身份/留痕**：提交时把当前登录用户（`req headers X-User-Email`/`X-Feishu-User-Id`，staffGuard 已解析过白名单）透传为 `submitted_by` 写入 Brain，仅做留痕不做权限拦截（团队共享池模式，任意员工可填任意判定项——这是用户已拍板的判定点）。
4. **矩阵+分组渲染**：判定项按 `kind`（FR/NFR/Invariant/SOP）×前端从 `check_key`/`name` 推断的 Step 分组（Brain checks 暂无独立 step 字段，v1 用判定项 name 里的 "Step N" 前缀文本分组——如果不含该前缀就归入"未分组"，这是本次范围内的简化，未来如需结构化 step 字段需回到 Brain 侧加列，本次不做）。
5. **工作卡**：读 `check.detail` JSONB 字段（`{op, exp, pass, fail}`），点击行展开显示；`detail` 为空时不显示展开箭头。
6. **草稿态**：前端本地 state 暂存未提交的选择（不落 localStorage——v1 简化为纯内存 state，跨刷新不保留草稿，这是本次范围内的简化；如需保留草稿是后续加厚项，不阻塞本次上线）。
7. **提交语义**：允许只提交部分已填写的判定项（"全部提交"按钮收集所有本地已选择结果的行一次性 POST；未选择的行不会被提交，不强制"全部填完才能交"）。

## 页面结构

- `AcceptancePage.tsx`（`/acceptance`）— 列表页：拉 `GET /api/staff/acceptance/pending`，展示待验收 run 列表（标题/GP/状态/判定项完成度），点击进详情。首页导航角标显示 `pending.length` 或判定项待处理总数。
- `AcceptanceDetailPage.tsx`（`/acceptance/:runKey`）— 矩阵总览（横 FR/NFR/Invariant/SOP，纵 Step 分组，格子=完成度）+ 下方按 Step 分组的答题列表（每行：标题/设备标签/结果下拉/意见输入/工作卡展开箭头）+ 提交按钮。
- `AcceptanceHistoryPage.tsx`（`/acceptance-history`）— 选择 GP → 拉 `GET /api/staff/acceptance/history?gp_id=` → 列出历史 run（按时间倒序）→ 点击展开看该次判定项结果+意见。

## 不包含（本次范围外）

- 结构化 Step 字段（v1 用判定项标题文本前缀推断分组）
- 本地草稿持久化（刷新丢失未提交的选择，v1 接受）
- 飞书推送通知新验收单（角标已够用，用户已拍板）
- 按人分配/归属校验（团队共享池模式）

## 测试策略

- 单元测试：`apps/api/src/services/__tests__/acceptance.test.ts`（mock axios，覆盖 ready/degraded 两态 + 写路径失败冒泡）
- 前端组件测试：矩阵分组计算逻辑（纯函数，抽出来测）
- E2E：`apps/staff-hub/e2e/acceptance.spec.ts`，真实后端，Golden Path 全覆盖（列表→详情→矩阵→答题→提交→历史），降级路径当合法路径（Brain 不可达时页面仍渲染出 degraded 提示）
- Windows CI：`e2e-staff-acceptance-windows.yml`（照抄 `e2e-staff-line-health-windows.yml` 结构，`e2e-windows` job 必须 `runs-on: windows-latest`）
- Smoke：`staff-acceptance-smoke.sh` + 登记进 `.github/workflows/scripts/smoke-baseline.txt`
