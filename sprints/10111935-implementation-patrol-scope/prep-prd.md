# Bug PrepPRD：巡查影响门禁误接全仓获客改动

GP-Anchor: none(config)

## 任务与症状
根任务713e4691-6fb1-444c-9e1a-bd5a8cea28b7。067ce31c发布的获客源码被固定cecelia-device-patrol专用门禁拒绝，首条PATROL_CHANGED_FILE_UNCLAIMED是共享smoke配置。

## 修法
保留所有PR/main事件及永久caller-contract。用固定base/head Git字节读取巡查implementation-contract.json真身，base/head绑定和辅助路径取并集，合同/巡查专属CI或未知巡查目录变更触发原完整diff门禁。合同坏、身份漂移、Git读取异常都失败；无巡查变化只输出not_applicable，不发PASS receipt。共享smoke巡查消费者另做真实隔离执行守卫，不因获客预算改动就冒认巡查来源。

## 判定点
注册身份从已登记引入提交f0923e5396bade1986ba5452e766cabb5f4a30b3的固定合同读取，不复制路径归属表；纯获客不覆盖巡查范围，混合变更保留原failclosed。

## 验收
- 真Git差异下纯获客、共享预算调整明确N/A；无PASS产物。
- 真Git差异下巡查/删除/改绑定/专属CI/混合变更触发完整差异。
- 缺坏合同、身份漂移、异常来源不得N/A。
- 共享baseline移除巡查、deny或吞掉巡查失败，隔离消费者守卫必须真实报红。
- 首次RED提交后GREEN；本阶段只本地提交，不push/PR/merge/部署/手机。
