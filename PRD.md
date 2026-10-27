# 原生进程观察不得阻塞受管ADB的IPC
Task: 58d08a78-4119-4117-bc98-12390bd988eb
GP-Anchor: line02/keyword_acquisition keep-green

原9c5b已正常领取并确认一条合格视频，collection的client_version在原2秒处超时2003ms并隔离。此次历史超时的具体触发原因仍未知，不以结构测试或后续直接CLI成功代替历史归因。

已证设计风险：原生观察器每25ms同步启动Python观察进程，children单次可阻塞3秒；同一Node事件循环也接收scoped managed client的Unix请求。永久回归使用真实execInput、原生收据、真实Darwin nofork producer、真实controller初始化和managed version。测试只有私有loopback假ADB服务与IPC-FAKE序列号；慢观察为真实子进程的synthetic trigger，不接触手机。

最窄修改限内部观察：异步有界检查，整批轮询和每PID登记single-flight，不积压重叠。停止及信号仍共享原单调截止，取消或忽略晚到结果，最终收据不被晚到观察改写。公开同步processIdentity契约、32个上限、25ms节拍、精确身份/信号权限保留。错误、超时、坏JSON、漂移仍unknown；observed_only永不变成OS全集合停证。

不加version的2秒，不省观察、不清未知、不新增cleanup/resume权限。不改手机动作、端点模板、公司政策、旧失败、业务数据或额度。5042模板与实际5041不一致是独立缺口，不混本实现；新源码消费旧producer及人工恢复不能借本PR绕过现行来源/用户权威。

范围：永久RED先提交、最窄实现、必要方法摘要/五版头、独审、完整正式CI及隔离候选。不得把源码/候选通过冒实际评论或103端到端通过；不搜索、不恢复人工、不DM、不生产晋级。
