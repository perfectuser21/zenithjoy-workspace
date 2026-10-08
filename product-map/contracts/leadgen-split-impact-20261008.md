# 智能获客四流程合同影响表

任务：`dffd5885-46f7-4cf1-b55b-8729497b9928`。用户决定：`26e8e446-b2b0-4857-ad4f-a758a8daa39c`。
分类真身仍是 `product-map/product-map.yaml`；四份契约的 `capability` 均为 `keyword_acquisition`，`contract_key` 仅区分执行定义。

| 受影响合同 | 原调用方 | 新合同与变化 | 兼容性／切换条件 |
|---|---|---|---|
| 发现 | 旧关键词、旧对标 | `douyin_video_discovery`：取源→去重→重新定位取链接→PG候选回执 | 不兼容：视频队列成为交接点；新定义发布绑定后退役旧入口，禁止回退 |
| 判定视频 | 旧关键词、旧对标 | `douyin_video_processing.qualification`：从PG租约认领，深链打开后独立核实实际ID | 不兼容：禁止假设视频刚由发现打开；仅本run持锁与认领视频可执行 |
| 采集评论 | 旧关键词、旧对标 | `douyin_video_processing.collection`：matched才采；评论事务提交后标记视频 | 不兼容：PG评论是交接点；每次恢复重新核实视频与当前坐标 |
| 评论评分 | 旧关键词、旧对标 | `douyin_comment_scoring`：按实际认领ID查PG，评分→标记人 | 不兼容：不读取飞书投影作为执行真身，不拿历史harvest_batch冒充评分run |
| 触达 | 旧关键词、旧对标附属链 | `douyin_lead_outreach`：预检→发私信→回填→收尾 | 发送前置条件保留；work暂停不解除，未执行只能记skipped，不能造送达 |
| 运行外壳 | 旧两入口 | 每个新活动绑定`activity-commander.mjs`；`leadgen-workflow.mjs`绑定独立队列 | 实际模型回执、必需步骤读回、中央证据缺一不可；失败仍清场 |

旧活动定义不原地修改、旧必需断言不删除；新合同独立版本保留原步骤语义，触达重复“拿锁”合入预检拿锁，配送步骤移入相应PG提交活动。`finalize_run`属于外壳，保留在收尾读回。

明确缺口：对标主页现有原子发现器不提供标题与作者；此来源记`benchmark_identity_unavailable`并拒绝按旧坐标取链，不启用旧对标入口补位。暂时无法独立读回的原有`none`步骤不冒充通过；真实发送未授权且work暂停，本次不做发送验收。
