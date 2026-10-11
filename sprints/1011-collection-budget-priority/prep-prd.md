# 评论采样预算与同范围matched优先

根任务713e4691-6fb1-444c-9e1a-bd5a8cea28b7，实际SID01a11b40-46cc-7a52-8c79-01b58f4583a6，line02/keyword_acquisition keep-green。基于8fc4d810的已审视口修复，仅追加内部采样预算与队列优先级，不新增Activity，不取消101/102同发布源核验。

## 问题与预期

原每视频collection软预算默认480秒、videoAction硬上限960秒；显式1620秒配置也会在960秒被截断。采样claim原pending优先，会先消耗资格判定预算而延后已matched待采视频。新显式采样collection_budget_s冻结1..6720整数，未显式设置仍不增加字段且保持480/960。显式1620对应进程上限2100，执行timeout再与Activity剩余及实际WF_RUN_START_TS+WF_RUN_MAX_SECONDS剩余取最小值。到截止不再renew/history/phone，返回实际partial而非假完成。

每视频私有collection-budget-readback.json仅记录真实请求、软预算、进程上限、全局起点/总秒数、Activity截止及各videoAction计算的实际timeout/global/activity剩余，不声明评论完成。sampling_input新增字段仅显式设置时存在，resume变化或取消被拒绝。

仅已冻结CommentSampleRequest且已有受信101 intake明确video_ids时，102向claim_videos发送prefer_matched:true。queue要求真boolean、合法source_run及明确video_ids，完整line/source/VID/锁/limit过滤保持；无采样原pending优先不变。原history独立PG重验、覆盖配额/新评论/评分语义保持。

## 验证

永久smoke测试先RED：ac5063cd，11项真实业务失败；其中独立videoAction实际960≠2100证明旧硬上限冲突。实现后相关5文件140/140 PASS、0skip、退出0，包含默认/1620/6720、非法值、真实global剩余夹紧、到期无RPC/phone、冻结预算改变/取消、matched优先及范围/boolean拒绝。测试已属于正式leadgen-split-smoke既有入口；完整统一smoke由根代理合并控制器独立优化后固定同源运行。

本改动不复用旧26发布的101来源清单、不操作真机、不声称新源已部署或5评论已验收；下一轮需新源101真实链接、102真实采样及103真实新增评分。
