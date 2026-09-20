## 机房手机可视化：adb 推帧器 + 获客链步骤上报接入控制塔（2026-09-20）

Brain task `1f5b9134` · PR #1884 · 路径 B · GP-Anchor `line02/keyword_acquisition keep-green`

### 根本原因

- 控制塔（决策 e14297d4）协议与页面 0830 已上线，但两库 24h 内 0 帧、生产 0 任务：机房四台手机由 crontab + 裸 adb 驱动，日志只落本机文件，没有任何东西往控制塔推。
- 之前的 n8n「Agentic Workflow Runner V2.1」把 OpenClaw V4 事件映射到控制塔（09-07/09-09 测试），但 stage 事件从未发出，8 条任务全部 executor_lost；09-14 生产链改为 harvest-cron 后彻底绕开。
- "看不见"与"要不要远程控制"是两件事：主理人只要可视化，不动 APK、不做接管。

### 这次踩到并解掉的坑

- **bash 3.2 后台子进程里 `$$` 等于父进程 PID**：多台手机并发写缓存互相覆盖；mktemp 也救不了读-改-写竞态，最终用 POSIX `mkdir` 锁串行化（macOS 无 flock），锁循环必须有上界否则状态目录不可用时无限自旋。
- **注册接口按 (tenant_id, hostname) 去重**，不是 machine_id：每台手机必须传唯一 hostname=`phone-<序列号>`，否则同机型坍缩成一行、两台互相覆盖帧。
- **执行器面 steps/complete 只认内部 token**，带了 `X-Agent-License` 会被分流到 license 路径而 401。
- **同一台手机的采收链与触达链共用状态文件会互相劫持**（22:00/08:00 交界）：状态文件按 `WALL_NS` 分命名空间，409 时遍历同序列号所有命名空间收尾并删文件，让对方退化为"忽略"。
- **触达的 start 必须放在拿到手机锁之后**：否则锁被采收占着时 start → 409 → 把正在跑的采收顶成 superseded。
- **smoke 的 grep 断言必须对去注释文本做**：挂钩行前加 `#` 原来不会红。
- **测试里不能用 spawnSync 跑脚本**：假中台跑在同一 node 进程，同步阻塞事件循环收不到响应。
- **adb 调用要有超时护栏**：macOS 无 coreutils timeout，用 `perl -e 'alarm shift; exec @ARGV'`，要求 adb 是二进制（三台机都是）。
- 计划里"帧上限改 1KB 会红"不成立（假帧只有 159 字节）；会红的方向是抬过 120KB。变异值要落在真实风险方向。

### 下次预防

- [ ] 新 bash 脚本一律 `WALL_TEST_BASH=/bin/bash` 跑一遍 3.2，且测试里用 `"$BASH"` 启动脚本，否则 3.2 验证是假的
- [ ] 任何"每台设备一个子进程"的常驻脚本：trap 带走子进程 + `sleep N & wait $!` + 子进程表按存活重建（PID 复用）
- [ ] 往控制塔报任务前先确认同一 agent 没有别的链在跑（服务端一 agent 只准一条 running）
- [ ] 守卫写完必做变异：删挂钩、注释挂钩、改上限往危险方向，三个方向各红一次才算数
- [ ] 部署到 M4/M1 后用 `GET /api/workers/<uuid>/activity` 的 `frame_age_ms` 验收，别只看卡片在线
