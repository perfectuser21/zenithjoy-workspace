# 101逐屏取链，102按实际视频ID接力

本次决策 d7ed5daa-2511-4e26-8f56-58e4d1107356，任务 713e4691-6fb1-444c-9e1a-bd5a8cea28b7。

用户输入关键词和筛选条件，101应逐屏采集真实链接。原逻辑先扫多词候选，再按标题历史过滤、每个候选重开搜索，只取默认2条。同标题不等于同一视频，历史视频保留旧批次后也不能只用新批次号交接102。

101首屏核验后直接逐卡重读UI定位、分享取新鲜链接、归位原搜索结果；每条PG保存实际回执后继续。按实际VID幂等保存，独立清单保存每次观测和唯一VID；滑动后等待加载，只有明确空结果/到底才报告扫完。默认0表示持续扫描，仍受实际活动预算、屏数和1000唯一VID保护；达到保护边界如实partial。显式limit达到目标也保留all_results_scanned=false。

将filter_history/filter_own_accounts/filter_current_run三个步骤迁到102，全部保留Commander和独立读回门禁。102校验101冻结身份、发布来源、本批captures/videos一致性，PG按明确VID读回；已采、已拒绝、自家作者不重复处理。同标题不同VID保留。空ID清单不退回全库，缺行停止。认领上限或并发租约留下的视频显式partial，不冒充全批完成。

109项四流程smoke通过；31项发现/队列/预算及102交接回归通过，无skip。新测试先失败后实现，保留复制新鲜度、默认102取链回详情及播放状态回归。product-map整套测试的部署manifest测试必须在提交后运行：固定commit不接受未提交工作区字节，此边界保持。

这份记录只证明代码和模拟控制器回归，正式部署与新实机批次必须另留实际发布、设备、PG和耗时证据；104暂停发送。

提交后的69项product-map全套测试通过；null明确VID清单先红后绿，队列9项通过。PR 2099首轮缺少GP-Anchor声明，被既有L1门禁正确拦截；已补读真实GP分类并修正PR说明，未改门禁。DeepSeek审查3次均返回空content，记录provider异常，不伪造审查通过。

本次GP锚定读取product-map/generated/product-map.md：line02/keyword_acquisition为active，包含leadgen-split-smoke；模板customer_smart_acquisition已deprecated，按SSOT采用active GP。
