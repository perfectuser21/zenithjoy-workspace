# 验收

- [ ] [BEHAVIOR] actual attempt4在正式恢复授权及独立当前system/config观察齐全时可归属新服务；无ref及所有漂移仍BLOCK。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-adb-recovery.test.mjs
- [ ] [BEHAVIOR] 既有domain/authority/effects保护保持，其他晚启动root不可利用ADB例外。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-domain.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-authority.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-effects.test.mjs
- [ ] [BEHAVIOR] 正常PR完整CI、RPA独审、真实双机隔离候选交付；不代维护或102/103成功。
  Test: manual:node --test services/phone-adb-controller/__tests__/deployment-write-set.test.mjs
