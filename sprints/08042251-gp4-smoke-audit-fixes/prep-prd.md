# 小改动 PrepPRD：gp4 智能客服 golden-path-4-smoke 审计五刀修复

## 改什么
1. `golden-path-4-smoke.sh` + `golden-path-4-smoke.yml`：可达性探测在 `CI=true` 时不允许静默 SKIP——DB/API 不可达必须 fail，不能整段跳过还打印 PASS。
2. 新增/复用 CI job 真跑 `apps/agent-panel` 的 vitest（业务语言正向 + 内部代号泄露负向断言），挂进 gp4 相关 workflow，替换 Step 17d 现在的"CI 独立 job 已跑"假托辞。
3. `golden-path-4-smoke.sh` Step 9：PUT/GET cs/config 补 `takeover_mode`/`blacklist` 字段的写入+回读断言（§1.9 事故 PR#1146 同型回归守卫）。
4. `golden-path-4-smoke.sh` Step 12：补阳性对照——A 租户写入后，A 自己能读到（不能只测 B 读不到 A）。
5. `golden-path-4-smoke.yml` 的 `golden-path-4-smoke` job 显式 `npm ci --workspace=services/agent`（去掉对字母序更靠前的兄弟 smoke 脚本"顺手装依赖"的隐式耦合）；`product-map/product-map.yaml` 给现役六条智能客服 GP（`cs_shared_binding`/`active_voice_outreach`/`passive_reception`/`moments_publish`/`business_report`/`moments_interaction`/`group_operation`）补 `smoke_files` 字段，指向已存在的对应 smoke（找不到对应 smoke 的 GP 如实留空/标注，不假挂）。

## 为什么改
2026-08-04 连夜审计（memory `handoff_0804_gp4_smoke_audit_16_findings.md`）发现 gp4 smoke 存在"看似全绿但没真跑"的结构性缺口：专属 workflow 不起 DB/API 导致关键步骤整体 SKIP 仍报 PASS；Step 17d 引用的 CI job 实际不存在；Step 9/12 对已发生过的事故类型（§1.9 全接管失效）和基本正确性（阳性对照）缺守卫；Step 17c/17e 靠隐式依赖顺序才能跑。这些是 CI 可信度问题，用户已拍板要修。

## 关联上下文
- 相关 Journey：智能客服（line04），六条现役 GP（journey_features: 55d26529/6df5b884/8fe9ed6b/b6a73832/3ae2414e/016459f9/ac2e35bc）
- 相关历史决策：无直接匹配（decisions/match 空）
- 相关 PR（不重叠，未撞车）：#1194（07-09 开，line02-keyword-comment 相关，stale，"假绿灯治理第一刀"说明文字已在 main）

## 影响范围
- `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`（Step 1/7/8/9/12/13/14 可达性分支 + Step 9/12 新断言）
- `.github/workflows/golden-path-4-smoke.yml`（新增/调整 job）
- `product-map/product-map.yaml` + `npm run product-map:generate` 后的 `product-map/generated/*`
- 不影响生产运行时代码，只影响 CI/测试基建

## 验收标准
- [ ] `golden-path-4-smoke.sh` 在 CI=true 且 DB/API 不可达时 exit 非 0（可用本地故意断 DB 验证一次）
- [ ] apps/agent-panel vitest 在某个 gp4 相关 workflow 里真实执行且结果影响 job 成败（非跳过）
- [ ] Step 9 断言覆盖 takeover_mode + blacklist 回读，故意漏字段能验证其会报红
- [ ] Step 12 新增阳性断言：A 写入后 A 读到（可通过临时改错代码验证会报红）
- [ ] gp4 workflow 不再隐式依赖兄弟脚本安装 services/agent 依赖
- [ ] product-map:check 通过，六条现役 GP 的 smoke_files 字段更新
- [ ] CI 全绿（Smoke Glob Gate / golden-path-4-smoke 两条跑道）
