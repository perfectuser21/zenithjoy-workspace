# paused UI取证：独立远端不存在回执

GP-Anchor: line02/keyword_acquisition keep-green

任务713e4691-6fb1-444c-9e1a-bd5a8cea28b7，actor session:01a11b40-46cc-7a52-8c79-01b58f4583a6。根已授权并登记开始事件。本刀独立树以正式dc3为基线，不修改在途真机或部署。

问题：Android stat对不存在的远端XML返回1和空stdout；现paused首idle要求numeric0，真实文件不存在时仍三次dump。实际CLI RED复现两阶段8次dump，预期4次。

修复边界：仅paused-*首idle、本地文件不存在、stat明确ENOENT后，独立同路径! -e且! -L核验，exit0及唯一固定ACK才提前原单次85→dump→85。unknown/权限/timeout/空或污染ACK保持原三次。ACK只证明文件不存在，不证明页面身份。standard/share、前后台/PAUSE/新树完整包/strictdetail/hardrc3/实际VIDnonce不变。

测试策略：实际控制器CLI假ADB模拟Android ENOENT，复用已有wait函数临时副本控制等待，真实便携Python。先RED提交再最窄实现GREEN；完整本文件正负CLI、nonce/guide相关回归、独立A–H。正式已有leadgen smoke包含此测试入口。无生产手机测试，收益待发布后实测。

守卫：Android ENOENT真实CLI须两局部阶段各首失败+兜底，8!=4已真实触发；ACK失败/remote存在及dangling symlink不得提速；无树视觉合法路径与不可信前提硬拒原断言保留。
