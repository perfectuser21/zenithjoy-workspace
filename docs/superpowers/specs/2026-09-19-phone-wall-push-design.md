# 设计：机房手机可视化——adb 推帧器 + 获客链步骤上报（控制塔接线，不动 APK、不做远程控制）

日期：2026-09-19 · Brain task `1f5b9134` · 路径 B · GP-Anchor `line02/keyword_acquisition keep-green` · PrepPRD `sprints/09192200-phone-wall-push/prep-prd.md`

## 1. 目标与边界

**目标**：主理人打开 Dashboard「工作机」页（决策 e14297d4 已上线的控制塔），能看到 OpenClaw 驱动的四台机房手机（M4/M1 USB 直连）当前在跑什么任务、到哪一步、实时画面。

**不做**：APK 改动、远程控制/接管、人租约、WebRTC/scrcpy、小程序端（另开一刀）、apps/api 改动、OpenClaw 网关配置改动。

## 2. 方案取舍

| 方案 | 结论 |
|---|---|
| A. 打开 APK「上墙」开关 | ❌ 主理人明确不碰 APK；且四台里三台 agent 进程没在跑 |
| B. 让 OpenClaw 走信号桥（phonectl）驱动，由 APK 推流 | ❌ 生产链是裸 adb，改驱动方式风险大、与"只要可视化"无关 |
| **C. Mac 侧 sidecar：adb 抓屏推帧 + zsh 链每步上报到既有 worker 协议** | ✅ 不动任何现有执行路径，只加旁路；控制塔页面零改动 |

## 3. 组件（全部在 `services/phone-adb-controller/`）

### 3.1 `phone-wall-push.sh`（bash 3.2 兼容，launchd 常驻）

- 配置 `~/.config/zenithjoy/wall.env`（chmod 600）：`ZJ_API_BASE`、`ZJ_LICENSE`、`ZJ_INTERNAL_TOKEN`、可选 `WALL_INTERVAL`（默认 1 秒）、`WALL_WIDTH`（默认 360）、`WALL_CONVERT_CMD`（缩图命令，默认 macOS `sips`；测试注入直通）。
- 主循环每 60 秒：`adb devices` 取在线序列号；对每台调 **`POST /api/agent/register`** `{license_key, machine_id:<序列号>, hostname:"phone-<序列号>", agent_id:"phone-<序列号>", version:"wall-1"}`。注册函数在 `apps/api/src/services/license.service.ts`，**按 (tenant_id, hostname) 去重**，所以 hostname 必须每台唯一；返回体 `agent_id` 字段 = agents.id（UUID）。每次调用刷新 `last_seen=now/status=online`，兼作心跳（控制塔 3 分钟在线窗口）。`license_machines` 按 (license_id, machine_id) 幂等，不重复吃配额。
- 映射缓存 `~/.config/zenithjoy/wall-agents.tsv`：`序列号\tuuid\tphone-<序列号>`，原子写（临时文件 + mv）。
- 每台手机一个后台子进程推帧：`adb -s S exec-out screencap -p` → `$WALL_CONVERT_CMD` 缩到 360 宽 JPEG q55 → 若 >120KB 再以 q35 重压一次，仍超则跳过该帧 → `POST /api/workers/<uuid>/frame`，头 `X-Agent-License: <license>` + `Content-Type: image/jpeg`，`curl -m 5`。返回 429 退避 10 秒；4xx/5xx 只记日志。设备离线时子进程退出，主循环下一轮重拉。
- 退出码永远 0；所有错误落 `~/phone-wall.log`。`WALL_ONCE=1` 跑一轮即退（单测/smoke 用）。

### 3.2 `wall-report.sh`（bash 3.2 兼容，给 zsh 链调用）

```
wall-report start  <serial|--profile P> "<title>" "步骤1,步骤2,..."   # 建任务
wall-report step   <serial|--profile P> <idx> doing|done|failed ["note"]
wall-report note   <serial|--profile P> "<note>"                      # 当前步 doing + note（续租）
wall-report done   <serial|--profile P>
wall-report fail   <serial|--profile P> <idx> <error_code> ["diag_line"]
```

- `--profile P` → 查 `~/.config/openclaw/douyin-phone-profiles.tsv`（第 1 列 profile、第 2 列 serial）得序列号；序列号 → uuid 查 `wall-agents.tsv`，查不到就自己 register 一次并写入缓存。
- 执行器面三端点**只用内部 token**（`Authorization: Bearer <ZJ_INTERNAL_TOKEN>`），**绝不带 `X-Agent-License`**（带了会被分流到 license 路径而 401）。
  - `POST /api/workers/<uuid>/tasks` `{title, steps[], executor_id:"adb-wall"}` → 201 `{task_id}`；409 `WORKER_BUSY` 时：若本机状态文件 `/tmp/zj-wall/task-<serial>` 有旧 task_id，先 `complete {outcome:failed, error_code:"superseded", failed_step:<旧idx>}` 再重试一次；仍 409 则静默降级（本批不上报）。
  - `POST /api/workers/tasks/<id>/steps` `{step_index, status, executor_id, note?, foreground_pkg?, diag_line?, screenshot_jpeg_b64?}`；`failed` 必带三件套：前台包名 = `adb shell dumpsys window | grep mCurrentFocus` 正则取包名（取不到填 `unknown`），诊断行 = 参数或最近一条日志，截图 = `adb exec-out screencap -p` 经 `$WALL_CONVERT_CMD` 压到 ≤200KB 后 base64（无 data URI 前缀）。
  - `POST /api/workers/tasks/<id>/complete` `{outcome, executor_id, error_code?, failed_step?}`。
- 状态文件记 `task_id` 与当前 `step_index`；`note` 子命令把当前步再报一次 `doing`（服务端续租 10 分钟）。
- 命名空间：状态文件按 `WALL_NS` 分开（`task-<ns>-<serial>`），采收链 `harvest-cron.sh` `export WALL_NS=harvest`（batch2/harvest-keyword 子进程继承）、触达链 `outreach-tick.sh` `export WALL_NS=outreach`——同机同序列号的两条链各记各的任务，互不顶状态。
- 全部 `curl -m 3`，任何失败只写 `~/phone-wall.log`，退出码 0，绝不阻塞主流程；调用方一律 `wall-report ... || true`。

### 3.3 挂钩（三个 zsh 脚本，只加行不改序）

| 脚本 | 挂钩 | 位置约束（smoke 窗口断言） |
|---|---|---|
| `harvest-cron.sh` | 29 行后 `start "$SERIAL" "获客采收·$BIZ" "拉Commander,设备预检,取词单,采收主体,效果回写"`；49/63/118/124/129 行后各 `step N done`；54 行后 `fail 1 device_offline`；115 行后 `fail 2 keywords_unavailable`；68/80 行退让处 `done`；批末 `done` | 53-54 行之间**最多插 1 行**；104-112 行之间**不插** |
| `batch2.sh` | for 内 24 行后 `step 3 doing "词n: W"`；26 行后 `note "词n 完成 LEAD=…"` | 无 |
| `harvest-keyword.sh` | 每个视频循环体 `note "视频i: 标题"`（续租，单词可超 10 分钟） | 无 |
| `outreach-tick.sh` | lock-acquire 成功后（不是取到单后）`start --profile "$PROFILE" "触达·单#$SEQ $NICK" "发送,核验"`，用 `WR_STARTED` 保证整个 tick 只 start 一次（重试只重报 `step 0 doing`）；发送=步 0、核验=步 1；各分支 `done` / `fail 0`；第 2 次起锁被占 → `fail 0 lock_busy` | `wr` 定义必须在 23 行 source 守卫之后；`start` 必须在 lock-acquire 之后（锁被采收占着时不能开任务，否则 409 顶掉同机采收任务） |

### 3.4 `com.zenithjoy.phonewallpush.plist`

照 `com.zenithjoy.logstreampush.plist`：`/bin/bash ~/bin-harvest/phone-wall-push.sh`，RunAtLoad + KeepAlive，stderr 到 `/tmp/phonewallpush.err`。

## 4. 数据流

推帧器 register → agents 行（在线）→ 每秒 frame → 控制塔 `GET /live` MJPEG。采收 cron start → 卡片"正在执行 1/5"→ 每步 done/note → 详情页步骤流 → complete → 历史 +1。

## 5. 错误处理

| 情况 | 行为 |
|---|---|
| 中台不可达 / 5xx | 记日志，下一轮重试；主流程不受影响 |
| 429 | 推帧器退避 10 秒；上报器不重试 |
| 帧 >120KB | 降质重压一次，仍超跳过 |
| 409 WORKER_BUSY | 先收尾旧任务再试一次，再 409 静默 |
| 租约过期 executor_lost | 后续 step 会 409，静默；下一批 start 会先 superseded 收尾 |
| 设备掉线 | 推帧子进程退出；主循环 60 秒后重拉 |
| 三件套取不到 | foreground_pkg=unknown、diag_line=参数或"n/a"、截图失败则改用 1×1 JPEG 占位并在 note 标注 |

## 6. 测试策略

| 档 | 内容 |
|---|---|
| unit（node --test，`__tests__/phone-wall-push.test.mjs`、`__tests__/wall-report.test.mjs`；ci-l3 glob 已自动包含） | 假 adb（PATH 前置的 shell 脚本，输出固定序列号与内置小 JPEG）+ 本地 http 假中台。断言：register body 含 license/machine_id/hostname=phone-序列号；frame 请求 Content-Type image/jpeg、体 ≤120KB、带 license 头；缓存 tsv 写入；start/step/note/done/fail 请求体；fail 必带三件套；steps 端点带 Bearer 不带 license 头；409 收尾重试；中台不可达退出码 0；`--profile` 解析 |
| smoke（`.github/workflows/scripts/smoke/phone-wall-push-smoke.sh`，登记进 `smoke-baseline.txt`） | `bash -n` 语法闸；三个 zsh 脚本已挂钩（grep `wall-report`）且 `harvest-cron.sh` 窗口断言仍成立；`WALL_ONCE=1` 对假服务端跑一轮收到 register + frame；在 ubuntu 无 adb 无 zsh 下自洽 |
| 变异自证 | 帧上限抬到 200KB → 超限用例红；删 harvest-cron 挂钩 → smoke 红；挂钩行前加 `#` → smoke 红（层 2 对去注释文本断言） |
| 真机验收（staging，人工由 lead 执行） | M4/M1 部署后 `GET /api/workers/<uuid>/activity` `frame_age_ms<3000`；卡片在线；实时页画面与真机一致；跑一次触达 tick 或采收后详情页出现步骤流 |

## 7. 部署与已知债

- 部署：scp 两个新脚本 + 三个改过的 zsh 到 M4/M1 `~/bin-harvest/`，写 `wall.env`（license = ZJ-E-ALEX5211，token 以 staging 容器 printenv 为准），`launchctl load`。PR 标题带 `[CONFIG]`（新增 smoke 文件触发 Config Audit）。
- 债：① 同一台手机的 APK 行与推帧器行是两张卡；② 1Password「ZenithJoy Internal Token」与容器实际 token 不一致；③ 容器截图目录 `/opt/zenithjoy/screenshots/worker-shots` 未挂持久卷；④ 执行器面限流实际按 IP 共桶（600/分），四台 1 fps 占四成，加机器要重算。
