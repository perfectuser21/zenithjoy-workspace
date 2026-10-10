# 屏底裁切候选的有界重新定位

GP-Anchor: line02/keyword_acquisition keep-green
根任务：713e4691-6fb1-444c-9e1a-bd5a8cea28b7
会话：01a11b40-46cc-7a52-8c79-01b58f4583a6
基线：4e0f1ce9。根代理已授权独立实现，不部署正在执行的冻结批次。

真实问题：codex10110519_ai30h_101 的9、12、16号候选归位后完整标题仍在屏底，作者及点赞锚点不露出，三次同视口读树无法产出完整卡片。六份原始XML保留在测试fixture，来自只读回读。

修复：完整keyword/videoTab新树上，仅唯一原完整身份对应的屏底标题满足严格XML/全包名与真实视频卡结构时允许导航hint。hint不提供点击坐标。每候选最多一次85%→65%短up，沿用三次定位读树与原截止预算；下一新树仍完整title/author/duration及原like锚点存在，恢复后同身份必须唯一，拒绝ordinal漂移。使用新树坐标；失败记candidate_clipped，不放宽workflow wrapper成功门槛。保留前后证据及实际完整身份恢复标记。

验收：真实三组XML；错包、相关搜索、标题消失、顶部裁切、重复标题、完整XML失败均不给hint；错作者/同身份双卡/错keyword/滑动失败/预算耗尽不点击；原同标题不同ID回归保持。正式整合full由根代理执行，未宣称真机提速或上线通过。

哨兵：services/phone-adb-controller/__tests__/card-bottom-reveal.test.mjs，真实行为RED ca7aa16a，再GREEN；第一次语法错误历史保留但不作为业务RED证据。
