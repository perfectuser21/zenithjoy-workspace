# 小改动 PrepPRD：escort 三份投影与三档权限对齐 + Commander 平滑收工正规入口（stop 文件）

Brain 任务 `2fc3b6fc-4a73-4a3b-8711-bee8ec1a23b8`（阶段 2 补，决策 3c98fb36 / 018e4e84，本次决策 ce4849e0）。

## 改什么

1. **三份投影按宪法三档重写权限段**（真身 `COMMANDER.md` #2043 已是三档，投影仍写「无杀权 / 绝不终止 run / 帮不拦」）：
   - `services/phone-adb-controller/cmdr-escort.txt`（escort SOP，deploy.sh 同步到 MMV `~/.openclaw/cmdr-escort.txt`）
   - `services/phone-adb-controller/cmdr-stream.txt`（stream 哨兵 SOP，同上）
   - `services/phone-adb-controller/escort-claude-escalation.sh`（分身唤起词，落 US-Mac `~/bin/`，LaunchAgent `com.zenithjoy.escortclaude`）
   - 三档：自动做（可逆、不出本 run：平滑收工 / 重启抖音 / 唤醒解锁 / 重试瞬时失败 / 重拉 escort / 补落池 / 写复盘）、Bark 请示（删数据 / 改 crontab 或配置 / 重启健康容器 / 切换抖音登录号，附 Bark 命令）、只报不做（改代码）。
   - 保留：帮不拦（不判 FAIL 不扣格子）、先动手后汇报、读不到就说读不到、注销权只归 run 收尾、心跳条款、救活权例外。
2. **平滑收工的正规入口**：此前执行器只认 deadline（#2036），Commander 想收工只能 kill（破坏手机现场、锁不放、账本 lost）。新增 stop 文件约定：
   - `wf-run.sh` 起跑 `export WF_STOP_FILE=~/wf-runs/<TAG>.stop`（先 `mkdir -p`、清残留），收工 finalize 后删除。
   - `wf-limits.sh` 新增 `wf_stop_requested`（stop 文件存在即 rc 0）与 `wf_stop_reason`（打印 `deadline` / `commander_stop` / 空）。
   - `batch2.sh` 词边界、`harvest-keyword.sh` 等锁循环与视频边界：检测到 stop 文件即走 deadline 同一路径（不开新词/新视频、已采落池分拣、放锁），stdout `BATCH2_STOP_REASON=commander_stop`。
   - `wf-run.sh` 读到 `commander_stop` → `WFR_FINAL_REASON=commander_stop` → 账本终态 `partial reason=commander_stop`（复用 workflow-result.sh finalize 既有分支）。
   - 投影写明：**平滑收工 = 在执行机 `touch ~/wf-runs/<TAG>.stop`（escort 用 nodes exec，分身用 ssh），禁止 kill -9 / kill 任何 wf-run、batch2、harvest-keyword 进程**。
3. `COMMANDER.md` 平滑收工定义句后补一句具体命令；`commander/AGENTS.md`、`workflow-commander/SKILL.md` 三档行同步补 stop 文件写法。

## 为什么改

阶段 2 #2043 只改了真身，投影仍写无杀权，与决策 018e4e84 冲突，escort/哨兵/分身仍按旧宪法行事；且「平滑收工」在真身里只有定义没有可执行入口，投影写了也没法做。

## 关联上下文

- 相关 Journey/Ability：line02 关键词获客（`keyword_acquisition`）、对标链接获客；执行器 wf-run / batch2 / harvest-keyword。
- 相关历史决策：3c98fb36（阶段 1/2）、018e4e84（与有头会话同权三档）、7d150e33（整批总时限平滑收工）、e8f872cb、7f842d12。
- 在途相关任务：975aa6ec（MMV 日志桥重接，改的是日志路径，不碰权限段）。

## 影响范围

- 执行器：无 stop 文件时行为与 #2036 后逐字一致（`wf_stop_requested` 缺 `WF_STOP_FILE` 恒 rc 1；旧部署缺库时兜底桩同样恒不停）。
- 账本：`partial reason=commander_stop` 只是 reason 字符串不同，finalize 逻辑不变。
- 投影同步：cmdr-escort.txt / cmdr-stream.txt 由 deploy.sh（GHA deploy-phone-adb-controller）落 MMV；escort-claude-escalation.sh 落 US-Mac `~/bin/` 需本机 cp + `launchctl kickstart -k gui/$(id -u)/com.zenithjoy.escortclaude`（deploy.sh 只把它送到 xian-m4/m1 bin-harvest，不覆盖本机）。
- 今晚 22:00 起 xian-m4 生产批在跑：deploy 原子替换脚本（mv 换 inode），在跑进程继续读旧 inode，不受影响。

## GP-Anchor 声明

GP-Anchor: line02/keyword_acquisition keep-green

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| Commander 何时算「请求收工」 | a) 发信号 SIGTERM 给 batch2 b) 写 stop 文件 c) 改 Brain 状态让执行器轮询 | b) stop 文件（`~/wf-runs/<TAG>.stop`） | 与 deadline 同在词/视频边界判、零外部依赖、escort 用 nodes exec 一条 touch 即可、误 touch 可 rm 撤回 | 误 touch 只会提前平滑收工（partial，已采不丢），可逆 |

## 验收标准

- [ ] 失败测试先行：`__tests__/commander-projection-sync.test.mjs` 在改投影前红（三份投影不得含「无杀权」「绝不终止」，必含「三档」「平滑收工」「.stop」，禁 `kill -9`）
- [ ] stop 机制行为测试：batch2 词边界 / harvest-keyword 等锁与视频边界 / wf-run 假机整链 finalize `partial reason=commander_stop`
- [ ] 全量 `node --test services/phone-adb-controller/__tests__/*.test.mjs` 绿；既有守卫 commander-positioning / wf-run-escort-guard / *-run-deadline 不受影响
- [ ] CI 全绿，合并后 deploy 落地：MMV `~/.openclaw/cmdr-escort.txt`、xian-m4 `~/bin-harvest/batch2.sh` md5 与 main 一致；本机 `~/bin/escort-claude-escalation.sh` 已 cp 并重启 LaunchAgent
