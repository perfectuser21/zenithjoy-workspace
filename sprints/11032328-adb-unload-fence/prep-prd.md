# 修复异步卸载导致目标ADB服务未启动

GP-Anchor: none(infra)
任务：85725a89-e95c-477c-a2f3-b4f2fdbd78c0；父任务52a29b7e-3641-4cc7-81a6-3c750bba4a71。

现场只读观察与正式第四恢复回执对齐：15:20:13新路径readiness开始时，旧job仍SIGTERMed且argv指向旧路径；15:20:19旧job才消失；直到15:20:33探测耗尽始终没有新进程，之后旧服务恢复并读回四台设备。原代码bootout后立即根据loaded决定是否bootstrap，因此可能因退出中的旧job仍注册而跳过启动。

修复仅限原维护事务：先核Program和完整五项argv属于原journal的旧/新服务；有界等待旧job真正移除及固定管理端口关闭，才启动目标plist；恢复走同一围栏。运行中目标源和完整原设备集合仍独立核验。未知manager、外来socket、超时或原件冲突不强杀、不重连、不伪造成功，保留结构化私有诊断及待审锁。

红提交7c38e861；实现67da9ad5。root独立review并运行host25/25、transaction2/2、window4/4、backend8/8均通过。实际launchctl五项arguments及program格式已用只读原件核对，未输出环境。

范围外：业务顺序、104发送、账号、凭据及调度。20秒为单次卸载围栏预算；不宣称整个移位与恢复在全部故障下必小于既存120秒传输上限。现场恢复仍需正常CI/合并后正式入口证明。
