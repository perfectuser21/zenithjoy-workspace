# 微信联系人首次登记运行件

Task: f99a43d1-7e85-47cc-a72a-9de99fbaef4e
Parent: e3db3a75-f9fd-48d7-8ed6-d25f77ff898c
GP-Anchor: line04/cs_shared_binding keep-green

目标：将同次云手机观察登记为默认待分类的私有个人/群渠道收件箱，提供人工确认回路与采集资格门禁。没有账号和登录证据不得写入联系人。

- [x] [BEHAVIOR] 缺登录或证据、空结果未验证、虚假全量声明必须拒绝；测试不将退出码代替实际云手机验收。
  Test: python3 -m unittest discover -s services/wechat-contact-inventory/tests -v
- [x] [BEHAVIOR] 同名未知身份不误并，同账号迁机保留人工决策，不同账号/组织隔离。
  Test: python3 -m unittest discover -s services/wechat-contact-inventory/tests -v
- [x] [BEHAVIOR] 人工快照按账号、批次、修订事务检查，冲突全批回滚；撤销有审计。
  Test: python3 -m unittest discover -s services/wechat-contact-inventory/tests -v
- [x] [BEHAVIOR] 群支持多客户关联；只有已确认且稳定身份已核验且显式开启的客户渠道可通过本地资格门禁；绝不开启自动回复。
  Test: python3 -m unittest discover -s services/wechat-contact-inventory/tests -v

范围限制：本候选不直接打开手机，不发送消息，不写生产 CRM/Notion，不提供虚假全量或生产部署结论。真实云手机登录页阻塞由父 workflow 记录，不由夹具通过覆盖。
