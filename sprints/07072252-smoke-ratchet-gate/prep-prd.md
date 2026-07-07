# 小改动 PrepPRD：smoke glob runner 从 report-only 升为 PASS 基线棘轮闸

## 改什么
1. `.github/workflows/ci-smoke-glob-runner.yml`：
   - 去掉 job 级 `continue-on-error: true`
   - 跑全部 smoke 后按基线判定：基线内 FAIL → job 红；基线外 FAIL → 仅 warning annotation（存量债）
   - 基线内脚本文件不存在 → job 红（防删脚本绕闸）
   - 新增聚合 job `Smoke Glob Gate Passed`（required check 稳定锚点）
2. 新增 `.github/workflows/scripts/smoke-baseline.txt`：以 2026-07-07 run 28861827802 实际 PASS 的 56 个脚本为初始基线
3. 新增 lint（进 L1 或 runner 内）：
   - PR 新增的 `*-smoke.sh` 必须同时加进 baseline（新债不欠）
   - baseline 删行必须 PR body 含 `BASELINE-REMOVE:` 理由，否则红
4. 产出存量 144 个 FAIL 的分类报告 `docs/smoke-debt-report.md`（环境类：API 不可达/got 000 → 候选 DENYLIST 或 CI 内起服务；业务断言类 → 真 drift 待修），只分类不修
5. merge 后：`Smoke Glob Gate Passed` 加进 main branch protection required checks（gh api）

## 为什么改
2026-07-07 报告 TOTAL=200 PASS=56 FAIL=144：smoke 是每个 sprint 合同 [BEHAVIOR] 断言的沉淀物，但 merge 后无人再跑，144 个已漂移。棘轮 = 锁住现有 56 个不许再坏 + 新脚本必须过 + 存量分批清偿。

## 关联上下文
- Brain task: 735a910d-c4ed-4e45-9d55-511aa258e8a0（journey: ZenithJoy 运营中枢 Line 00）
- 前情: ci-smoke-glob-runner.yml 头注释自承 "稳定后再 ratchet 成必跑闸（下一步，非本 PR）"——本 PR 就是那个下一步
- 相关 memory: feedback_smoke_must_wire_into_ci（smoke merge≠CI跑）

## 影响范围
- 只影响 CI 判定，不改任何业务代码
- 基线内 56 个脚本若有 flaky 会卡 PR（初版不加重试，观察一周再定）
- 全量跑一遍约 4 分钟（昨晚实测），在 25min timeout 内

## 验收标准
- [ ] 测试分支故意弄坏基线内 1 个 smoke → CI 红（proven-to-fire）
- [ ] 基线外 FAIL 不阻塞（当前 main 直接跑必须绿）
- [ ] PR 新增 smoke 不加 baseline → lint 红
- [ ] docs/smoke-debt-report.md 144 条全分类
- [ ] CI 全绿 + merge 后 required checks 含 Smoke Glob Gate Passed
