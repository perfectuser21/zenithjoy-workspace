# 修复巡查失败原因丢失

GP-Anchor: none(infra)

已授权当前Codex直接修复Issue2b2ef1fa。保留同任务/Run/设备/版本错误，从SSH/ADB自检经补查及Brain至Notion。旧历史不伪造原因，不改重试与锁。

## 测试策略
先以远端非零、超时、自检失败JSON、秘密脱敏及跨attempt回执失败测试复现，再修实现；Brain端独立测试提取/结算/正文投影。对错误路径使用隔离fixture，不断开生产手机。发布按正式流水线；未正式页面读回不得称端到端完成。

## 验收
- 失败仍非零，成功/延后原有语义保持。
- 自检ADB不可达有具体证据，SSH255不猜ADB。
- stderr/stdout脱敏限长，超时部分日志保留。
- 当前task/Run/设备/来源严格一致才透传错误。
- 新release不可变且全量验签，旧版本不覆盖。
- Run与Workflow正文显示阶段、原因和证据，真实Notion读回。
