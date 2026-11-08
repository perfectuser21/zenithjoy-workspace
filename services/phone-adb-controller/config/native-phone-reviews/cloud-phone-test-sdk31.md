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

## cloud8 observer 隔离的非重放 supersession

`cloud8-quarantine-supersession.py` 仅处理原 Task `deeb4021-2b05-45e5-b8a6-712a38cdd0c7`、run `douyin_video_discovery-potato20261107_101_cloud8__a1`、source `41490a0aba7cbea0de32d15f575ee2169dd4198f`、binding `0ff7412e-c9b3-4e6a-8849-29eb1860efd6`、epoch `d185baf6-b32f-4de5-801f-52ee6bb35f26`。复用 cloud7 独立模块实例的已审 CAS 事务，不修改 cloud7 入口或常量。原失败、aggregate execution_stopped=false、最后 owner unknown 和未决 pending 原件全部保留。

非干扰依据：原 Worker、手机 native、SDK 与 Caller 已封闭；唯一未知是 observer bounded-owner 的归档协议状态。原冻结 Python helper 只能通过固定 JSON 协议管理派生 observer session 的本地 owner 文件，无手机、业务、网络或 shell 执行入口；原 sandbox 禁止 fork，原完整六叶库存的 process、stdin、stdout、stderr 和共享锁 FD 均已关闭。不得以当前 PID、时间、中央 free 或新诊断代替这些原始事实。旧 owner pending 只阻止旧 session，不迁移、不删除、不重标签；后继使用新的 run/binding/task 派生 session。

固定 archive SHA256 `8996c496d9ecc7b86cdd1b8c772e0bbbb81dbce2d684ae6a1cebb81468a31ef2` 覆盖原完整 ledger；逐字节核对原文件全集、冻结源码、三份 Caller/各自 artifacts、原手机关闭事实、四个 SDK 终态、唯一 observer 完整六叶快照和七个 owner 原件。任何额外能力、缺失关闭、身份/内容/库存漂移均拒绝。

`inspect` 只读检查候选，显式 not_recovery_authority=true；`plan/apply` 均要求实现及本审查原件已合并 origin/main，固定真实验证主任务 `ffd2d337-b10e-4f96-8e3e-bd35cd57bac1` 当前 claim（codex-cloud-leadgen-e2e / 2026-11-08T10:09:59.271Z），代码交付单 000e3f10 独立收尾，旧 Task failed，中央无 owner，同 inode 双根 guard，六文件精确 epoch CAS、持久 intent 和只读 free 读回。只迁移旧 quarantine 整目录，不写中央锁，不重放旧活动。

后继限定 `potato20261108_101_cloud9` 的 101、mmv/broker mmv、cloud-phone-test、原 serial/5041、账号 77980009922、yuesheng。后继必须使用正式 Skill 的 `PUBLIC_FULL_FROZEN_WORKFLOW_CLI`，以真实新 Task、冻结 workflow/source、run/binding ACK 进入 agent Primary 与 Runner official observer 完整链，并在预算修复合并、部署后执行；不得借用仅适用于其他嵌套 commander/wf-launch 合同的入口。本 authority 不启动后继，不豁免新 claim、双锁与账号实屏预检，亦不授权 104。


## cloud9 固定来源RECV未知的非重放 supersession

`cloud9-quarantine-supersession.py` 只处理 Task `8e8fbff5-21dd-4e4b-83ed-f06d9b4ea68d`、run `douyin_video_discovery-potato20261108_101_cloud9__a1`、source `1255614a804af02f11f7e792bf517d71fa3a94a1`、binding `bd948684-3ff1-4122-a948-59b4a5439d57`、epoch `942b1338-68f8-41b8-872a-35e7d8bb3e39`。固定 archive SHA256 `fb95bdee9a6b8cae6b2e84e18b8692c97a9cd619e220329570b979eecc340d76` 的986个原文件、冻结代码、六份 Caller 终态及其引用、两活动 observer、无fork本地叶子、原父wait回执与九个 owner 文件全部逐字节保留核验。

唯一未知是 cleanup/source 第18号 `/system/framework/uiautomator.jar` 的只读 ADB sync RECV。四个 write intent 必须逐字节等于指定serial的transport、sync、固定路径RECV、QUIT；无SEND或shell、无后续Worker和命令能力。preflight其余19份源和4个只读命令已有真实返回；全部Caller、observer与本地producer封闭。即使旧只读流远端终止不可恢复，也不能发写指令。不得把此非干扰证明称为原远端停证；原 `execution_stopped=false`、unknown、reserved pending及错误全部保留。

只读inspect不创建授权。plan/apply要求已合并来源、原Task failed（状态本身不是停证）、真实验证主任务ffd2d337当前claim及精确本地双根guard/inode/六字段。中央只接受原Task owner或真实None；在封闭/非干扰与本地CAS全部核准后，唯一允许写入是既有Brain设备锁endpoint按原locked_by精确CAS释放，必须收到成功响应且独立GET为None。None仅为并发状态，不能当停证。中央intent无returned即阻断再次apply，不以重查free或过期猜上次POST成功。随后使用固定cloud7私有事务原子rename本地隔离，旧目录与字段不变；任何新owner、漂移、失ACK、未知提交均中止并保留屏障。

后继仅 `potato20261108_101_cloud10`，mmv/broker mmv、cloud-phone-test、原serial/5041、77980009922、yuesheng，使用正式 `PUBLIC_FULL_FROZEN_WORKFLOW_CLI` 完整Code模式的新Task/run/冻结ACK，不带raw transport。不启动后继，不豁免新双锁和当前账号实屏核验，不授权104。
