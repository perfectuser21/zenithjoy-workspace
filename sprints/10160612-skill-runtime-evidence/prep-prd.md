# 真实接手运行的回执与录制就绪修复

Task：870eb051-4e57-4ae9-bdde-40e6323d04db，继续原修复，不重复建研发单。
GP-Anchor: line02/keyword_acquisition keep-green
Base：fef1f5619b83323125e47df00b0ac177c7efea51。

## 实际故障与范围

- fef1 正式整包已独立安装通过；真实101取得5个链接并独立核验通过。
- 102连续两份录音真实验证通过，但第三个scrcpy子进程仅停在设备连接日志，无Recording started与mkv；原启动函数只根据进程存活发成功回执。
- 这次自然失败实际触发父唯一spawn/官方child终态；child因自行选用被当前子会话策略排除的session_status而安全阻断，0工具/0resume。源任务没有硬写必须调用该工具。
- Skill返回partial且无result时，主记录器把外层partial直传只接受blocked等状态的ledger，产生次生写账错误。

保留现有业务I/O、资格与评分政策、原任务/nonce/原slot/租约/独立verify以及发送保护。第三条失败、两条成功和所有旧失败记录分别保留，不用新结果覆盖旧事实。

## 最窄修法及判定点

1. 主记录器把外层partial/paused/skipped与现有内层同类结果统一映射到blocked账本状态；failed仍failed，保留原原因，不扩账本枚举或冒completed。
2. 录制启动在有限预算内核同eid新日志中的精确目标Recording started、真实非空媒体及仍属于本次的活进程；未就绪先停止并确认本人的进程，终止未知继续原隔离，不杀其他进程/不重启共享ADB。
3. 明确子会话使用已安装官方subagents(action=list)服务端callerIsSubagent/callerSessionKey严格核对父官方binding；工具缺失或身份不符仍阻断，不改工具权限，不拿模型自述当身份。实际只读caller+宿主协议须先独立验证；原nonce/来源/官方bind/wait/backend authority均保持。

## 测试策略

先提交真实RED回归，再实现；产品与测试按TDD顺序提交。账本回归执行主程序真实映射表达式与原ledger CLI；录制夹具运行实际生产函数，覆盖慢就绪/活PID未就绪/早退/旧日志/错路径/空文件/精确停止/未知或外来PID。child提示合同与实际官方只读tooltrace分别验证，不能拿夹具冒实机接手。

CI保持全部门禁；方法正文/支持/业务合同不变时只按官方守卫与独立精确前后digest做Code兼容登记，不能盲刷新。最终Source五版本正常续版、同源Pilot与完整原生安装/独立验收另做。当前不改生产、不重跑手机、不动C暂停/迁移flag/保护收件人。

## 验收

- 实际partial回执不再变成账本次生错误，原失败保真。
- 活进程但未开始录制不能发record_started；未知执行仍不接手/清场。
- 子会话身份来源为实际官方caller字段，错key/非子会话/缺字段安全阻断；不增权限。
- 正式PR/同HEAD CI/独立Code与RPA审查通过；随后新Source与实际安装、业务、同slot接手分别验收，未实测项不勾通过。
