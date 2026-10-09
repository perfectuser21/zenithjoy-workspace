## 手机取链暂停与清场汇总修复（2026-10-10）

### 根本原因
真实发现批的5个活动全部通过独立验收，2条新视频入库、失败0；正常cleanup after finish被误当成业务提前停止，整批误标partial。随后处理的真实视频身份核验失败：中央点击暂停会触发视频内容链接，或反向切换播放状态，使界面树连续180秒不可读。两条均未进入ASR，原失败与partial记录保留。

正式CI随后在初始化postgres:15时遭Docker Hub匿名拉取限流，重跑仍失败，测试尚未执行。改从Google公开Docker Hub缓存拉取同一PostgreSQL15，保留全部测试与门禁。实际缓存manifest HTTP200并包含linux/amd64。

### 下次预防
- [x] 清场汇总与视频中央互动元素均先提交失败测试，再修生产逻辑。
- [x] 仅cleanup实际completed或skipped的正常finish例外；业务提前finish、失败、partial、escalate和验收失败保持原状态。
- [x] 实际真机持锁诊断：MEDIA_PAUSE127后2.38秒读到有效详情树，MEDIA_PLAY126已发送，诊断清场并释放锁；不作为业务流程成绩。
- [x] 取链与归位使用幂等媒体暂停/播放键，保留nonce实拷实贴、短链新鲜度、标题作者、实际视频ID与界面守卫。
- [x] 假手机按实际按钮坐标与播放状态模拟，避免按第几次点击硬编码而掩盖误触。
- [x] 把生产完整CLI返回栈与互动元素测试纳入正式四流程smoke。
- [ ] 最新候选完整CI、主线pilot与两机真实发布后，再验收全新实机批；不能修改原partial回执。

全仓smoke真实288项中208通过、79存量债、8跳过、1必绿失败；唯一阻塞是nginx:1.27-alpine临时拉取同样遭Docker Hub限流。固定版本从Google缓存预拉取并保留原本地tag，原Nginx真实配置/重定向断言与基线不变，缓存manifestHTTP200/linuxamd64。
