# 云手机有限命令来源审查

范围：MMV 的 cloud-phone-test，47.100.213.173:10001，抖音包 com.ss.android.ugc.aweme，720×1280，Android 12 / SDK 31。仅用于已授权101的有限命令，不授权104发送、任意shell或任意路径。

来源：2026-11-06两次独立RECV读取了本策略所列19个系统程序/直接Java入口原件。每次取得本人中央锁和同guard旧新根检查的本地锁；RECV后QUIT与真实EOF，本人双锁均已释放。input.jar未存在，明确不列为来源。实际input、wm、settings、ime均转交cmd的对应Android系统服务；am只允许非instrument的activity分支；uiautomator仅dump分支，不能runtest或nohup；monkey只允许固定包启动且count=1。有限参数由Code编译，Worker不能提供shell文本、环境或路径。

平台假设：uiautomator 的缓存目录 mkdir 使用可信系统 PATH 解析到系统命令（策略已绑定 toybox 入口）；不接受 Worker 改写 PATH。信任本台Android系统、adbd及其正常同步命令/服务语义。这里绑定有限入口和直接Java脚本依赖的真实字节，不声称逐个证明整个操作系统、共享库或所有系统服务。cmd input/window/settings/input_method/activity为原Android平台行为。app打开是预期界面状态，不能将它等同于命令仍在执行。

来源凭据仅证明固定入口匹配，永远不是远端停证。每次实际命令仍须shell-v2的有效EXIT、通道EOF和socket关闭、原scope/epoch/Source一致；异常、失ACK、截止、未决输入法/剪贴板恢复均保留unknown，不能靠本文件或Commander文本释放锁。最终手机释放还须原预检/清理、所有producer/raw品牌以及Caller都证实关闭；cleanup后launcher XML/PNG与独立Code Judge读回。

Pillow只用于原本地filter与原视觉编码，策略另固定MMV既有PIL完整文件清单；不安装或修改PIL，不改变图片谓词、评分政策或成功标准。
