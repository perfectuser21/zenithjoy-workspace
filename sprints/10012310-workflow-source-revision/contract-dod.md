# DoD — 获客回执来源

- [x] [BEHAVIOR] 真实 Git 来源三面一致；错仓库/路径/hash/revision 及不可核执行 inode 保留 null/unknown。
  Test: manual:bash .github/workflows/scripts/smoke/workflow-source-revision-smoke.sh
- [x] [BEHAVIOR] 正常工件、Brain回执、spans及既有漂移语义不退化。
  Test: manual:bash -c "node --test services/phone-adb-controller/__tests__/workflow-result.test.mjs services/phone-adb-controller/__tests__/workflow-result-span.test.mjs services/phone-adb-controller/__tests__/drift-check.test.mjs"

完整CI、native、Judge、正规部署及新批验收证据记录于 Brain；本文件不宣布生产验收通过。
