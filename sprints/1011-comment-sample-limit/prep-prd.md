# 102 显式评论采样配额（兼容小版本 2.2.0）

根任务：713e4691-6fb1-444c-9e1a-bd5a8cea28b7；会话：01a11b40-46cc-7a52-8c79-01b58f4583a6。
GP：line02/keyword_acquisition，keep-green。

用户明确下一轮取 30 视频，每个合格视频先核 5 条评论，再评分本轮实际新评论。当前真机旧批不改源、不改配置。现 102 collection 内部 helper 沿用已有 Activity 和七个 Step；新增可选 CommentSampleRequest，用户参数不是新 Activity，也不是 qualification 的虚构输出。

## 输入与事实

LEADGEN_COMMENT_LIMIT 可选整数 1..50，仅允许 102。未设置完整保留原行为（large 历史加新覆盖 50，medium 全采）。设置后所有 tiers 按本视频已核历史加新 distinct OID/完整正文计覆盖；own、失败、未观察历史不计。source_run、run_tag、profile、serial、line 随请求进入真实 run-definition 和 snapshot_sha256，活动实际环境与冻结输入必须一致；非法、改值、取消、换来源拒绝。

达到 quota 输出 sampled / quota_reached，PG collect_partial 保持视频未全采，cleanup 释放租约。真实新鲜 footer 输出 footer_reached；无评论输出 no_comments。不得以停滞、预算到期或限额当 footer。videos_collected 仅完整视频，videos_sampled 仅配额视频。原 comments_collected 保持本次 LEAD 观察口径，comments_inserted/history_verified/coverage 独立；历史 5 新增 0 不构成评分样本。

同 source_run 后续 102 自动核前序冻结身份、同配额、同发布源、私有采样回执、实际 collection completed/partial 结果，再 PG 精确 id/OID/全文/URL 和受信 URL 实际 VID 只读复核，排除已兑现本轮样本。intakeVideoIds 与 claim 使用相同名单；不接受任意用户 exclusion，不改全局评论已采，不把 failed/blocked 回执兑现。私有回执 0600，公开 Activity 输出只含 VID/计数/stop_reason，不含全文。

## 可审证据

业务 RED：8bbff0f4 的真实 fake controller 执行证明原流程忽略 5 配额；日志 /tmp/codex-comment-sample-limit-red-20261011.log。

排除业务 RED：固定 8bbff0f4 隔离 archive，复制同一永久测试，实际 intake 对已兑现 5 条的 VID 仍返回 eligible；expected [] 却实际含 VID。/tmp/codex-comment-sample-prior-business-red-20261011.log，exit 1。

GREEN：12 个真实 fake controller 采样边界通过；66 个 runtime/wrapper/queue 通过；product-map 80 个通过。日志分别 /tmp/codex-comment-sample-controller-green-20261011.log、/tmp/codex-comment-sample-wrapper-queue-green-20261011.log、/tmp/codex-comment-sample-product-map-tests-20261011.log。随后预算与默认完整回归另保真实结果，不以早期测试代替最终 source 全套。

合同真身修改后，正式 product-map:generate、wf-plan --write、gen-step-dod 生成计划和步骤投影。open_comment_section/collect_comments 仍要求 videos_processed 真实手机证据，只有 mark_video_collected 的 PG 完成状态读回按 videos_collected，新增真实 sampling_readback_count == sampling_required_count 探针。

未 push、未部署、未操作设备；根代理独立审查及三刀加采样同源正式 full 后才更新 PR2115。

独立审查新增 run/attempt/verification 边界实际 RED：bd006438，/tmp/codex-comment-sample-attempt-verification-red-20261011.log；GREEN80/80 exit0。前序 private receipt、split-result 和 readBinding 请求+ACK须同 aN/run/snapshot，collection独立verification必须true。带真实采样回执的collection partial也执行原同套verify，状态仍partial，verify失败仍failed。

四旧短链+当前URL的合法5覆盖边界实际RED：d246c58f，/tmp/codex-comment-sample-four-alias-red-20261011.log；修复仅允许当前URL加最多4已受信别名，原history候选4上限不变。最终相关81/81预算/队列/冻结/wrapper通过（/tmp/codex-comment-sample-final-targeted-green-20261011.log），默认完整queued37/37通过。最终root同源full另行记录。
