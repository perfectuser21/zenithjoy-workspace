# 手机预检失败的无资源收尾

GP-Anchor: line01/android_worker_publish keep-green

真实离线预检在领锁前失败，旧外壳仍要求打开过应用后的桌面清理，导致无资源运行卡在 cleanup_pending。无资源判定不能从缺 lock-acquire 文件推导：RPC 发出后、finally 回执落盘前可能被杀，锁后来过期也会显示 free。

修复把首个潜在领锁/设备动作的 intent 在发送前原子持久化。仅同 run/attempt/root 的失败预检原件与归档哈希吻合、没有动作 intent、在 spawn 共用锁内重新确认未领单且控制器精确 free，才完成 no-resource 清理。预检 ADB 刷新作为诊断动作明示。活动事实仍是 preflight fail、cleanup pass，交付仍 failed；不得生成业务成功事实。

永久回归同时覆盖 worker 锁外 no-spawn 判断的竞态：检查和封闭必须在同一把 launch 锁内。历史状态缺正证保持失败，不能用新代码给旧运行补编证明。
