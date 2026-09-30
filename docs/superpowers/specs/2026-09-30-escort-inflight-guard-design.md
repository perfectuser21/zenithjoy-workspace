# Bug PrepPRD + 设计：escort 陪跑 cron 在途被注销（Commander 中途下岗）

Brain 任务 `1ebaeb00`｜决策 `3c98fb36`（阶段 1·稳）/ `fd2a22f4`（本修法）｜GP-Anchor: none(infra)

## 症状

09-30 02:30 Commander 发起 `cmd09300230`（xian-m4 legacy），wf-launch.sh 登记 escort cron
`d417a34c`（name `escort-xian-m4-cmd09300230`，agent media，每 10 分钟）。02:54:53 该 cron 被移除
（`openclaw cron runs` 记 "Cron job removed by operator"），run 随后死循环到 08:15 无人陪跑。

## 根因（已实证，证据在 Notion Issue）

删 cron 的不是别的 wf-run、不是治理 agent、不是人——是 **escort 自己**：

1. 网关日志 `~/Library/Logs/openclaw/gateway.log:109820-109821`：`11:54:46 cron.list` → `11:54:53 cron.remove ✓`（PDT）。
2. `~/.openclaw/state/openclaw.sqlite` `audit_events` 266961-266965：同一时刻 `agent:media:escort-xian-m4-cmd09300230`
   的 `gateway_exec` started 02:54:51 → **cancelled** 02:54:53 → `agent.run.finished cancelled`（自己删自己，把自己的 run 打断）。
3. 跑场机 codex 会话 `~/.codex-gwremote/sessions/2026/09/30/rollout-2026-09-30T02-53-05-01a0ee83….jsonl`
   逐条工具调用：读到 `/Users/administrator/.openclaw/m4-logs/xian-m4-live.log` 最后条目 **0918-18:00**（MMV 上的
   日志桥自 09-18 网关迁移后就是死文件）→ 判「日志停滞」写 escalation → `openclaw cron list`（title
   "Locate finished escort schedule"）→ `openclaw cron rm d417a34c…`（title "Remove finished xian-m4 escort"）。
4. 系统性复发：audit_events 09-16 起 58 次 escort run 以 cancelled 收场；09-28 五批（auto09272200/0200/0230/0600/0630）
   的 escort 分别在「批完成」前 45 分钟～3 小时 20 分被提前注销。

链路上的三个缺口：
- SOP 自杀条款只说「日志出现批完成或超 4 小时」，没说「必须是本 TAG 的批完成」、没有进程级复核，日志读不到/停滞时模型自行脑补成「已收工」。
- wf-run.sh `escort_dismiss` 只按 id 盲删，不核对 name 是否本 run（本次不是它删的，但同样的盲删在其它路径也能误杀）。
- run 在途没人守 escort：被删了没人知道、没人重拉。

## 修法（三层，同一 PR）

### ① wf-run.sh `escort_dismiss` 只删本 run 的 escort
- 先 `ssh mmv openclaw cron list --json`，按 id 找到 job，要求 `.name == "escort-$HOSTKEY-$TAG"` 全等才 `cron rm`。
- `--json` 不可用退回表格：id 必须在首列命中，且 Name 列（去掉截断的 `...`）是期望名的前缀。
- id 不在表 → 记 `escort注销跳过: id=… 已不在 cron 表`；name 不符 → 记 `escort注销拒绝: id=… name=… 非本run(期望 …)`，**不删**。
- 注销用的 id 优先读 `$ESCORT_ID_FILE`（看门狗重拉后写入的新 id），没有才用 `$ESCORT_ID`。

### ② wf-run.sh escort 看门狗：在途被移除立即重拉
- `escort_add`（从 `escort_launch` 抽出的单次 `cron add`，回显 id）供拉起与重拉共用。
- `escort_watch_start`：后台循环（`ESCORT_WATCH_INTERVAL` 默认 300s，父进程活着才跑），每轮 `escort_alive <当前id>`；
  未命中 → `escort_add` 重拉（同 name、同 session，跨轮记忆不断）→ 新 id 写 `$ESCORT_ID_FILE`
  → 日志 `escort在途被移除(id=旧),已重拉: 新id=新` + `escalate`（每次移除升一次）。重拉失败只记日志，下一轮再试。
- 生命周期同 lease 心跳：escort 确认后启动，trap 里先 `escort_watch_stop` 再 `escort_dismiss`。
- `ESCORT_ID_FILE=$HOME/wf-escort-$TAG.id`，注销时删除。

### ③ SOP（COMMANDER.md 真身 + cmdr-escort.txt 投影）自杀条款收紧
- 只允许两种收工判据：a) 日志出现 **本 TAG** 的 `[<TAG>] 批完成` 行；b) 起跑超 4 小时 **且** `node_exec pgrep -f "wf-run.sh.*--tag <TAG>"` 为空。
- 明确禁令：日志读不到/停滞/桥落后/已升级 ≠ 收工，一律禁止 `cron rm`；在途 escort 的注销权只属于 wf-run 收尾 trap（决策 3c98fb36）。
- 注销前必须 `cron list --json` 按 name 全等取 id，再 rm 那一个 id。

### 守卫（proven-to-fire）
- 逻辑守卫：`__tests__/wf-run-escort-guard.test.mjs`（假 ssh，回放 cron list/add/rm）——name 不符不删、id 不在表不删、匹配才删、看门狗重拉并换 id、注销读新 id、SOP 条款文本存在。
- 部署冒烟：`phone-adb-controller-smoke.sh` 层 6 追加 `escort_watch_start` / `escort注销拒绝` / SOP「本 TAG」断言。

## 不包含
- MMV 上 `m4-logs/*-live.log` 日志桥重接（09-18 起死文件，是 escort 误判的诱因，另立任务）。
- OpenClaw 层面的 `cron rm` 拦截 shim（`tools.exec.pathPrepend` 未配置，属网关配置变更）。

## 验收
- [ ] failing test 先 commit（commit-1），修复后变绿（commit-2）
- [ ] `node --test services/phone-adb-controller/__tests__/*.test.mjs` 全绿
- [ ] CI 全绿，合并后 `ssh xian-m4 grep escort_watch_start ~/bin-harvest/wf-run.sh`、`ssh mmv grep 本TAG ~/.openclaw/cmdr-escort.txt` 落地
- [ ] 根因写入 Notion Issues（[escort] 标题）
