# Handoff：业务线健康部署版本改用真实 apps/api /version（含真机容器 DNS 修复）

- task_id: unknown（交互式 /dev 路径B+路径A，本次未先注册 Brain task）
- journey_id: e675da0f-1117-4301-a801-cd4753beb8c8（line04/智能客服；同时影响 line01/line02 同一总览卡片组件）
- decision_ref: 5d264392-43af-45ac-ba74-6c30917b1537（改用/version）、e35ae44c-0725-4b2e-8e08-bf4566f468f1（容器DNS bug）
- verdict: PASS
- created_at: 2026-07-29T12:52:28.000Z

## 完成
- PR #1550 已合并：用户看到 #1548 的"三环境版本"实际展示后反馈"看不太清楚,为什么有三个environment"。
  排查发现 #1548 的三环境本身仍是不可靠推断（develop 分支从未部署过、release/cs-stable 与真实 staging
  部署无关、production 曾错误对应 main HEAD）。改用 apps/api 自带 /version 端点（build-info.ts）直接
  问"正在跑的进程是哪个 commit"，staging/production 作为三条线共享摘要在总览页顶部展示一次，详情页部署
  tab 同步改为 staging/production 两档
- PR #1551 已合并：#1550 部署后真机 curl 验证发现 bug——production.sha 显示的其实是刚部署到 staging 的
  sha。根因是 hk-vps 上 zenithjoy-api-staging/zenithjoy-api-prod 是 zenithjoy-net 桥接网络两个独立容器，
  网络命名空间隔离，"localhost" 从容器内部发出只指向自己，够不着兄弟容器（两容器内部都用 PORT=5200
  监听）。改用 Docker 内置 DNS 按容器名跨容器互访（zenithjoy-api-staging:5200/zenithjoy-api-prod:5200），
  默认值导出常量 + 回归测试钉死不许退回 localhost
- 两个 PR 均完整走过：TDD 覆盖（line-health.test.ts 26 条）→ typecheck/lint 通过 → 全量套件通过 →
  CI 全绿自动合并 → 部署后真实 curl 验证。#1551 这个 bug 本身就是靠"合并后必须真实验证"这条纪律现场
  抓到的（本地/CI mock 测不出容器网络拓扑差异）
- 最终真机验证结果：staging.sha 正确显示刚部署的版本，production.sha 正确显示独立、滞后的真实生产版本

## 未完成
- 无（本次范围内的部署版本展示改造已完整交付，且经过真实容器网络环境验证）

## 下一步
- 完成，无下一步

## 数据源
- apps/api/src/services/line-health.ts（`fetchDeploymentSummary`/`fetchLiveVersion`/
  `resolveVersionUrl`/`DEFAULT_STAGING_VERSION_URL`/`DEFAULT_PROD_VERSION_URL`）
- apps/staff-hub/src/pages/LineHealthPage.tsx（`renderDeploymentSummary`）、
  LineHealthDetailPage.tsx（staging/production 两档展示）
- decisions 表 id 5d264392-43af-45ac-ba74-6c30917b1537 / e35ae44c-0725-4b2e-8e08-bf4566f468f1

## 产物
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1550
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1551
- 分支: cp-07291955-line-health-real-deployment-version / cp-07292036-line-health-version-url-container-dns
