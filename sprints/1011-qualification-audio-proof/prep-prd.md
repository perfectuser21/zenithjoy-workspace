# 录前媒体音量与本轮音频核验修复
GP-Anchor: line02/keyword_acquisition keep-green
根任务：713e4691-6fb1-444c-9e1a-bd5a8cea28b7；执行者：session:01a11b40-46cc-7a52-8c79-01b58f4583a6。
实际102_02静音视频本轮音轨-91dB，却经标题兜底写matched。媒体音量回读stdout被丢弃，不能据音轨电平推断媒体音量。
保实际record-start正向音量证据；实际静音按已有合同空/静音拒绝，不再冒充完整ASR内容合格。未知/失败待重判，旧转写事实不覆写。不操作手机/部署/PG纠正；错误历史缓存只给精确CAS纠正方案。
测试策略：真实shell假controller先RED，队列真实事务假PG+placeholder+lease守卫，实际workflow消费工件与独立读回；既有leadgen-split smoke覆盖所改测试。
