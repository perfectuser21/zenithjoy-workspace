# 小改动 PrepPRD：修复 CI 四个反模式（虚假绿根治）

## 改什么
1. `.github/workflows/ci-l3-code.yml:205`：`npm audit --audit-level=moderate --omit=dev` 去掉 `--omit=dev`（当前藏住 6 个 high）
2. 根目录 `npm audit fix`：清 7 个漏洞（astro/miniflare/multer/undici/wrangler/ws 均 fixAvailable，随本 PR 提交 package-lock）
3. `.github/workflows/ci-l3-code.yml:81/147`：eslint `--max-warnings 79/40` 压到实际警告数（棘轮制：先量当前真实值，取实际数为上限，禁止再涨；后续 sprint 逐步压到 ≤20）
4. dashboard vitest 补 coverage thresholds（api 已有 65 门禁；dashboard 量当前覆盖率后取 floor 为门禁，棘轮制）
5. `.github/workflows/ci-l1-process.yml`：`on:` 补 `push: branches: [main]`

## 为什么改
2026-07-05 repo-audit 判定 CI 虚假绿（命中 4 反模式）：audit 被 --omit=dev 藏漏洞、覆盖率无门禁可跌、警告上限 79 形同虚设、L1 不看 push。CI 绿不可信 = 所有下游信任打折。

## 关联上下文
- 相关 Journey：dev_pipeline（CI/CD）
- 相关历史决策：无命中（decisions/match 空）

## 影响范围
仅 CI 配置 + package-lock + dashboard vitest config；不改业务代码。风险：audit fix 可能 bump 依赖 minor 版本——依赖 CI 全量测试兜底。

## 验收标准
- [ ] bash <repo-audit>/scripts/check-ci.sh 反模式命中从 4 降到 0（或仅剩棘轮值 >20 的 lint_too_lenient 一项，且有棘轮注释）
- [ ] npm audit（根目录、不带 --omit=dev）0 high
- [ ] CI 全绿
