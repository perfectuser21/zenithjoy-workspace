# MMV SDK31 受管录制来源审查

范围：仅用于公共Runner的102受管录制有限来源校验；本文件本身不证明真实录音质量、业务成功或停止。

## 审查对象与事实

本审查限定MMV的SDK31受管录制：scrcpy5.0.1，官方源码a60891aea193d92e7e5c3942700eca63f9d19a5f的14个相关C/Java原件及既有固定recorder/log补丁与client/server policy。正式host行必须独立核实际root、client、server、Node、ps的路径/UID/权限/字节摘要，并在最终Source中钉住本review和NodeShim等全部执行依赖。当前只读物理文件检查不执行ADB或录制。

## 有限准入边界

必须由Code持有原Task/binding/run/profile/serial、claim与epoch、Source及绝对预算；Source capability须真实原issuer RECV取得，JSON/克隆/foreignscope不授权。bridge仅原loopback既有ADB41；version/start仅probe，push只对预置固定JAR做RECV/hash/QUIT/EOF。每次readback先清私有Jar标记，完整核验后才准同bridge单次Server启动；缺claim/epoch或未知不能借旧标记。

## 保留原Server行为

SDK31仅原C实际参数scid、log_level=info、video=false、audio_codec=raw、cleanup=false，forward才有tunnel_forward=true。SDK33独立kind仅原scid/log、audio_source=playback、audio_dup=true、cleanup=false等对应参数。拒额外bitrate/control/power/clipboard覆盖；只追加no-cleanup防止未受管cleanup app_process/setsid子进程。原headless固定C无输入事件或turn_screen_off/start_app消息；phone→host clipboard和默认powerOn可能唤醒屏幕仍是原行为，不声称零屏幕/剪贴板影响。

## 归还与不可替代的停证

材料cap仅在全部条件同时成立后签发：实际本人Host进程组/子Shim/stdio/logfd归还；同bridge/Scope私有HostStop；Server原nonce/SCID/PID/start和精确postexec cmdline/UID、shellEXIT及完整EOF，并独立读回原PID消失或被替换；本人norebind tunnel精确归属、移除后独立absence；实际IPC/ADB通道关闭；原Code音轨START/END和独立恢复观察。缺EXIT、proc拒读、unknownACK、未归还或Source漂移均不能以HostPID/Agent文本/JSON洗白，也不重复未决副作用。

## 期限与进程竞争

NodeShim在返回前直接核原绝对期限，输出callback迟到不能被overdue timer竞争洗成成功；DATA0拒绝。受管stop后的IPC回传EPIPE只可在本人IPC已真实关闭后忽略投递失败，不替代真实ADB/remote/tunnel停证或清除unknown。Host fork→exec候选只在min(开始+500ms, 原worker/cleanup截止)窗口内调度只读重核，最多64次；每个ps仍走原有界收回，窗口过后不再调度重核（不声称所有ps完成总墙钟耗时必小于500ms），中间行不注册、不授信号权，最终仍原strict Source/owner匹配。

## 证明范围

已核Source和隔离组件的真实子进程/Unix/loopback wire组合及privatebrand拒绝行为；synthetic ROM/JAR和编译测试C并非真实OEM录音或生产stockclient实跑。未证明音频可听、媒体质量、真实抖音资格、完整102publicworkflow或整个Android/OS停止；这些须独立Judge/实际现场证据，不从本review推定。

## 准备期限与自然终结观察

这是明确的方法调整：仅真正私有Bridge将协议准备与媒体缓冲分开，协议准入截止为原worker绝对截止减原实际最大录制秒数，再预留10000+2000+500毫秒归还；媒体缓冲截止为该协议截止与Code唯一post_exec_verified_at_ms加原min(12000, maximum×1000)中的较早者。时间戳仅在原PID/start/UID及精确cmdline核验后私有记录一次，不接受Worker、JSON或重复读取重置。postExec早于连接和媒体，不是官方定时器或首包时刻；不延长Activity、run、receipt或cleanup预算。官方SDK31 a60891的scrcpy.c在连接、demux之后才开始time-limit；SDK33 fb638同理。旧无Bridge路径保留原spawn起算窗口。独立来源审查及隔离协议反例覆盖慢权限、缺Session、材料无Session、假时间戳、撤权、漂移和不足预算；不是OEM实录结论。

原Server观察者若同scope/nonce/SCID/PID/start/UID已核postExec，实际EXIT0、完整EOF与socket关闭且没有unknown/closing/stopping，可准一次原END只读观察。active路径保持原样；EXIT23、缺EXIT、foreign/克隆、停止后均拒绝。END不是restore/status/start授权，不是HostStop、RemoteStop或资源释放证明；无论自然结束原因，最终归还仍要求前述全部AND。独立审查分别核自然EXIT0、EXIT23、缺EXIT和私有品牌反例。

## 原件与局限

来源审查与实测报告由Brain任务8b8ced58-ba3a-4bff-99f4-b433e03c26b6的交付证据保留。phase独立报告SHA256为2699a0fc54e1725713e2800ae5f96584539978fa1cefd28dd2acd75667bb18e9；自然END独立报告SHA256为d953d19c925cd3f4dc34dd298037cc1075d42136d9bb3675b92e9b95b3d4681d。组件与隔离完整链不能代替真实设备、音频质量与业务Judge；正式候选仍须Source闭包、必需CI及现场验收。
