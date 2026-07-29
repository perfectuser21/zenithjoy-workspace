# Handoff：业务线健康总览卡片去掉smoke匹配，改成三环境版本+待发布变更清单

- task_id: unknown（交互式 /dev 路径B，本次未先注册 Brain task）
- journey_id: e675da0f-1117-4301-a801-cd4753beb8c8（line04/智能客服；同时影响 line01/line02 同一总览卡片组件）
- decision_ref: 9310668c-1730-4b2d-9e47-3b7c9c867870
- verdict: PASS
- created_at: 2026-07-29T11:35:04.000Z

## 完成
- PR #1548 已合并：业务线健康（GP3/line_health）总览卡片彻底移除不可靠的 smoke 状态展示
- 根因说明留档：golden-path-1-smoke.sh 跑在名字用空格分隔的「Walking Skeleton #1 — Golden Path 1 Douyin」workflow 里（hint 用连字符永远匹配不上）；golden-path-2-smoke.sh 是嵌进完全不相关的「L4 E2E Smoke」workflow 内部的一个 step，GitHub Actions API 结构性看不到 step 名字——这不是能靠改 hint 修好的 bug，是展示方式本身选错了数据源
- 改用用户明确要的信息：`line-health.ts` 新增 `fetchPendingChanges()`（按 lineKey 独立缓存 `versionSummaryCache`，Map 而非单槽，避免总览页遍历三条线互相驱逐）；`LineHealthPage.tsx` 卡片直接展开 `dev/staging/prod` 三环境 commit 版本行 + "staging 比 production 多 N 个提交"变更清单
- `availability` 语义收窄：只反映 Brain 连通性是否出错，GitHub 侧数据抓取问题不再算 degraded（此前 smoke 没匹配上就误报"数据暂不可达"）
- 验证链路：apps/api + apps/staff-hub typecheck 通过；目标测试 52 条 + 全量 apps/api 套件 1905 passed + staff-hub 套件全绿；起真实本地进程 curl 真实 `/api/staff/line-health` 确认三条线均 ready 且带真实 commit sha；真实 Playwright E2E 通过 + 截图人工确认卡片视觉效果；PR CI 全绿后 auto-merge 落地

## 未完成
- 无（本次范围内的展示改造已完整交付）

## 下一步
- 完成，无下一步。若后续 line01/line02 出现真实 pending_changes（目前恰好为空），建议部署后人工看一眼变更清单渲染是否符合预期（非阻断，纯锦上添花）

## 数据源
- apps/api/src/services/line-health.ts（`fetchLineVersionSummary`/`fetchPendingChanges`/`versionSummaryCache`）
- apps/staff-hub/src/pages/LineHealthPage.tsx（`renderVersionRow`/`renderPendingChanges`）
- decisions 表 id 9310668c-1730-4b2d-9e47-3b7c9c867870

## 产物
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1548
- 分支: cp-07291750-line-health-version-changelog
