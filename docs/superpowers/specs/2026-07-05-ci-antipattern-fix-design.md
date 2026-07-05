# CI 四反模式修复设计（虚假绿根治）

来源：2026-07-05 repo-audit 判定 CI 虚假绿（4 反模式）。PrepPRD: sprints/07051957-ci-antipattern-fix。

## 实测基线（2026-07-05）
- dashboard eslint（ci-l3-code.yml:81, wd=apps/dashboard）：实际 78 warnings（上限 79）
- api eslint（ci-l3-code.yml:147, wd=apps/api）：实际 40 warnings（上限 40，贴线）
- dashboard coverage：st 54.91 / br 48.34 / fn 44.71 / ln 57.52，无 thresholds
- npm audit（根，含 dev）：7 漏洞=1 low+6 high；5 个可直接 fix（miniflare/multer/undici/wrangler/ws），astro+@astrojs/mdx 需 semver major（→7.x）

## 改动
1. **audit 反模式**：ci-l3-code.yml:205 去掉 `--omit=dev`，改调 `.github/workflows/scripts/audit-gate.sh`：npm audit --json（含 dev），任何 ≥high 且不在 allowlist 的漏洞 → 红。allowlist 仅 astro/@astrojs/mdx（附到期条件：astro 7 升级 PR 合并后必须清空 allowlist，脚本内注释 + 建 Issue 跟踪）。随 PR `npm audit fix` 清 5 个非 major，提交 package-lock。
2. **警告棘轮**：79→78（dashboard）；api 保持 40 并加棘轮注释（"实际=上限，只许降不许涨；目标 ≤20"）。不改业务代码消警告（改代码消 118 条警告另立 sprint）。
3. **coverage 门禁**：apps/dashboard/vitest.config.ts 加 coverage thresholds（st 54 / br 48 / fn 44 / ln 57，floor 棘轮），并确认 CI dashboard test job 带 --coverage（没有就补）。
4. **L1 覆盖 push**：ci-l1-process.yml `on:` 补 `push: branches: [main]`。

## 守卫（proven-to-fire）
- audit-gate.sh 本地演练一次假 allowlist 外 high（临时把 allowlist 清空跑一遍，看它对 astro 报红）→ 记录在 PR body。
- coverage thresholds 演练：临时把 lines 阈值调到 99 跑 vitest --coverage 看红一次。

## 不做
- astro/@astrojs/mdx major 升级（另立 sprint，含 astro 站点构建验证）
- 消 118 条 eslint warning（另立 sprint，目标 ≤20）

## 测试策略
- E2E/smoke：audit-gate.sh 即守卫脚本本身（CI 每 PR 跑）
- 验收：repo-audit check-ci.sh 反模式命中 4→1（仅剩 lint_too_lenient 棘轮值>20，带注释豁免）；npm audit 0 个 allowlist 外 high；CI 全绿
