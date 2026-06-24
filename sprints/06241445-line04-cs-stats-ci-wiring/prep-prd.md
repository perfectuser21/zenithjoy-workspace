# 小改动 PrepPRD：S3/S4 客服统计 smoke + Playwright spec 接进 CI（让它们真跑）

## 改什么
S3（客服工作汇总）+ S4（客服日报）的验收脚本之前 merge 进 main 了，但**没接进任何 CI workflow**——CI 逐个点名跑 smoke/spec，不是 glob，所以它们从没在 CI 真执行过（只本地真 Postgres 跑过）。本次接线：
1. `cs-work-stats-smoke.sh` / `cs-daily-report-smoke.sh` → 接进 `.github/workflows/ci-l4-e2e-smoke.yml` 的 `smoke-api-contract` job（复用其 cecelia 库 + localhost:5200 API，对照 line04-feishu-customer-list / customer-admin-backend 的接法：chmod +x + bash 点名跑）。
2. `cs-work-stats.spec.ts` / `cs-daily-report.spec.ts` → 新建 `.github/workflows/e2e-line04-cs-stats.yml` 的 windows job2，跑 `sprints/06241445-.../e2e-ui-verify.ps1`（对照 sprints/06220836-customer-admin-backend/e2e-verify.ps1：build dashboard 带 VITE_SKIP_AUTH=true → vite preview → playwright test，因两页是 requireAuth:true）。
3. 修 `cs-work-stats-smoke.sh` schema 断言：原正则跨全部 migration 文件扫 `cs_wechat_id...NOT NULL`，被 `daily_report.cs_wechat_id NOT NULL`（那是对的）误命中。改成只定位「给 wechat_messages 加 cs_wechat_id」那条 migration、只断言它的 ADD COLUMN 行 nullable。

## 为什么改
team-lead 指出缺口：merge ≠ 在 CI 跑。这次要确认它们**真执行并 pass**。

## 影响范围
只动 CI workflow + 一个 smoke 的 schema 正则。不动任何产品代码 / API / 前台页。

## 本地验证（真执行，已通过）
- `cs-work-stats-smoke.sh`：起真 apps/api(dist) + 真 Postgres(cecelia，migration 已建表) → RC=0，5 步全过（schema/口径3-2-2-20/隔离/北京00:30归今天/NULL不计入）。
- `cs-daily-report-smoke.sh`：RC=0，5 步全过（schema/固化3-2-2-20/幂等不翻倍/隔离/回看）。
- 两个 Playwright spec：build dashboard(VITE_SKIP_AUTH=true) → vite preview :5174 → `playwright test` → **3 passed**（真 chromium，与 windows job 同路径）。

## 验收标准
- [ ] CI 里 `Smoke — Line04 客服工作汇总 (Path 4 S3)` / `Smoke — Line04 客服日报 (Path 4 S4)` 两步真跑绿
- [ ] CI 里 `E2E Line04 CS Stats` 的 windows job2 真跑绿（2 个 spec 真执行 pass）
- [ ] required 全绿后合并
