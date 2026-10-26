# 验收
Task: 09b9547d-f3f1-47d2-b8db-43013b046b65
GP-Anchor: line02/keyword_acquisition keep-green

- [ ] 正式Gateway无工具请求实际传递modelRun=true/同owner/low/原预算与expect-final，仅一次调用。
  Test: manual:node --test services/phone-adb-controller/__tests__/commander-model-only.test.mjs
- [ ] 真实handler封套成功/accepted/error/timeout/signal和错身份均保原解析及unknown/pending，不重试、不漏诊断正文。
  Test: manual:node --test services/phone-adb-controller/__tests__/commander-model-only.test.mjs services/phone-adb-controller/__tests__/commander-model-receipt.test.mjs services/phone-adb-controller/__tests__/commander-owner-reservation.test.mjs
