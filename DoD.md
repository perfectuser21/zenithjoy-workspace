# 联合验收
Task: 8763450e-3335-4da9-a9bb-352db3d27bf9
GP-Anchor: line02/keyword_acquisition keep-green

- [ ] 正式Gateway无工具判读保同控制owner/low/60秒和外65秒，nonce+真实terminalReceipt先核后returned，错误/accepted/timeout/signal与伪身份保pending。
  Test: manual:node --test services/phone-adb-controller/__tests__/commander-model-only.test.mjs services/phone-adb-controller/__tests__/commander-model-receipt.test.mjs services/phone-adb-controller/__tests__/commander-owner-reservation.test.mjs
- [ ] 显式schema2尝试配额与displayed分离，旧schema1严格上限及默认行为保持；正式冻结、CLI、进度和受管cleanup边界永久回归。
  Test: manual:node --test services/phone-adb-controller/__tests__/discovery-attempt-quota.test.mjs services/phone-adb-controller/__tests__/discovery-cleanup-scope.test.mjs
- [ ] 真实中央3cd固定源、业务合同与生成物同源，联合方法摘要及五版头相对共同main合法，无手机/业务或生产写。
  Test: manual:node scripts/product-map/cli.mjs check

原09bFAILED保留，876续接；modelRun单次实测为embedded/OpenClaw无工具纯判读，不使用原Codex线程或durable历史，不声明历史timeout底因已修。官方完整CI和候选安装需新联合头另验。
