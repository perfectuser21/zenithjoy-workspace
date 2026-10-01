# Contract DoD — devalue 安全依赖

- [ ] 实际devalue与lock同5.9.3；tarball/integrity与npm官方dist逐字节一致；Astro范围不变、无新增直接依赖。
- [ ] 永久同fixture RED9中3pass6fail；核心GREEN9/9，追加bootstrap3/3，合计12/12；普通TypedArray保兼容。
- [ ] Buffer单与嵌套共享池真实序列化无池外字节；实际npm audit及原global gate通过。
- [ ] CI缺包才正规根npm ci，已有不重建、安装失败拒绝；90秒/25分钟/全量门禁不变。
- [ ] 正式Controller seal/native与完整CI验收分别记录，正常PR合并后独立依赖消费。
