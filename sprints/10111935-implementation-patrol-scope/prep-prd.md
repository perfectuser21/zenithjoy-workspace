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

## 真实验证与独立审查
- 原守卫RED：17测试、0pass/17fail、exit1，提交c83e9295。
- 独立审查发现paths-ignore绕过：两新守卫先RED 0/2、exit1，随后修复。
- 最终三个正式caller测试文件合跑：30/30 PASS、0fail，exit0。
- 原067真实Git差异（03d4→067，17文件）CLI：exit0/not_applicable，完整changed_files保留，没有verdict或receipt。
- 合同注册字节SHA256：eea0f1aaa5a3ec60decd3cdf30360fb4789aafd3aec9a62b00dcd62fe89e2437；base/head合同字节均a4588ff2a07e206545113e544d1e7390bc608b03c10f98ab6e041f50a046e68b。
- product-map:check与git diff --check通过。尚未运行远端CI，尚未push、开PR或合并。

## 范围边界
共享glob/baseline属于开发治理，不冒认巡查来源。真实隔离消费者要求巡查成功执行且失败阻断，禁止paths/paths-ignore、job/执行step条件与continue-on-error；独立Pilot caller也执行永久legacy caller协议验证。巡查专属CI、合同、注册bindings/auxiliary或未登记巡查目录变更才交原完整diff门禁；混合未声明文件仍由原受信门禁拒绝。
