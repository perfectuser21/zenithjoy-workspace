# 验收
Task: 1ec5bba4-3aea-4b79-a49c-3eb43c11901d
GP-Anchor: line02/keyword_acquisition keep-green

- [ ] 正常剩余616秒可按真实phase执行下一候选；预算定义与checked参数一致。
  Test: manual:node --test services/phone-adb-controller/__tests__/discovery-phase-budget.test.mjs
- [ ] 续锁/重定位耗时后tap尾部不足不得点击；原未知/真正截止/其它workflow限时保持。
  Test: manual:node --test services/phone-adb-controller/__tests__/discovery-cleanup-scope.test.mjs services/phone-adb-controller/__tests__/phone-actions-in-lock.test.mjs
