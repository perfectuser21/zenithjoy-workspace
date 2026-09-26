# 抖音获客 ADB 控制器(最强版,0914 六刀融合)

纯 ADB 外驱真机 RPA:skill 层判据焊死为确定性命令,融合 Kotlin RPA(NodeAwait/DouyinCollectService)教义——等待用条件、坐标从树取、失败必归因。

## 五件套清单

| 文件 | 用途 |
| --- | --- |
| `douyin-phone-adb` | 控制器本体(zsh):设备锁/前台闸/证据链/搜索/评论采集/身份验证/触达全部命令的唯一入口 |
| `harvest-keyword.sh` | 采收 driver:按关键词跑「搜索→视频tab→逐卡开视频→开评论→采评论」全链,接 lock-refresh 心跳与原爆款作品地址 |
| `refill-profile-links.sh` | 主页直链回填:对缺 profile_url 的线索逐条走分享名片取主页直链(通杀企业号) |
| `push-leads.js` | 飞书写表:把分拣后的线索 TSV(含 11/12 列 purl 主页直链)写入飞书线索 Bitable |
| `update-profile-links.js` | 直链回写:把 refill 产出的主页直链批量回写到飞书表已有行 |

## 可视化两件(0919, 决策见 Brain task 1f5b9134)

| 文件 | 用途 |
| --- | --- |
| `phone-wall-push.sh` + `wall-lib.sh` + `com.zenithjoy.phonewallpush.plist` | 推帧器(launchd 常驻): 每台 adb 在线手机每秒 `screencap`→JPEG(≤120KB)→`POST /api/workers/<uuid>/frame`(X-Agent-License); 每 60s `POST /api/agent/register` 兼心跳(hostname=phone-<序列号>) |
| `wall-report.sh` | 上报薄壳: `start/step/note/done/fail`, 采收/触达链每阶段旁路调用(内部 token, curl -m 3, 永不阻塞); `fail` 自动带三件套 |

挂钩落点: `harvest-cron.sh`(start/fail/done) · `batch2.sh`(词级 step) · `harvest-keyword.sh`(视频级 note 续租) · `outreach-tick.sh`(start/fail)。上报器缺失或中台不可达一律吞掉,绝不阻塞采收/触达。

配置 `~/.config/zenithjoy/wall.env`(chmod 600),三个键: `ZJ_API_BASE` / `ZJ_LICENSE` / `ZJ_INTERNAL_TOKEN`(值从 1Password CS Vault 取,不写进 repo)。

部署(xian-m4 / M1 各一遍):

1. `scp wall-lib.sh phone-wall-push.sh wall-report.sh harvest-cron.sh batch2.sh harvest-keyword.sh outreach-tick.sh` → `~/bin-harvest/`(`chmod +x`)
2. `scp com.zenithjoy.phonewallpush.plist` → `~/Library/LaunchAgents/`,写好 `wall.env` 后 `launchctl load -w ~/Library/LaunchAgents/com.zenithjoy.phonewallpush.plist`(stderr 在 `/tmp/phonewallpush.err`)
3. 看: Dashboard「工作机」页 `/dashboard/workers`,每台手机一格,帧每秒刷新、当前步/失败三件套随上报变化

## 六刀融合表

| 刀 | 内容 |
| --- | --- |
| 刀1 | 删烂死死函数 `ui_evidence_retry`(0914 已删,smoke 层3b 防复活) |
| 刀2 | 剪贴板 COPY_STALE 守卫(抄 Kotlin `clearClipboardBaseline` 教义:先记基线再复制,回读相同=陈旧即报错) |
| 刀3 | 触达命令适配 Lynx(首卡固定位+抖音号强校验,防把私信发给同名人) |
| 刀4 | `foreground_gate` 前台闸(插屏弹窗白名单点掉,「允许」永不入白名单——授权类弹窗必须人裁) |
| 刀5 | `die` 三态归因 `failure_class=NO_ROOT/WRONG_FOREGROUND/TARGET_ABSENT`,上层不再猜根因 |
| 刀6 | `lock-refresh` 活锁心跳(长任务续锁,防锁过期被并发抢占) |
| 刀7 | 先探后睡(500ms 步进探前台,状态到了立即走,不再盲 sleep) |

## 命令总表(douyin-phone-adb)

### 状态/诊断
- `status` — 设备与前台快照
- `diagnose` — agent 诊断行(排障第一现场)
- `preflight` — 开工前四项检查
- `foreground` — 读当前前台包名/Activity
- `telecom` — 通话状态(idle/ringing/offhook)
- `window` — 窗口焦点信息
- `refresh` — 刷新设备状态缓存

### 设备锁
- `lock-acquire` — 拿设备锁(带持有者/TTL)
- `lock-status` — 查锁归属
- `lock-refresh` — 活锁心跳续期(刀6)
- `lock-release` — 释放锁

### 基础操控
- `wake` / `unlock` — 亮屏/解锁
- `open-app` / `close-app` — 起停指定应用
- `tap` / `swipe` / `back` — 裸点/滑/返回
- `tap-snapshot` / `swipe-snapshot` / `back-snapshot` — 操作后带截图
- `tap-evidence` / `swipe-evidence` / `back-evidence` — 操作后带截图+UI树全证据

### 证据链
- `screencap` — 截屏
- `pull` — 拉取设备文件
- `snapshot` / `snapshot-evidence` — 截图快照(裸/带证据编号)
- `ui-evidence` — UI 树证据落盘
- `evidence-bundle` — 按前缀打包一次动作的全部证据

### 搜索/发现
- `open-search` — 打开抖音搜索入口
- `search-time-layer` — 按时间层+排序+时长筛搜索(six_months/most_liked 等)
- `search-video-tab` — 搜索结果切「视频」tab(综合 tab 永不 idle,必切)
- `search-video-cards` — 读视频 tab 静态网格,输出可点卡片 TSV
- `open-video` — 用 deeplink 确定性直开指定视频详情页

### 评论采集
- `open-comments` — 树优先取坐标打开评论面板(零评论拦截)
- `collect-comments` — 读评论面板输出 TSV(昵称/正文/日期/地区/头像tap坐标/b64)
- `commenter-identity` — 按头像坐标进主页验出抖音号身份
- `commenter-card-link` — 他人主页分享名片取主页直链(sec_uid,通杀企业号)
- `current-video-link` — 取当前视频分享链接(原爆款作品地址)

### 账号/触达
- `account-current` — 读当前登录账号
- `account-switch` — 切换到指定抖音号
- `private-message-send` — 私信触达(见下方安全声明,默认关闸)

### 播放/录制
- `set-playback-speed` — 设播放倍速
- `record-start` / `record-status` / `record-stop` — 录屏起/查/停
- `record-extract-audio` — 从录屏抽音轨(喂 ASR)

### 视觉兜底
- `locate` — 视觉模型定位元素坐标
- `locate-tap` — 定位并点击

## 部署三步

1. `scp douyin-phone-adb` → xian-m4 / M1 的 `~/.local/bin/`(`chmod +x`)
2. `scp harvest-keyword.sh refill-profile-links.sh` → `~/bin-harvest/`
3. `docker cp push-leads.js update-profile-links.js` → us-vps `openclaw-gateway:/root/.openclaw/`
4. `~/.credentials/brain.env`（`chmod 600`，两行 `BRAIN_URL=https://<brain>` / `BRAIN_INTERNAL_TOKEN=<CECELIA_INTERNAL_TOKEN>`，值取自 1Password CS）——账本 `wfr stage|finalize` 据此回执 Brain `execution-callback`；缺文件只是回执跳过（`harvest-cron.log` 无 Brain 单行、stderr `brain callback skipped`），不影响采收

## 基座 1/7：v4 流水线（账本 + 阶段工件 + 续跑）部署与影子跑

新增件 → 落点（xian-m4 / M1 各一遍）：
1. `scp ledger.mjs workflow-result.sh harvest-cron-v4.sh batch2-v4.sh` → `~/bin-harvest/`（`chmod +x` 三个 .sh）
2. 账本/工件目录自动建在 `~/.config/zenithjoy/{ledger,workflow-runs}/`；工件收工 best-effort scp 到 MMV `workflow-runs/`
3. 依赖：`/opt/homebrew/bin/node`、`/usr/bin/jq`、`python3`（均已在 M4）
4. 探针读回（棒3b，决策 95e29afd：执行机只读回、Brain 只判定；棒3b-2，决策 8f38f5fd：读回**经 ssh 在 MMV 跑**——leadgen PG（zenithjoy 库）只在 MMV `127.0.0.1:5432` 监听、飞书凭据 `~/.openclaw/clawdbot.json` 也只在 MMV，09-26 实证执行机本地跑三条全 error）。落点是 **MMV** `~/.openclaw/leadgen-scripts/`：`scp verify-step.mjs` + `scp -r checks/`（probes-lib.js / schema.json / social-keyword-leadgen.yaml）→ 该目录；`line-routes.js` / `leadgen-db-connect.js` 那里已有（与 push-videos.js 同源，须与 main 一致，`shasum -a 256` 对一下）；`pg` 已随 push-videos.js 装好；凭据 MMV 已有（`~/.credentials/zenithjoy-db.env` 由远端命令 `source`，飞书退回 `clawdbot.json` 的 `accounts[routeOf(line).account]`）。**xian-m4 / M1 不再需要** node 侧探针文件、`checks/`、`zenithjoy-db.env`、`feishu.env`：`workflow-result.sh` 的 `probe_stage` 经 `ssh -o ConnectTimeout=20 mmv "set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; cd ~/.openclaw/leadgen-scripts && node verify-step.mjs …"`（与 batch2.sh:55 推 push-videos.js 同一条）执行，主机/目录可用 `WFR_PROBE_HOST` / `WFR_PROBE_DIR` 覆盖；本机无 YAML 时按 `WFR_PROBE_STAGES`（默认 `delivery scoring`，checks 单测钉住与 YAML 一致）决定哪些 stage 走 ssh。ssh 失败/超时/非 JSON → 该 stage `probes=[]` + stderr `WFR_WARN … verify-step via ssh`（Brain 侧按 probes 缺失判），远端 `verify-step:` 单条 error 行原样透传进 `harvest-cron.log`；采收本身不受影响。自检：`ssh mmv 'cd ~/.openclaw/leadgen-scripts; set -a; . ~/.credentials/zenithjoy-db.env; set +a; node verify-step.mjs --stage delivery --run-tag <昨晚TAG> --line-key jinoshengyuan-work'` 应打一行三条含 `observed` 的 JSON（`--line-key` 传 profile 名即可，verify-step 经 `routeOf().key` 归一成库里的路由键；`videos_readback` 与 `line_key_not_null` 同 WHERE，同 TAG 下前者计数 == 后者行数）

影子跑（切 crontab 前必须 2 晚，PrepPRD 拍板）：
- crontab 加一行（与生产错开 15 分钟、`PUSH=0` 不落池）：`15 22 * * * /bin/zsh ~/bin-harvest/harvest-cron-v4.sh jinoshengyuan-work ANGYVB4227006983 AI人工智能训练师 6 0`
- 每晚验收：`~/.config/zenithjoy/ledger/social-keyword-leadgen-crontab-auto*/ledger.json` 里 preflight/discovery/collection/delivery/cleanup 为 completed（delivery 在 PUSH=0 时为 blocked，正常）、qualification/scoring 为 blocked not_in_profile；工件每个含 `task_request_hash` 且 `jq -e '.schema_version==2'`；`harvest-cron.log` 有 `escort复核命中` 与 `账本finalize: ok=1`；MMV `~/.openclaw/escort-findings.md` 当晚有新行；`night-auto*.tsv` LEAD ≥ 近 7 天均值
- 2 晚齐 → 把生产两行 `harvest-cron.sh` 指向 `harvest-cron-v4.sh`
- 正常退让（设备离线/白天时窗/KPI 达标/词单失败）路径 `harvest-cron.log` 只会出现 `账本finalize: skipped(not_initialized, 正常退让)`，不 escalate、不写工件——这是预期，不是故障
- hash 不一致时的工件是 `…__aN.discovery.0.worker-result.json`（哨兵 n=0，词序号从 1 起，不会覆盖已完成词的账本记录）
- 账本里每次阶段写入都记一条 item `{n, word}`（init/finalize 写的 preflight/qualification/scoring/cleanup 的 word 为空串），续跑只看 discovery∩collection 都 completed 的非空 word

环境守卫的 proven-to-fire（影子跑期间各做一次，记录到 PR）：
- escort 真活：拉起后手动 `ssh mmv openclaw cron rm <id>` → 30s 后 `harvest-cron.log` 出现 `escort复核未命中` 且 escalation.log 新增一行
- 工件落地：起跑前 `chmod 000 ~/.config/zenithjoy/workflow-runs` → 收工 `账本finalize: ok=0` 且 escalation 新增；恢复 `chmod 755`
- 孤儿 escort：手动 `ssh mmv openclaw cron add --name escort-xian-m4-fake …` 留一条 → 下批起跑日志出现 `孤儿escort清理: <id>`

harvest-keyword.sh 出口码契约（v4 依赖，勿改）：`3` 锁被占 / `1` open-search 失败 / `0` 正常或无卡片。

后续（不在本 PR）：`workflow-manifest.json` `orchestrator.type` n8n→commander、n8n「Social Leadgen V4」标 inactive（hk-vps，先复核发布版≠草稿）、scoring 闭集键口径修正归基座 7/7、`decisions/match` 疑似写库副作用、escalate 目标主机 us-vps 已退役需评估改 MMV。

## 安全声明

触达命令 `private-message-send` 机械已修,但 `outreach_policy.enabled=false`(默认关闸)。真实发送需主理人批话术、批发送账号、批频控,AI 不得自行触发。

## 守卫

`.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`(已在 Smoke Glob Gate 基线内):五件套存在性+zsh/node 语法闸+六刀签名存在性+烂死模式检测(变量展开尸块/死函数复活),proven-to-fire 验证过报红能力。

## 探针文件(写完读回的 SSOT,决策 702949b6 / e2cef2c9)

`checks/social-keyword-leadgen.yaml` 是"写完读回"断言的唯一真身(同 dbt tests / Dagster asset checks)。v4 delivery 里 `readback_verified:0` 的硬编码(batch2-v4.sh:68/70/74)由它替代:每条探针声明 `stage / journey_cell / probe(sql|http) / expect / severity / note`,SQL 与飞书取法按真实写入方写(视频双写 PG `leadgen_videos`,评论只落飞书原始评论池),占位 `$RUN_TAG`(=harvest-cron-v4.sh 的 TAG)/`$LINE_KEY`/`$WORD`。

- 形状由 `checks/schema.json` 守:stage 只能是 workflow-result.sh 的 7 个阶段,op ∈ `>= == <= not_null_all`,severity ∈ `warn|error`,`expect.ref` 只能引 workflow-result.sh `req_keys()` 的闭集 metrics 键(单测从脚本实时抽取,不抄副本)。
- 加载/校验层 `checks/probes-lib.js` 零依赖(CI openclaw-scripts-test 不装依赖),守卫 `__tests__/checks-social-keyword-leadgen.test.mjs`,坏 stage/op/severity/ref 都 proven-to-fire 报红。
- Brain 侧:cecelia 仓 `scripts/sync-step-probes.mjs` 读本文件登记 sha256 到 `step_probes`,并把 journey cell 的 `assertion_ref` 写成 `probe:<key>`。**改探针 = 改 YAML 发 PR**,不在 Brain 里手改;哈希漂移由同步脚本发现。
- 首发五条全 `warn`(观察一轮真实 run 再升 error):delivery `videos_readback` / `comments_readback` / `line_key_not_null`,scoring `pool_advanced` / `effective_count`。
