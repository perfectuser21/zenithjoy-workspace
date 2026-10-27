# 非阻塞原生观察验收
Task: 58d08a78-4119-4117-bc98-12390bd988eb
GP-Anchor: line02/keyword_acquisition keep-green

- [ ] 真实controller/managed version、真实execInput/native receipt和Darwin producer/socket在受控慢observer下仍满足原2秒；快对照通过，永久RED先提交并纳正式Darwin CI。
  Test: manual:node --test services/phone-adb-controller/__tests__/native-operation-ipc.test.mjs
- [ ] single-flight/每PID去重、停止和信号原截止、晚到结果不可覆盖终态；真正未知、fork逃逸、signal、deadline仍保unknown，不假OS全停。
  Test: manual:node --test services/phone-adb-controller/__tests__/native-operation-receipt.test.mjs services/phone-adb-controller/__tests__/native-operation-budget.test.mjs services/phone-adb-controller/__tests__/native-operation-coverage.test.mjs
- [ ] 原leaf归还/业务成功、一次只读能力和完整method来源不变，方法校验12/14、版本及正式CI另验，不手机或业务写。
  Test: manual:node --test services/phone-adb-controller/__tests__/collection-leaf-returned.test.mjs services/phone-adb-controller/__tests__/collection-returned-authority.test.mjs

历史9c5b FAIL与2003ms底因UNKNOWN保留；结构回归为synthetic trigger，不冒历史根因或真机稳定性已修。端点/旧producer消费/新人工恢复权威另有实质边界，不绕guard。
