# 修复101发现阶段预算接缝
Task: 1ec5bba4-3aea-4b79-a49c-3eb43c11901d
GP-Anchor: line02/keyword_acquisition keep-green

b29f首屏4候选仅处理2后，Activity仍余约616–625秒却被661秒粗门槛拒。原661仅公开动作默认上界之和，漏续锁与额外元数据费用，不能作为完整原子闭包。

仅101 collect将实际执行phase caps与nominal准入同表：cards120s/link300s不变，续锁10s/关键词回读10s/tap30s，sleep cap3s。正常单遍名义合计503s；真实tap续锁后必须fresh核343s尾部。不足仍结果页拒；所有动作继续按原绝对工作截止截短。503不含所有重定位/启动/同步核验/PG费用，不保证整捕获完成。

保Activity900/global1200/cleanup120/ADB route2秒、身份/锁/unknown/fork及原政策；不手机、不恢复业务数据、不103/DM/生产。本Task源码检查点30分钟，独审后正常PR完整CI和隔离candidate，实机另验。
