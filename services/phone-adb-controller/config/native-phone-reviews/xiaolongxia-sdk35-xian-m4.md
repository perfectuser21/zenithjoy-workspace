# 小龙虾 4311 有限命令来源审查

范围：xian-m4 的 xiaolongxia，ANGYVB4311010223，抖音包 com.ss.android.ugc.aweme，1200×2664，SDK 35。仅登记现有 101 有限命令的真实来源，不授权 104、任意 shell、任意路径或扩大动作白名单。

2026-11-07 在实际既有 ADB server 上，对配置所列 19 个系统程序及直接 Java 入口进行了两次独立 sync RECV 读取；两次字节摘要一致，每次取得 DONE 后发送 QUIT 并确认 EOF。此为只读 ROM 来源审查，未操作 UI、启动任务、取得或清除设备 owner。SDK 与尺寸另经该 serial 的只读 getprop / wm size 核实。审查原始回执：evidence/potato-runner-commander-20261107/source-observation.json。

am 只允许非 instrument 的 cmd activity 分支；input、wm、settings、ime 分别转交原 Android cmd input/window/settings/input_method 服务；uiautomator 仅 dump 分支，不能 runtest 或 nohup；monkey 仅固定抖音包、LAUNCHER、count=1。其直接 app_process、uiautomator.jar、android.test.runner.jar 与 monkey.jar 均使用该 ROM 的真实摘要。uiautomator 缓存目录 mkdir 依赖可信 Android 系统 PATH，toybox 入口也被固定；Worker 不能改 PATH、环境、程序或参数模板。该假设与现有有限命令编译器一致，不声称枚举整个操作系统及服务的依赖。

Pillow 清单单独绑定 xian-m4 既有 /opt/homebrew/lib/python3.14/site-packages/PIL 的实际 132 个文件，包含本地扩展及 .dylibs；排除解释器生成的 __pycache__。未安装、升级或修改依赖，不借用 MMV 的库字节。

本审查仅提供固定来源。每次真实执行仍须由原 Runner 在合法 Task/run/epoch、中央租约与本人本地锁内独立 RECV 核这些字节；命令还须取得 shell-v2 EXIT、EOF、socket 关闭与原 scope 的停止证明。来源匹配、模型文字、CLI 返回或本文件均不能代替停止证明。输入法/剪贴板恢复或任何原生操作未决时保持 unknown；清理必须经原桌面 XML/PNG、独立 Judge 与所有 producer/Caller 收尾后才能释放本人锁。禁止清除 4227/4402 待审 owner。
