# 验收标准

- [ ] [BEHAVIOR] 缺正式OpsTask的维护入口结构化拒绝；真实353资格上传失败字节可解析，其他分支不被冒充。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-entry.test.mjs
- [ ] [BEHAVIOR] 原native observed_only/UNKNOWN原件只读保持，不因观察到PID缺席转成全停。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-entry.test.mjs
- [ ] [BEHAVIOR] 维护范围来自真实OpsTask与原owner委托，观察不完备只BLOCK；不得借开发Task或任意JSON恢复。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-entry.test.mjs
