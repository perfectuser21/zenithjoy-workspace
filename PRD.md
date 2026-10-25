# 修复102已认领工作集边界

Task: 1f48feed-3426-4ae2-90a4-6e5ee1e50275

GP-Anchor: line02/keyword_acquisition keep-green

570b真实接收2个新VID、按授权仅领取1个并按原v14判为rejected，另一未领VID却被记入本run collection未完，制造partial并阻断正常空批次收尾。仅移除未领输入对本run未完的错误贡献；原政策、已领未完成、未知领取、预算中断与OS unknown守卫保持。

永久回归先提交：真实createHandlers/intake/qualification/collection/invokeNativeActivity/runWorkflow，2VID输入+limit1的rejected0=0与唯一matched视频已证零评论完成；真正已领未完、领取unknown和预算错误仍拒。零评论路径不计正向采评论通过。

不包括101预算修复、手机/业务库/新采样、103/DM/生产或新cleanup授权。源码检查点自10:51起20–30分钟。
