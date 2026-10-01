# Contract — 获客回执来源

任务：fa58ae89-c080-40a3-acf0-2e25f47f5d47。target_environment: local_api。journey_type: dev_pipeline。

## 批准范围

仅 workflow-result.sh、独立 workflow-source.mjs、既有 deploy.sh 和 drift-check.sh，以及永久回归和合同执行工件。正规部署从 clean DEPLOY_SHA 的 producer Git 对象生成来源清单，核正规仓库与 main 祖先关系；按实际用户 ~/bin-harvest 路径原子下发，manifest 最后发布并读回核验。漂移守卫回到来源 Git 对象验证。生产批在途时不得部署。

每份活动工件固化来源，Brain callback 和 spans 原样传播。脚本执行 inode 与 manifest 必须匹配，source 嵌套或 FD 不可核时不冒认 caller。缺文件、错误仓库、路径、hash、非法 revision 均 null/unknown。无 schema、网络、设备行为及旧批数据修改，不干扰 PR2058。

## E2E 验收（target_environment: local_api）

```bash
set -euo pipefail
npm run product-map:check
bash .github/workflows/scripts/smoke/workflow-source-revision-smoke.sh
node --test services/phone-adb-controller/__tests__/workflow-result.test.mjs services/phone-adb-controller/__tests__/workflow-result-span.test.mjs services/phone-adb-controller/__tests__/drift-check.test.mjs
```

通过标准：真实 Git 夹具来源三面相同；错源、不明源及执行 inode 竞态保留 null；clean revision/producer Git 对象/漂移校验；原回执及 span 语义回归全过。正式 native evaluator/Judge/完整CI/正规部署与全新批数据库读回证据另外回写 Brain，不以本地测试冒充真实获客通过。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| 原生入口 | `sprints/10012310-workflow-source-revision/tests/source-revision.test.mjs` | `native entry verifies producer source and existing receipts` | 原 producer 三面 source_sha 全缺，永久 smoke 首次 0pass/6fail，exit1 |
