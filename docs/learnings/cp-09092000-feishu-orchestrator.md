# 飞书版编排台 + 通用发布 rollup（line01 刀5b）（2026-09-09）

## 任务简述
飞书 Bitable 版发布编排台（镜像 Notion 版三方向）+ feishu-client（token 模块缓存/脱敏/单飞）+ 无锚作品通用 rollup sweeper（还刀5a P2-2/P2-3 债）+ 租户互斥。

### 下次预防
- [ ] 镜像另一个 SaaS 目标端时，最大错误面是值形态（Bitable 多选=字符串数组/单选=裸串/URL=对象/读回 segment 数组 vs Notion 的 {name}/{select}），必须写成合同级断言。
- [ ] token 换取失败路径与成功路径同等重要：axios reject 原始对象 config.data 含明文 secret——fetch 函数内部就要脱敏，不能只脱敏业务请求层（本刀审查真抓到）。
- [ ] token 缓存必须单飞（in-flight promise），失败要清 in-flight，否则并发双取或永久卡坏。
- [ ] 源码里绝不放字面 NUL 字节（git 判二进制毁 diff/blame），用 '\x00' 转义序列。
- [ ] 多 worker 分摊同一张表的收敛职责时，用"锚列 IS NULL/IS NOT NULL"做集合切分并在终审做三方谓词互斥核验。
