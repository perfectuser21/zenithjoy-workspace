# 评论采集的局部idle取树恢复
GP-Anchor: line02/keyword_acquisition keep-green
根任务：713e4691-6fb1-444c-9e1a-bd5a8cea28b7；actor：session:01a11b40-46cc-7a52-8c79-01b58f4583a6。
正式26本轮两条评论各约282秒，四个阶段各约40秒；mtime仅证明阶段间隔，不声称独立dump次数。
本刀只加快open-video前台闸/详情树、精确复制guide受限BACK后详情树、open-comments前树。typed内部策略必须本命令fresh严格唯一抖音package+MEDIA_PAUSE成功；首idle且remote/local均无新XML才提前原单次85→dump→85。不是VID认证，不能借旧图/父缓存/expectedVID。guide必须本次精确zs0+zsx树和受限BACK。gate若dismiss动作后下一round重新前台/PAUSE。
每张树仍独立fresh+完整package与原相应parser，person/OID/全文/实际VID/nonce/评论面板和unknown13拒绝全部保留；不改数量/预算/PG/Activity/全局env/部署。默认open-video仍恢复PLAY，open-comments采集允许PAUSE。错误/未知前台、PAUSE失败、旧XML、错误新树、非idle失败均不能被提速包装成成功，dump失败后85仍成对恢复，媒体恢复失败不能假绿。
测试策略：真实控制器CLI假ADB有效RED（open-video8dump≠4，open-comments5≠3，guide4≠2）→实现；内部策略真实shell边界回归；既有leadgen-split smoke已包含两个受改test入口，不新增未注册烟测。

## 独立审查发现与补充验收

初版 working controller（sha256 cf2cae893456f5f865312404b4e1928f6debecff3ef48165429d0626214046a6）存在硬安全错误被 open-comments 视觉兜底吞掉的问题，不能交付。真实 CLI 业务红测 9 项中 8 失败；合法无树视觉兜底 1 项通过。测试设置首轮因缺 fake key 而失败的记录保留，不作业务红测。有效红测：`/tmp/codex-comment-idle-hard-cli-valid-red-20261011.log`。

修正仅为 typed 局部 policy 区分硬失败 rc3 与正常无树 rc1：前台/暂停/媒体 toggle/实际新树不可信均硬拒绝，调用者不能转视觉或软归位；可信前台与本次暂停已成立而有界无树，保留原视觉定位及新面板验证。remote stat 未知不证明 remote XML 为空，保原三次尝试；既有 share policy 不扩大。真实 CLI 完整 26 项通过：`/tmp/codex-comment-idle-hard-cli-green-20261011.log`（exit0，15.80s）。最终追加 open-video CLI 故障测试、nonce/guide 专项和独审结果另以真实日志留证；不把 fakeADB 测试当真实手机提速验收。
