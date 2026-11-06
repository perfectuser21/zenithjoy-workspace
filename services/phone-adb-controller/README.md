# 抖音获客 ADB 控制器(最强版,0914 六刀融合)

纯 ADB 外驱真机 RPA:skill 层判据焊死为确定性命令,融合 Kotlin RPA(NodeAwait/DouyinCollectService)教义——等待用条件、坐标从树取、失败必归因。

## ADB 宿主管理（任务 c9eff684-0f1a-48df-b694-9459216ee81e）

管理归属：基础设施部／系统看护／设备与手机台账。代码真身在本目录，设备与租约以 Brain 为准。M4 的实体 USB 使用一个受管服务；MMV 云手机保留自己的网络入口，不复制 M4 的策略、密钥或隔离状态。

普通业务使用 `adb-managed-client.py`，由本人私有的 `~/.config/zenithjoy/adb-service.json` 固定宿主与端点。坏配置、额外服务、错误端口、设备不在线均报错；普通调用禁止 `start-server`、`kill-server`、`connect` 等生命周期命令。受管策略尚未安装的宿主保留原入口，不能据源码已发布就声称完成切换。

正式发布先沿原 Source／Pilot／部署关卡交付代码，保持原设备 all-free barrier。之后维护者另持四台设备的中央租约和正式本地维护锁，运行已安装目录的 `adb-host-maintenance.py plan`，核对计划摘要，再运行同一版本的 `apply`。入口会核实际 M4 用户、来源文件字节、任务归属、端点、旧进程身份和 sudo 权限；不操作未知进程。`install-adb-host-service.sh` 只暂存，不激活。

维护完成后独立读回 `adb-host-service.py status --config "$HOME/.config/zenithjoy/adb-service.json"`、launchd 实际子进程与各 serial；再释放本人维护锁。退出码成功或服务只剩一个，不代表四台设备都在线，更不代表获客验收成功。中途失败保留 `~/.config/zenithjoy/adb-maintenance.journal.jsonl` 与业务锁，禁止删除 journal 重放；先核清现场再处理。

## 102 公司绑定与失败清场

正式冻结的101/102在首个设备动作前核同一公司、租户、版本、run、设备与账号的PG绑定；102以私有文件将绑定传给原生收件人证据核验。宿主名称不决定租户身份，M4仍保留本机账号登记核验。Honor的e1b/fod/jqh/kj+布局按唯一原生面板配对识别，仍逐项核UID、昵称、评论全文与包名；作者评论过滤后即使已到底也可以合法为0条，不能据此制造客户评论。

`cleanup_phone_scope`只在原进程、同run及完整已归还叶请求下授权原收尾活动。非零业务退出不等于未知执行，但该能力不允许Skill读回、resume或重新collect；序列化、复制、改名均不能取得能力。原生`execution_stopped=false`、原业务失败和错误证据保留，不将手机域归还声称为OS任意后代已停止。既有失败run不从磁盘重建此能力，现场维护须另走独立审查与固定工具。

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

1. `scp wall-lib.sh phone-wall-push.sh wall-report.sh harvest-cron.sh batch2.sh harvest-keyword.sh outreach-tick.sh workflow-result.sh ledger.mjs` → `~/bin-harvest/`(`chmod +x`)
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
- `tap-evidence` / `swipe-evidence` / `back-evidence` — 操作后带截图+UI树全证据(`tap-evidence` 支持 `--outward`、取证有界与退出码 3,见下方「对外动作账」)

### 证据链
- `screencap` — 截屏
- `pull` — 拉取设备文件
- `snapshot` / `snapshot-evidence` — 截图快照(裸/带证据编号)。0929 起凡产出截图的命令(含 `*-snapshot`/`*-evidence`/`pull`/`locate-tap`/`current-video-link`/`search-time-layer`/`private-message-send`)都在原图旁生成同名 `.jpg`(宽720/质量70,约180KB),输出 `jpg=`/`*_jpg=` 行;agent 回传只 `file_fetch` jpg,原图 PNG 约3MB 会堵死节点 ws 通道。`screencap` 只落手机端,不产本地文件
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
- `account-current` — 读当前登录账号。昵称只认与「抖音号：」左对齐的上方 TextView(拒绝计数类文本如未读角标 `11`),读不准有界重抓 2 次,仍不准输出 `nickname=unknown`。读号前必须自证是**自己的**主页(「编辑主页」/「切换账号」在且无「私信」按钮),落在他人主页先 verified back 再点「我」,仍不是自己主页就报错退出——宁可读不到不能读错(0930 误读他人号事故)
- `own-profile UI_XML` — 纯判定(不碰设备):一份 UI 树是否自己主页,输出 `profile_kind=own|foreign|partial|none`
- `account-switch` — 切换到指定抖音号
- `private-message-send` — 私信触达(见下方安全声明,默认关闸)

### 素材下发/文字输入(写设备,必须持锁,1010 任务 8fdeaeb4)
两条命令都要用全局 `--lock-owner RUN` 声明调用方 run;锁空闲/属于别的 run/超 TTL 一律拒绝,不碰设备。
成功输出**一行** `key=value`;失败 stdout 一行 `<cmd>=fail class=<分类> reason=<代码>`,stderr 人话 + `failure_class=<分类>`,退出码 2。
分类:`empty_ok`(无事可做,退出码 0)/`retryable`(重试可能成功)/`fatal`(参数或协议错,重试无用)/`needs_human`(设备需人处理)。
- `media-push LOCAL_FILE [--name VID_yyyymmdd_hhmmss.mp4]` — 推到 `/sdcard/DCIM/Camera/`,缺省按当前时间生成相机风格文件名(mp4→`VID_`,jpg/jpeg/png→`IMG_`,可带 `_N` 序号),拒绝覆盖同名;回读大小一致 → 发 `MEDIA_SCANNER_SCAN_FILE` → 轮询媒体库查到同大小记录才算成功。
  例:`douyin-phone-adb --profile p1 --lock-owner RUN media-push /tmp/a.mp4` → `media_push=ok path=/sdcard/DCIM/Camera/VID_20261010_153000.mp4 name=VID_20261010_153000.mp4 size=2048 media_id=4242 scan=indexed`
  失败码:`lock_owner_required`/`lock_not_held`/`lock_stale`/`local_file_missing`/`local_file_empty`/`unsupported_media_type`/`bad_media_name`/`remote_name_taken`/`target_model_mismatch`(fatal);`target_offline`/`push_failed`/`size_mismatch`/`media_not_indexed`(retryable,残缺/未入库文件已删)
- `text-input UTF8_TEXT` — 向**当前焦点 EditText** 输入(先清空再输入,调用前先点中输入框):切 ADBKeyboard(未装/启不了明确报错)→ `ADB_INPUT_B64` → uiautomator 回读焦点框文字须逐字一致;**无论成败**都还原原输入法并回读确认。
  例:`douyin-phone-adb --profile p1 --lock-owner RUN text-input '今天发一条 #AI 学姐'` → `text_input=ok bytes=33 sha256=<hex> field=com.ss.android.ugc.aweme:id/xxx ime_restored=com.baidu.input_huawei/.ImeService evidence=<xml>`;空文本 → `text_input=empty_ok bytes=0`
  失败码:`no_focused_input`/`ime_switch_failed`/`readback_mismatch`(retryable);`adbkeyboard_not_installed`/`adbkeyboard_enable_failed`/`ime_unreadable`/`ime_restore_failed`(needs_human);`bad_text`/锁类(fatal)

### 对外动作账 / 锁回执证据 / 点击取证有界(1010 任务 d1b395c7)
给独立核验员(run-verify)留**可回读的凭据**,不靠执行者自述。证据都落节点 `/private/tmp/openclaw-phone/evidence/<profile>/`,
文件名按证据 ID 规则以 run 开头(run 经 `normalize_run_id` 归一:同一 run 的 `-a2-…` 重试、`:a1` 执行号共用一份)。
- **对外动作**(发布/发送/点赞/关注/评论/私信等会改变外部世界的点击)= `tap-evidence` / `locate-tap` 加 `--outward <动作名>`(小写英文短名,如 `publish`/`send`/`like`/`follow`/`comment`/`dm`),选项可写在任意位置,**必须**带全局 `--lock-owner RUN` 且该 run 持锁。
  流程:点击前截图 `<证据ID>-before` → 账本记 `attempt` → 点击 → 等待 → 截图 `<证据ID>` → 账本记 `result`。
  账本 `<run>-outward-ledger.jsonl`:每行一个 JSON(`schema/seq/event=attempt|result|refused/run_id/lock_owner/action/action_seq/command/x/y/control/before_evidence_id/after_evidence_id/at/at_epoch_ms`…),**只追加**(O_APPEND+flock,已有行永不改写)。
  同 run 同动作第二次**默认拒绝**(不碰设备,拒绝也记一行 `event=refused`);确需重复时显式加 `--allow-repeat`。
  例:`douyin-phone-adb --profile p1 --lock-owner RUN tap-evidence 600 2400 RUN-07-publish --outward publish` →
  `<png>` / `jpg=<jpg>` / `outward=ok action=publish run_id=RUN attempt_seq=1 action_seq=1 tapped=yes evidence=ok before_evidence_id=RUN-07-publish-before after_evidence_id=RUN-07-publish ledger=<path> ledger_evidence_id=RUN-outward-ledger`
  重复:`outward=fail class=fatal reason=repeat_refused action=publish prior_attempts=1 tapped=no ledger=<path> ledger_evidence_id=RUN-outward-ledger`(退出码 2)
  语义闸:证据 ID 形如 `<run>-NN-<短名>` 且短名含 `publish/post/send/like/follow/dm/reply` 却没标 `--outward` → `reason=outward_flag_required`,不点击。`tap`/`tap-snapshot` 不接受 `--outward`(没有前后证据)。
- `outward-ledger RUN_ID` — 只读输出该 run 的账本(JSON:`exists/sha256/entries/summary.attempts_by_action|refused_by_action|results_by_action`),不需持锁、不碰设备,核验员直接调。
- **锁回执**:`lock-acquire`/`lock-acquire-new`/`lock-release`/`lock-release-exact` 成功或失败,都在同一把 guard 内随即回读 `lock-status`,把时间/owner/退出码/回执原文/回读原文写进 `<run>-lock-acquire.json` / `<run>-lock-release.json`(`events[]` 追加 + `latest`)。原回执首行不变,随后多打一行
  `lock_evidence_id=RUN-lock-release lock_evidence=<path> readback_state=free`。
- **tap-evidence 等待上限**:`WAIT_MS` 在**点击之前**校验,上限 `DOUYIN_TAP_WAIT_MAX_MS`(默认 15000,最大 60000),超限 → `tap_evidence=fail class=fatal reason=wait_over_limit tapped=no`(退出码 2,没点)。
  点击后的取证有界 `DOUYIN_TAP_EVIDENCE_TIMEOUT_MS`(默认 20000):超时/失败不再报参数错误,而是 `tap_evidence=partial tapped=yes evidence=timeout|failed evidence_id=… x=… y=…`,stderr `failure_class=evidence_timeout|evidence_failed`,**退出码 3**,对外动作已记 `result evidence=timeout`。
  退出码约定:`0` 成功 / `2` 没点(可放心改参重试)/ `3` 点了但证据不全(**禁止据此重试对外动作**,先 `outward-ledger` 回读)。

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

## 基座 1/7：账本 + 阶段工件 + 续跑（钩子内建，棒3b-3 决策 2ca30c4d）

钩子直接内建在现网 `harvest-cron.sh` / `batch2.sh` 本体里（一行守卫 `wfr_on()`：`WFR_DISABLED=1`、`workflow-result.sh` 缺失或不可执行 → 全部 no-op，采收行为与并入前逐字一致，`__tests__/pipeline-v4-integration.test.mjs` 用并入前快照 `fixtures/batch2-pre-wfr.sh` 对拍）。原 v4 影子副本已删：与现网分叉四处（LINE 第 6 参 / 分拣 / 音频判定链 / 按 BIZ 回写），影子跑拿不到设备（三批衔接无空窗），起跑"孤儿 escort 清理"09-27 误杀了在跑生产批的 escort——该清理段**不并入**（cron list 分不清上批遗留与同机在跑批，kill -9 遗留由 escort 自身 `--timeout` 与分身值守兜底）。

部署（xian-m4 / M1 各一遍，`deploy.sh` 已含；**crontab 不动**）：
1. `scp harvest-cron.sh batch2.sh workflow-result.sh wall-report.sh ledger.mjs` → `~/bin-harvest/`（`chmod +x` 四个 .sh）；现场关钩子：crontab 那行前加 `WFR_DISABLED=1`
2. 账本/工件目录自动建在 `~/.config/zenithjoy/{ledger,workflow-runs}/`；工件收工 best-effort scp 到 MMV `workflow-runs/`
3. 依赖：`/opt/homebrew/bin/node`、`/usr/bin/jq`、`python3`（均已在 M4）
4. 探针读回（棒3b，决策 95e29afd：执行机只读回、Brain 只判定；棒3b-2，决策 8f38f5fd：读回**经 ssh 在 MMV 跑**——leadgen PG（zenithjoy 库）只在 MMV `127.0.0.1:5432` 监听、飞书凭据 `~/.openclaw/clawdbot.json` 也只在 MMV，09-26 实证执行机本地跑三条全 error）。落点是 **MMV** `~/.openclaw/leadgen-scripts/`（6b133a81 起由 `deploy.sh` 的 `MMV_PROBE_FILES` 自动下发、`drift-check.sh` 对账，不再手工 scp）：`verify-step.mjs` + `checks/`（probes-lib.js / schema.json / social-keyword-leadgen.yaml）→ 该目录；`line-routes.js` / `leadgen-db-connect.js` 那里已有（与 push-videos.js 同源，须与 main 一致，`shasum -a 256` 对一下）；`pg` 已随 push-videos.js 装好；凭据 MMV 已有（`~/.credentials/zenithjoy-db.env` 由远端命令 `source`，飞书退回 `clawdbot.json` 的 `accounts[routeOf(line).account]`）。**xian-m4 / M1 不再需要** node 侧探针文件、`checks/`、`zenithjoy-db.env`、`feishu.env`：`workflow-result.sh` 的 `probe_stage` 经 `ssh -o ConnectTimeout=20 mmv "set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; cd ~/.openclaw/leadgen-scripts && node verify-step.mjs …"`（与 batch2.sh:55 推 push-videos.js 同一条）执行，主机/目录可用 `WFR_PROBE_HOST` / `WFR_PROBE_DIR` 覆盖；本机无 YAML 时按 `WFR_PROBE_STAGES`（默认 `delivery scoring`，checks 单测钉住与 YAML 一致）决定哪些 stage 走 ssh。ssh 失败/超时/非 JSON → 该 stage `probes=[]` + stderr `WFR_WARN … verify-step via ssh`（Brain 侧按 probes 缺失判），远端 `verify-step:` 单条 error 行原样透传进 `harvest-cron.log`；采收本身不受影响。自检：`ssh mmv 'cd ~/.openclaw/leadgen-scripts; set -a; . ~/.credentials/zenithjoy-db.env; set +a; node verify-step.mjs --stage delivery --run-tag <昨晚TAG> --line-key jinoshengyuan-work'` 应打一行三条含 `observed` 的 JSON（`--line-key` 传 profile 名即可，verify-step 经 `routeOf().key` 归一成库里的路由键；`videos_readback` 与 `line_key_not_null` 同 WHERE，同 TAG 下前者计数 == 后者行数）

账本验收判据（部署后首晚生产批即验，无影子窗口）：
- `~/.config/zenithjoy/ledger/social-keyword-leadgen-crontab-auto*/ledger.json` 里 preflight/discovery/collection/delivery/cleanup 为 completed（delivery 在 PUSH=0 时为 blocked，正常）、qualification/scoring 为 blocked not_in_profile；工件每个含 `task_request_hash` 且 `jq -e '.schema_version==2'`；`harvest-cron.log` 有 `Brain单:`、`账本init:`、`escort复核命中` 与 `账本finalize: ok=1`；MMV `~/.openclaw/escort-findings.md` 当晚有新行；`night-auto*.tsv` LEAD ≥ 近 7 天均值
- 正常退让（设备离线/白天时窗/KPI 达标/词单失败）路径 `harvest-cron.log` 只会出现 `账本finalize: skipped(not_initialized, 正常退让)`，不 escalate、不写工件——这是预期，不是故障
- `WFR_DISABLED=1` 时以上账本行一条都不出现，其余日志与并入前完全一致
- hash 不一致时的工件是 `…__aN.discovery.0.worker-result.json`（哨兵 n=0，词序号从 1 起，不会覆盖已完成词的账本记录）
- 账本里每次阶段写入都记一条 item `{n, word}`（init/finalize 写的 preflight/qualification/scoring/cleanup 的 word 为空串），续跑只看 discovery∩collection 都 completed 的非空 word

环境守卫的 proven-to-fire（生产批各做一次，记录到 PR）：
- escort 真活：拉起后手动 `ssh mmv openclaw cron rm <id>` → 30s 后 `harvest-cron.log` 出现 `escort复核未命中` 且 escalation.log 新增一行
- 工件落地：起跑前 `chmod 000 ~/.config/zenithjoy/workflow-runs` → 收工 `账本finalize: ok=0` 且 escalation 新增；恢复 `chmod 755`

harvest-keyword.sh 出口码契约（账本 stage 映射依赖，勿改）：`3` 锁被占 / `1` open-search 失败 / `0` 正常或无卡片。

后续（不在本 PR）：`workflow-manifest.json` `orchestrator.type` n8n→commander、n8n「Social Leadgen V4」标 inactive（hk-vps，先复核发布版≠草稿）、scoring 闭集键口径修正归基座 7/7、`decisions/match` 疑似写库副作用、escalate 目标主机 us-vps 已退役需评估改 MMV。

## 安全声明

触达命令 `private-message-send` 机械已修,但 `outreach_policy.enabled=false`(默认关闸)。真实发送需主理人批话术、批发送账号、批频控,AI 不得自行触发。

## 守卫

`.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`(已在 Smoke Glob Gate 基线内):五件套存在性+zsh/node 语法闸+六刀签名存在性+烂死模式检测(变量展开尸块/死函数复活),proven-to-fire 验证过报红能力。

## 探针文件(写完读回的 SSOT,决策 702949b6 / e2cef2c9)

`checks/social-keyword-leadgen.yaml` 是"写完读回"断言的唯一真身(同 dbt tests / Dagster asset checks)。batch2.sh delivery 段里 `readback_verified:0` 的硬编码由它替代:每条探针声明 `stage / journey_cell / probe(sql|http) / expect / severity / note`,SQL 与飞书取法按真实写入方写(视频双写 PG `leadgen_videos`,评论只落飞书原始评论池),占位 `$RUN_TAG`(=harvest-cron.sh 的 TAG)/`$LINE_KEY`/`$WORD`。

- 形状由 `checks/schema.json` 守:stage 只能是 workflow-result.sh 的 7 个阶段,op ∈ `>= == <= not_null_all`,severity ∈ `warn|error`,`expect.ref` 只能引 workflow-result.sh `req_keys()` 的闭集 metrics 键(单测从脚本实时抽取,不抄副本)。
- 加载/校验层 `checks/probes-lib.js` 零依赖(CI openclaw-scripts-test 不装依赖),守卫 `__tests__/checks-social-keyword-leadgen.test.mjs`,坏 stage/op/severity/ref 都 proven-to-fire 报红。
- Brain 侧:cecelia 仓 `scripts/sync-step-probes.mjs` 读本文件登记 sha256 到 `step_probes`,并把 journey cell 的 `assertion_ref` 写成 `probe:<key>`。**改探针 = 改 YAML 发 PR**,不在 Brain 里手改;哈希漂移由同步脚本发现。
- 运行时接线的四条(全 `error`):delivery `videos_readback` / `comments_readback` / `line_key_not_null`,scoring `pool_advanced`。`effective_count` 已删(评分是批级的,`$WORD` 无意义,回写在批次收工后才跑)。
- 业务线无关:http 探针 url 用 `$BASE/$POOL/$KEYWORD/$LEAD` 占位,`verify-step.mjs` 按 `routeOf(--line-key)` 展开;blocked 占位工件(init 的 scoring/qualification、PUSH=0 的 delivery)不读回、不判。
- 对账基准取脚本真实统计:`push-videos.js` / `push-raw-comments.js` / `sort-comments.js` 在人读输出后各多打一行 `PUSH_VIDEOS_STATS` / `PUSH_COMMENTS_STATS` / `SORT_STATS {json}`(`stats-line.js`),batch2.sh 解析后写 delivery(`leads_written`/`duplicates_skipped`/`videos_pushed`)与 scoring 工件。

## 搜索页签证据

`search-video-tab EID` 的成功证据固定为 `${EID}-aftertab.xml`，供原步骤checkpoint读取。
若首次点击后重定位成功，先保首点为 `${EID}-aftertab-first.xml`，保留重试原件，再原子提交最终严格selected树。
保存或提交失败不会返回 `video_tab=1`；诊断/重试文件不增加成功来源计数。该说明不代表真机验收已完成。

### Runner vs Commander

云手机输入支持规范的 `IPv4:端口` 序列号，身份仍需与冻结的 Task、profile、主机和设备模板精确一致。`cloud-phone-test` 的源码模板绑定 MMV 已有的本机 `5041` ADB 通道及固定解释器摘要，仅用于 101、102。设备语法和模板验收通过后，仍须完成受信执行域、当前原生账号、媒体与真实业务读回验收，才能声明可执行或业务通过。

在原正式启动输入上设置 `LEADGEN_EXECUTION_MODE=agent`，可选择 101、102、103 的 Agent 主执行路径。执行模式、任务身份、输入范围与预算冻结到本 run，不能在续跑时切换为 Code，也不适用于 104。原 Code 路径保持独立。

Agent 在分配工具或派发 Worker 前，还必须通过受信代码的执行域能力检查。当前 Provider 尚未声明支持完整执行域，101–103 的 Agent 活动会返回 `needs_review`、`not_started=true`，不会开始手机或业务操作；这不代表业务完成，也不会自动切换为 Code。环境变量、Agent 返回内容或 JSON 标记不能开启此能力。旧执行的停止状态若仍未证明，必须保留 `execution_stopped=false`，不能因为本次没有启动 Worker 就覆盖它。

Agent 主执行时，每个 Activity 加载自己的冻结 Skill，通过当前活动允许的手机、录音、提交和读回原语完成工作；不会调用原业务 handler 或 `resume`。底层控制器、事务、资源管理和规则校验仍由代码提供。`inspect`、`phone`、`business` 只使用本次原请求给出的入口，Agent 不创建绑定或直接调用内部队列。

Agent 路径沿公共 Runner 的实际剩余时间设置一次绝对截止，在原 Activity 与整轮预算内为 Worker、父会话返回、精确停止读证和终检留时间；阶段字段只能缩短截止，预算不足不启动。Worker 截止限制新业务准入及官方子会话超时，不代表原生执行域已停止；此前已发起的操作仍需独立终止证明。普通超时也请求停止同一绑定对象，缺父子双方终态证明仍隔离。旧官方子会话路径中，Parent 只负责官方派发，Child 分页读取同一冻结方法、支持材料和合同，完整原件保留。

以下描述新运输的合同与验收要求；组件测试通过不代表默认入口已部署或真实模型往返已通过。

新中央方法版本显式支持 `raw-model-v1`：正式输入同时冻结运输类型与 `max_turns`（1–64），缺少声明不能借此运行旧方法。模型只提出结构化意图；父 Code 加载冻结方法、调用原 broker 白名单、保存工具回执，独立 Judge 决定状态。模型侧以官方 Gateway 的 `modelRun=true` 禁用工具，使用已配置的执行账号和模型，不伪造官方 Child 或其停止证明。冷候选包含固定摘要的 SDK，不从全局安装或运行时网络补依赖。

部署的冷 Skill 源只由固定 bootstrap 读取系统用户主目录内的 `~/.credentials/zenithjoy-skills-source-read.key`。此镜像按 credentials skill 从 1Password 同步，要求同用户、普通单链接文件及 `0600` 权限；密钥仅进入该短命 bootstrap，后代环境擦除密钥。已有固定 Git 缓存不读取密钥，缺少合法镜像时在创建 release 前拒绝。

新的冻结来源以 `direct-final-plus-run-wait/v1` 声明成功终态协议。Worker 和 Commander 共用通信原语，在同一不重连连接取得真正的模型最终回包，再独立查询同一次运行的终态。代码分别保存请求的来源会话和路由，以及派发前按受审官方规则计算的内部执行会话 ID；实际模型元数据和回执都必须精确匹配内部期望，不能从回包倒推期望。来源路由与原 run ID 仍用于取消寻址。查询可以完全缺少重复身份回执，但已有回执为空、残缺或矛盾时必须拒绝。仅收到 accepted ACK 或会话索引存在都不能通过。

同一运行的错误事件或序列缺口立即撤权，不能借旧成功快照通过。该协议只适用于新来源中的唯一运行和单次派发；取消、超时、丢失最终回包及旧未知运行仍沿原停止合同处理。两次 RPC 分别记录请求及结果摘要，共享连接只记录一套真实关闭证据，之后还需原 owner 关闭证明。失败诊断只保存受限字段和摘要，不保存提示词、模型回复正文或凭据。官方实现的关键文件随来源固定；磁盘源码校验不冒充进程内存证明，组件测试也不替代真实控制或业务验收。

此路径在 Runner 唤醒 Commander 前创建独立 Observer 调用域。Commander 的本机锁助手使用固定解释器和禁止派生进程的沙箱；助手关闭、SDK 请求与连接关闭、模型终态分别留证，任何一个都不能代替其他域的停止证明。超时或进程中断保留未决原件，不覆盖锁，也不将对象重建当作旧调用已停止。

同一 Observer 的请求由 Code 串行处理。Worker 下一回合在原截止内等待已拥有的观察工作及停滞提醒完成，再读取指导；派发前同步校验 Broker 私有快照版本，并保留读取期间到达的指导与中止状态。正常在途请求排空后重新检查各域状态；真实终态未知、超时或中止仍保留隔离，旧运行的未知记录保持原样。

受限控制验收只能由真实 Task 的 `payload.scope.control_scope` 授权，沿正式 MMV `mmv-scoring`、`serial=none` 入口运行；仅允许 `inspect` 和 `finish`，不构造手机、业务数据库或队列写入能力。它用于验证真实模型、Commander 纠偏和收尾往返，业务 Judge 仍应拒绝缺少真实评分证据的结果，不能据此宣称 103 或获客完成。

当前新增的 end-check 后恢复只开放一次只读续棒：保留原 Task、来源、剩余总轮数和绝对截止，Commander 指导进入下一轮，随后由 Code 再检查；第二次仍不通过进入 `needs_review`。这证明纠偏和复查链路，不代表已经具备修复手机或补写业务结果的能力。未知副作用仍只读回；完整 101–103 执行及业务修复必须另有真实验收，生产能力检查不能因控制验收通过而放开。

`inspect.pending_write_readbacks` 是未确认写入的精确读回集合；指导和中止字段缺省分别为 `[]`、`false`。问题、进度、错误通过真实 inspect 事件传递。普通上下文 inspect 不额外等待 Observer；显式事件在剩余预算内有界等待，不可达记录为 unavailable，晚到指导记录为未应用，不能改变已判状态。原生或业务提交未知仍保隔离。

新路径的结果来自服务端持久工具回执和原始证据，由原独立校验确认。Skill 文件、源码测试或 Agent 的完成文字都不构成实机通过；101 视频、102 评论、103 评分及精确来源读回需要分别提供真实运行证据。

获客入口复用 Cecelia 公共 Activity Runner 的固定源副本；同步工具及 `common-runner/source.json` 记录来源与摘要。`leadgen-runner-adapter.mjs` 只连接业务执行、独立读回与手机安全证据，顺序、恢复次数和状态路由统一由公共 Runner 执行。

Commander 在开始时唤醒、结束时休眠，只观察、答疑、纠偏和请求中止 Agent。不可达只记录 `commander_status=unavailable`；它的回复不能判定状态、改变顺序或批准发送。旧 `*_commander_verified` 可用性硬闸已移除，身份、来源、业务读回及发送安全闸保留。检查失败可在原预算内指导一次 Skill 接手，仍由独立检查再次判定；失败进入 `needs_review`。原代码失败与 Skill 救回分别记录，接手不覆盖失败事实。

`checkpoint` 在步骤裁判和工作流读回中统一只记录；`hard` 缺失、未知或失败均不能通过。正常异常与中止仍进入清场；旧执行是否停止未知时禁止重放和清场，持久隔离手机。未知发送效果只读回，不重发。104 的发送实现、账号与审批行为不变。

每个 Caller 关闭后另存 `official-caller-final-*.json`，绑定原请求、来源、原始日志与逐回合证据。它只供独立审计，不能凭 JSON 或文件存在授予停止证明、恢复权限或洗掉旧 unknown；记录失败继续保留 unknown。取消、deadline 或客户端关闭抛错时，仍尝试关闭其它本人资源，并在原收尾预算内记录实际结果。

Code 可用 `readAuthorizedTaskClaim` 取得同次完整授权实际读到的 Task 归属投影，不新增模型或业务操作。该投影不包含租约，也不是权限凭据；正常业务仍需自己的正式来源、租约、原生资源域和独立结果核验。

101 在原生 XML 证实评论为 0 后只将证据写入本 run 的 `zero_comment_candidates`，不调用业务入队；远端 discover 入口独立重算原件并在任何 SQL 前拒绝 confirmed 0。未知评论数保持 unknown，不冒充 0。这条入队守卫由 101 原生 XML→发现执行→队列调用的专项回归验证，与 102 的零评论采集结局分开。

### 原安全事务的历史 guard 兼容

`review-preserve` 保持当前 registry 的业务设备集合不变，允许其 guard 是原迁移快照的子集。旧、新根的全部 guard 都必须互锁，并核对完整 inventory、摘要、owner 原件和每个 guard 的 inode/ctime；registry 外的 owner、忙 guard 或任一漂移仍拒绝。历史 TCP guard 只保留原件，不增加业务设备，也不删除旧 owner。

`maintenance-install-backend.mjs` 的 `review-guard-snapshot-v1` 仅用于固定原 3fe 事务的恢复：变更集合恰为 host、maintenance、input 三文件，host 新摘要及后两文件新旧摘要均固定，其他工具字节不得变化。原 host-only 条件保留；不得把新增文件泛化加入恢复白名单。测试的 `review-guard-3fe-source.json.gz` 是该原提交两份公开源码的压缩原文，供浅克隆 CI 核对摘要。

候选重开入口为 SSH 远端 shell 显式保留空 release 参数；输入断言显式失败退出，不依赖 Bash 版本的隐式 `errexit` 行为。安全事务完成不代表候选业务验收通过，现有生产业务准入不变。


### 本次失败102的独立维护

`collection-review-maintenance-host.py plan <新候选SHA> <release-id> --gap-evidence <绝对授权JSON>` 只读核对本次
`ys20261103235714_102` 的原件、当前维护claim、现行中央归属、十个guard和候选实际字节。
合同来自已保存原件SHA，包含旧101归档及其他owner历史盘点；调用者不能替换owner或预期hash。
仅legacy的`ANGYVB4227006983.lock`与`standalone-claims/ANGYVB4227006983`精确子树
允许与历史盘点不同；这些外部业务状态只被保留，不据此认定其合法或已停止。
其他legacy条目（包括431历史claims）、durable、迁移标记、alias与十个guard继续固定原合同。
全guard下双次稳定盘点后，`apply`先独占持久化`inventory-snapshot.json`，绑定完整当前中央租约、
维护claim、候选业务版本、维护工具40位版本目录及15文件实际哈希、原合同SHA和目标inode。
所有后续阶段要求当前legacy完整等于此快照；pre-retirement及completion绑定其原始字节SHA。
已有任何意图或结果但缺快照、快照不完整或其后状态变化均拒绝，崩溃重入不会重新采纳新盘点。
原migration摘要只作历史锚，不冒充当前legacy全盘一致；新快照不修改原合同或旧run。

`apply` 在同一组guard下复核。仅当原生双焦点明确为该抖音应用、电话空闲、录制器静默时，
新授权允许两个独立受限nofork请求：关闭固定抖音包、返回HOME；随后读取物理屏幕尺寸、
PNG、XML和HOME双焦点。写动作先持久化独占意图，超时、信号或未知结果保持原owner，
再次调用只读回，不重发。全部核实后只归档本次102的目录，其他owner、旧101归档和迁移标记不变。
中央锁由协调者另行精确CAS释放；本工具没有中央写接口。

维护记录在独立私有目录，原102的failed与`execution_stopped=false`保持原样。
这只证明本次同步手机请求域已关闭，不证明任意OS后代全停，不恢复原WeakMap、Skill或采集权限。
维护测试使用隔离C客户端和本地文件夹具，不操作真实手机或业务库；真实Darwin内核nofork测试进入L3，真实原件集成由受控本地副本提供。

断档授权v1只接受原始精确认领；原维护任务被降级blocked并清claim后不可使用。v2把原
`maintenance`历史常量与`current_maintenance_claim`分开：绑定完整blocked原件、正式
4小时新claim、恢复PATCH短回执、成功heartbeat和两次Task读回；每次准入再GET同一新claim
和全部冻结payload。新claim不改写旧timestamp，不恢复旧业务。具体17文件格式、真实API
回执及保守租约边界见 `docs/runner/collection-review-gap-evidence.md`。已有journal不能迁移。

### 预检的私有 pg 依赖

`preflight-pg-lock.json` 固定根 `package-lock.json` 的精确 pg 8.18.0 运行闭包（14 包，包含原有 pg-cloudflare；不扩装 pg-native）。原 Git 锁的 13 个传递包没有 tarball integrity，新描述符补齐各自精确版本的官方 registry URL/SSRI，不重新解版本范围。

候选构建在 `runtime/_dependencies/preflight-pg` 私有目录解包，不调用 npm 或安装脚本。每个 tarball 先验 SSRI，再拒绝路径穿越、重复项、软硬链接和扩展路径记录。全部文件和目录落盘后，排他原子提交完成清单；半成品不自动复用或覆盖，失败不进入部署观测。

描述符须先在正式 Activity implementation_bindings 冻结，缺绑定在中央请求及候选运输前拒绝，不临时添加未绑定组件。中央 release 固定真实 Git 描述符的 code 组件；第三方文件保留独立的 `dependencies.preflight_pg` 观测。候选运输先核实际文件和权限，原 collector 再验归档、完整文件集合及字节；完整观测摘要进入原中央 observation。中央 code/skill gate 和第三方依赖证明分别保留。

运行时 `loadPreflightPg({runtimeRoot,frozen})` 只接受服务端目录、`frozen.deployment.source_commit` 与冻结的两份锁摘要。它重新核所有归档、文件及 Unix owner/mode，禁止 NODE_PATH/native 偏移，只返回官方 Pool；缺包不能借 HOME/global 包兜底。此路径不下载、不写文件、不启动进程。当前交付仅接候选安装；传统晋级不自动安装依赖，缺依赖必须拒绝新预检入口。

### Agent 预检的受控执行域（42e）

当前源码的预检工厂仍不声明支持。正式 activity_skill / authority / stop 的 Caller 仍有普通 SSH、远端 shell 或本地 Node outer，尚无完整受支持执行域；官方 Agent 会话双停不能替这些 Caller 签停止证明。本组件的独立审查也不构成启用资格，必须由后续正式 Caller 修复闭合后再审。其它尚无完整原生域的 Activity 继续在工具分配和 Worker 派发前返回 `not_started / needs_review`，不能把这个安全修复当作 101→102→103 已跑通。

101/102 Agent 预检使用父进程内的原关键词、公司冻结函数及独立 Judge、记录函数。物理操作只有固定、来源绑定的 nofork ADB/Python 叶，不再启动旧 controller shell。PG 控制面、本机物理叶和官方 Commander/Worker 双停分别留证：本机叶关闭不证明远端 PG 服务或 Android 应用进程全集停止；PG 提交未知仍保留未知，官方停证也不能由本机证明代替。

正常失败可凭同源码、Task、binding、owner、epoch 的私有能力进入一次独立清理域。桌面解析在该域 seal 前执行原完整解析器，随后只读核验原件摘要和最后物理序号；资源释放后 Judge 仍可核验这份不可变事实，不再启动解析子进程。未派发 Worker 且未进行界面操作的失败只归还本人已知资源，跳过关闭应用、Home 和清理 Worker；缺桌面条件仍由原 Judge 判失败，不伪造成功指标。

Worker 截止后不再准入新业务或手机动作，原 receipt 窗口只用于收口、纯读验收和停证。超时或未知之后，原有独立 20 秒隔离保护窗仅允许固定 nofork 叶核对本人 owner+epoch 并写持久隔离标记；不续租、不释放、不恢复业务，也不把标记当停止证明。整轮后的 span/flush 属于独立交付域，这份预检能力不声称覆盖它们。

若候选 manifest 明确声明 `dependencies.preflight_pg`，冻结事务先完整核验候选实际依赖摘要，再用其 14 个已验证 tarball 离线重建 run 私有依赖并独立读回，零下载、零安装脚本、不建立软链或全局 fallback。Code/104 只获得声明中不可变 artifact 的副本，不新增 Agent 字段或业务能力；原无依赖输入保持原快照格式。

预检在第一次 ADB 请求（包括只读请求）前原子发布带 epoch 与强制审查标记的本人本地锁。普通命令失败与 host 叶子停止证明分开记录；缺停止证明时标记保留，旧 TTL 回收入口不得重领。Worker 从未派发且未做 UI 操作时，仅 Code 私有 NoLaunch 能力可授权释放同 owner/epoch 的资源，原桌面指标保持 0，原 Judge 仍可判 needs_review。

控制面拒绝带 query/hash 或歧义 authority 的数据库 URI，并拒绝非空 PG* 环境覆盖；不改进程全局环境。SSH 只使用由已冻结 known_hosts 提取的唯一期望 key 的 run 私有副本与精确 HostKeyAlgorithms，原全局文件不变。上述证明覆盖本机受控叶子与连接返还，不代表远端 PG 提交结果、Android App 全集或尚未闭合的正式 Caller。

Agent 101/102 的 `preflight_profile` 在正式 prepare 阶段冻结规范 registry 路径、全文件摘要及唯一所选 profile/serial/model/尺寸/enabled。运行和续跑逐项复核，缺字段的旧 Agent 快照不能绑定当前表补齐。MMV 云入口必须显式传入既有 `DOUYIN_PHONE_REGISTRY=$HOME/.config/openclaw/cloud-phone-test-profiles.tsv`；不新建或修改全局表，这份静态元数据也不代表本轮账号或媒体验证已通过。

采证的同一公开 ID+扩展名仅允许提交一次，重复文件、目录或悬空链接均在新手机操作前拒绝；XML/PNG 可以同 ID 各一次配对。提交采用排他/no-follow写入并 fsync，随机采证原件同时保留，竞争失败不删除赢家、不重发手机动作。
