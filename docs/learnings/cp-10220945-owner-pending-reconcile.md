## Commander未知pending恢复与真实锁提交（2026-10-22）

### 根本原因

原owner reservation只有当前调用闭包能归档returned/not_started。CLI或Gateway中断后，旧pending保守阻止后续turn，但缺显式单owner维护对账入口。恢复必须保原run/binding/source/task/session与nonce/inode/rawSHA；当前官方inactive只能支持reconciled_inactive，不能追认旧turn成功、全集原生停止或释放手机。

第一候选08aed将内核锁交给helper，但最终CAS/rename仍由Node根据child.exitCode/signalCode缓存决定。独审实际终止helper并同步阻塞事件循环150ms后，旧候选仍清掉pending，形成真实P1。已有await60ms的死亡测试先处理了退出事件，漏掉检查与动作间竞态；原FAIL及两条真实RED保持。修复将创建pending、最终CAS、归档和rename移入真实持flock的helper；父共享同一open-file-description直到close。新固定68e9源码独审通过，相关101项通过。正常returned与not_started也沿同一内核提交入口等待回执。

提交已完成但ACK丢失仍报unknown，只读原件和receipt，不重发归档、不回滚pending。坏nonce/错inode/活跃队列/子agent/缺读回仍拒；无手机锁释放、SQLite写或服务重启。旧业务失败与unknown保持，完整正式CI及后续生产维护、真实业务验收单独记账。

### 下次预防

- [x] 将状态写入与锁权放在同一实际持锁进程，永久覆盖SIGKILL后不poll事件循环的maintenance和returned反例；不能以kill(pid,0)或缓存退出字段代替。
- [x] 同时覆盖ACK丢失的只读回查、不重发不回滚；当前无新增待自动派发编码项，生产维护与业务未知仍由原任务跟进。
- [x] 真实方法闭包逐12ref变异核验，独立五键批准后才用官方生成器；源码测试、正式CI、软件交付与业务成功分别留证。
