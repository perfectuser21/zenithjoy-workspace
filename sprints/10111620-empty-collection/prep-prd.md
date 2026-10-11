# 无合格视频的空评论工件

GP-Anchor: line02/keyword_acquisition keep-green

任务：713e4691-6fb1-444c-9e1a-bd5a8cea28b7。用户已授权修复并验收最新获客流程，每合格视频先采5评论，send0。

真实运行 codex10111439_bluemux5s5_102_02 资格判定完成、matched=0。collection未产生comments.tsv，resolve_profile_link读回返回unknown，整批失败。清场真实通过、设备锁已释放。

最窄修复：collection开始以0600 append模式打开本批comments.tsv，空候选产生空工件且保留已有行；不改变统一裁判，缺文件仍unknown、坏主页链接仍false。资格门禁、采样配额、PG读回与评分保持。

先写真实handler+正式step计划的smoke，修复前ENOENT触发失败；修复后相关73测试通过。零评论、零采样仍如实为零，不当作首5样本验收成功。真机收益须正式发布后重新验收，保留旧失败回执。

发布检查：PR 必须声明同一 GP-Anchor，并等待正式 CI/Pilot 验证通过后部署，不热改冻结批次。
