# 云手机有限命令来源审查

范围：MMV 的 cloud-phone-test，47.100.213.173:10001，抖音包 com.ss.android.ugc.aweme，720×1280，Android 12 / SDK 31。仅用于已授权101的有限命令，不授权104发送、任意shell或任意路径。

来源：2026-11-06两次独立RECV读取了本策略所列19个系统程序/直接Java入口原件。每次取得本人中央锁和同guard旧新根检查的本地锁；RECV后QUIT与真实EOF，本人双锁均已释放。input.jar未存在，明确不列为来源。实际input、wm、settings、ime均转交cmd的对应Android系统服务；am只允许非instrument的activity分支；uiautomator仅dump分支，不能runtest或nohup；monkey只允许固定包启动且count=1。有限参数由Code编译，Worker不能提供shell文本、环境或路径。

平台假设：uiautomator 的缓存目录 mkdir 使用可信系统 PATH 解析到系统命令（策略已绑定 toybox 入口）；不接受 Worker 改写 PATH。信任本台Android系统、adbd及其正常同步命令/服务语义。这里绑定有限入口和直接Java脚本依赖的真实字节，不声称逐个证明整个操作系统、共享库或所有系统服务。cmd input/window/settings/input_method/activity为原Android平台行为。app打开是预期界面状态，不能将它等同于命令仍在执行。

来源凭据仅证明固定入口匹配，永远不是远端停证。每次实际命令仍须shell-v2的有效EXIT、通道EOF和socket关闭、原scope/epoch/Source一致；异常、失ACK、截止、未决输入法/剪贴板恢复均保留unknown，不能靠本文件或Commander文本释放锁。下述独立历史非重放合同只处理其精确隔离身份，不改变正常命令停止和释放要求。最终手机释放还须原预检/清理、所有producer/raw品牌以及Caller都证实关闭；cleanup后launcher XML/PNG与独立Code Judge读回。

Pillow只用于原本地filter与原视觉编码，策略另固定MMV既有PIL完整文件清单；不安装或修改PIL，不改变图片谓词、评分政策或成功标准。

## cloud7 历史预检隔离的非重放 supersession

`cloud7-quarantine-supersession.py` 的 `cloud7-preflight-sdk-quarantine-supersession/v1` 是独立、一次性的本地隔离迁移 authority。它不用于 Activity 接手，`activity-skill-recovery.mjs` 的 `OLD_EXECUTION_TERMINATION_UNKNOWN` 保持拒绝；不重放 cloud7，不把来源审查、当前进程、PID 死亡、租约到期或新诊断当成原 SDK 停证。

仅允许固定 cloud7 Task `c4bab9ac-d487-4689-a26d-cf169066ec07`、run `douyin_video_discovery-potato20261107_101_cloud7__a1`、source `69c40526d2ba0ecffae10b566bb5e10b707e1268`、binding `5d2a142a-04b7-4583-96eb-4e3c9a99e422`、epoch `37802167-65cf-47ca-a7ce-d6bf086d9907`。完整 manifest/archive、frozen runtime、信息丢失诊断和 historical trace 的固定 hash 必须一致，实际原件清单不得增删。原件必须继续记录 needs_review、execution_stopped=false、historical stop UNRECOVERABLE。

依据是非干扰性，而非停止：原 Caller/本地 producer 已封闭，raw_turns 为空，Worker 从未启动、无业务动作或视频；19 个有限来源读取已返回；唯一未知命令是原编译器生成的固定只读 `exec /system/bin/getprop 'ro.build.version.sdk'`，四个 wire-write intent 的 bytes/hash 必须精确匹配。即便这个查询的终止未知，它没有界面、输入法、队列、发布或其他写能力，也没有可再发指令的旧执行者。已 admitted 的任意其他命令、未决输入法/剪贴板、Worker 或副作用均不适用。

计划和执行均核对原 blocked Task、固定 recovery Task 的当前 claim 及中央无外来 owner；这些只是授权和并发条件。代码须是已合并 main 的原件，并把 recovery source、review/policy hash 绑定到持久计划。持迁移双根的同 inode guard，fsync plan/intent 后只原子迁移整个六文件 quarantine 目录到唯一 `.superseded` 路径；原 owner/epoch/内容和目录 inode 保持。用原 frozen phone-lock-root 对双活动根真实读回 free，再落 returned；任何漂移、外来 owner、冲突或提交未知均保留屏障，重入只完成同一事务。

此迁移只授权 mmv/broker mmv、cloud-phone-test、47.100.213.173:10001、5041、77980009922、yuesheng 的全新 cloud8 `douyin_video_discovery` 101 Task。新 Task 必须 start:true + lease_seconds 领取并独立取得本轮锁与完整预检；旧执行结果仍 unknown，不回填 EXIT、EOF、socket-close、read_returned 或 execution_stopped=true。新运行正常清理、收据和双锁 free 要按其原合同验收。104、其他宿主、旧 run、任意身份/hash override 均不授权。
