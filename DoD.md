# 验收标准

- [ ] [BEHAVIOR] 缺正式OpsTask的维护入口结构化拒绝；真实353资格上传失败字节可解析，其他分支不被冒充。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-entry.test.mjs
- [ ] [BEHAVIOR] 原native observed_only/UNKNOWN原件只读保持，不因观察到PID缺席转成全停。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-entry.test.mjs
- [ ] [BEHAVIOR] 维护范围来自独立OpsTask与原owner委托，包含稳定claim epoch；显式资源合同冲突、自委托和身份漂移拒绝。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-authority.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-brain.test.mjs
- [ ] [BEHAVIOR] 完整冻结文件、ACK、原native/事件、原公司metadata与资格失败分支核实，保留UNKNOWN；不把新JSON或单条日志当证明。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-original.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-beforejudge.test.mjs
- [ ] [BEHAVIOR] 两机原执行域、脱组/出生变化、设备capture及原恢复音频、Commander无pending/children均受核验；未知不进入业务变更。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-processes.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-domain.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-mmv.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-device.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-commander.test.mjs
- [ ] [BEHAVIOR] 真实guard继承FD不死锁、生产清除fixture/执行器残留；候选双机实际字节和六GET独立准入，readback不写。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-guard.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-transport.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-candidate.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-bytes.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-runtime.test.mjs
- [ ] [BEHAVIOR] 正式DB身份绑定同backend；历史政策hash、只改两字段、旁manual整行不变、真实提交前后断连/CAS竞态均验证。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-database.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-pg.test.mjs
- [ ] [BEHAVIOR] durable intent/receipt/chunks保持未知，提交不重放、部分释放可读回；已sealed分支纯读且出口非假绿。
  Test: manual:node --test services/phone-adb-controller/__tests__/qualification-maintenance-journal.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-close.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-proof.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-effects.test.mjs services/phone-adb-controller/__tests__/qualification-maintenance-service.test.mjs

PG两组必须在现有L3 required PG scratch环境下真正运行（ZJ_METRICS_PG_REQUIRED=1），不得以未设置环境后的skip计为验收；正式PR需读取真实分片TAP。单测与开发诊断不代替隔离候选准入或真实维护Ops结果。
