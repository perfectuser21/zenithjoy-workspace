# SDK31云机102正式接入（2026-10-16）

Task: edada317-369e-4066-8502-f644ca25a99c
GP-Anchor: line02/keyword_acquisition keep-green

根本原因：SDK31的包名前缀查询及原生音轨格式不同；官方scrcpy5.0.1音频初始化竞态已由真实主机崩溃证据定位；已有ADB传输完成数据却等待EOF；单独函数测试无法发现真实CLI后台录制持有guard的问题。

预防：保留真实原件的SDK格式负例；客户端/server精确固定SHA；接收精确字节并无覆盖发布；内部push仅核本EID预准备成功原件，不另发上传；录制独立会话关闭guard继承，取消/守卫读回异常传递EXIT_UNVERIFIED并保留资源。停止前重验进程身份；成功必须实际解码、样本覆盖、非静音及退出后native恢复证据，不能只信容器时长或PID。

发布守卫：同时校验RPC声明、设备清单及MMV实际复制清单。Skill方法、消费者、合同与代码摘要一起更新；生成锁不代表兼容批准，11个兼容Activity沿独立精确集合评估，qualification策略升级单独升版。源码、局部真机、正式Source和全102生产验收分开留证。
