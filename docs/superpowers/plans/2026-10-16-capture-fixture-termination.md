# 录制模拟器退出修复实施计划

> 执行代理：在当前隔离 worktree 按 executing-plans 逐项实施，独立代理审查；每项先 RED 提交再实现。

**目标：** 消除负例模拟 shell 的退出 argv 竞态，完整保留生产身份与停止门槛。

**结构：** 只改 continuous-identity 测试 helper 及原负例。默认仍 graceful；显式 verified_escalation 且 normal owner 才记录 INT/TERM 并继续存活，交由真实控制器安全升级 KILL。新鲜 ps gone/Z 与控制器停止原件共同构成停止证据。

**技术：** node:test、真实 zsh 模拟进程、真实 Python 录制守卫、Node22.23.3。

## 任务1：模拟生命周期

文件：services/phone-adb-controller/__tests__/continuous-identity.test.mjs。

- [ ] 在原负例加入 `assert.equal(r.fixtureExitAtReturn,'gone')` 和 `assert.ok(r.captureSignalSeen.includes('TERM'))`；保留原全部断言。使用原 Node22 白名单运行负例，观察确定性失败并提交 RED。
- [ ] helper 参数增加 `captureStop='graceful'`。仅 `captureStop==='verified_escalation' && captureOwner==='normal'` 的 fixture 使用 `trap 'print INT >> "$FIXTURE/capture-signal-seen"' INT` 与对应 TERM trap，不 exit；其余保持原 trap。
- [ ] 返回前用真实 `/bin/ps -p PID -o stat=` 判定 gone/Z、alive、unknown；仅真实 gone 与相应信号证据共同给出 stoppedBeforeHarnessCleanup，返回 signal_seen。不对不明身份发信号，不改 finally。
- [ ] 指定拒绝负例、completed_alive 观测、5秒 workflow reserve 显式选择该策略；foreign/unknown 请求同策略仍验证不生效，成功与9秒增长正例保持默认。
- [ ] 目标 GREEN、4并发小目标、原成功/foreign/unknown/reserve通过，提交实现；独立审查准确字节。
- [ ] 原 `bash scripts/smoke/leadgen-split-smoke.sh` 用官方 Node22.23.3与白名单完整执行一次，原300秒限制不变，完整保存输出。

## 任务2：正常发布配套

- [ ] 只把 report1.0.26→1.0.27、commander2.0.25→2.0.26、single/batch0.1.17→0.1.18、maintenance0.1.16→0.1.17，验证移除顶层version后完整对象及其他字节不变。
- [ ] scripts/ci/__tests__/commander-skill-freeze.test.mjs 同步两名称/两正例版本；固定 f99 Brain 与全部绑定/verified断言保持。
- [ ] 正常Source静态、methods baseec、product-map/diff校验；独审后按 finishing→ship→仅本PR watchdog 推进。
- [ ] 真main后新 author/独立QA、5/4/20、API staging/生产及官方三scope Pilot；只有真实bundle就绪才交根部署。
