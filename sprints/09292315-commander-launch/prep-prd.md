# 小改动 PrepPRD：Commander 当入口——OpenClaw 召唤 Commander 发起 workflow run

## 改什么
- `services/phone-adb-controller/commander/wf-launch.sh`：Commander 发起 run（校验能力已部署 → 设备忙互斥 → 写源列表 → 登记 escort → ssh 执行机 nohup `wf-run.sh --tag --commander` → 回读 `WF_RUN_STARTED`）。
- `services/phone-adb-controller/commander/wf-status.sh`：只读查 run 现状。
- `services/phone-adb-controller/commander/skills/workflow-commander/SKILL.md`：work-commander 的召唤/串 workflow skill（SSOT，部署到 MMV 的 clawd-work-commander/skills/）。
- `COMMANDER.md`：入口改为 Commander（决策 7f842d12）。
- deploy.sh：commander/ 下的件同步到 mmv。

## 为什么改
主理人 09-29 拍板：定时或对话先拉起 Commander，由 Commander 去跑 workflow；此前 Commander 只是 harvest-cron 第⓪步，OpenClaw 里召唤不了任何 workflow。

## 关联上下文
- 决策 7f842d12；Brain 任务 338e3ec7
- 执行器 wf-run.sh / wf-plan / 契约 runtime 字段在并行 PR（runner），对标发现在并行 PR（bench）
- work-commander 模型已改 anthropic/claude-sonnet-5（codex 运行时会话跑在跑场池，exec 落点不固定；Claude 原生运行时 exec 在网关本机 MMV，已实测能 ssh xian-m4 与操作 openclaw cron）

## 影响范围
新增文件为主；旧 crontab → harvest-cron 路径不受影响（harvest-cron 薄壳由 runner PR 负责）。

## 判定点
| 判定点 | 候选 | 所选 | 依据 | 误判后果 |
|---|---|---|---|---|
| 起跑成功 | ssh 返回码 / 回读起跑标记 | 回读 `WF_RUN_STARTED` | nohup 后台启动 ssh 恒成功 | 起跑失败被当成功 → 撤 escort 并报错 |
| 设备忙 | 锁文件 / pgrep | pgrep 同 serial 的 wf-run/harvest-cron | 锁在 harvest-keyword 内才拿，启动时拿不到 | 叠跑两批抢一台手机 |

## 验收标准
- [ ] 单测：参数校验、能力未部署退 4、设备忙退 3、起跑命令形状（--tag/--commander/--sources）、未见 WF_RUN_STARTED 撤 escort 退 5
- [ ] 真机：OpenClaw 召唤 work-commander → 手机上真跑一批（xian-m4 legacy，02:00 窗口）
- [ ] CI 全绿
