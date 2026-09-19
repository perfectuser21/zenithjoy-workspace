# 小改动 PrepPRD：OpenClaw 机房手机可视化——adb 推帧器 + 获客链步骤上报（不动 APK、不动 OpenClaw）

Brain task `1f5b9134-cca4-4bf7-a8ab-702ed8797047` · 路径 B · GP-Anchor: `line02/keyword_acquisition keep-green`

## 改什么

主理人只要"任务在跑的时候能看见它在干什么"，不要远程控制。控制塔（决策 e14297d4）网页页面、MJPEG 通道、worker_tasks 协议全都现成，缺的是**机房手机没有任何东西往里推**。本刀在 `services/phone-adb-controller/` 加三件：

| 件 | 文件 | 作用 |
|---|---|---|
| 1 推帧器 | `phone-wall-push.sh` + `com.zenithjoy.phonewallpush.plist` | M4/M1 上常驻：对每台 `adb devices` 在线手机，用 license 调 `POST /api/agent/register`（注册在 `apps/api/src/services/license.service.ts`，按 (tenant_id, hostname) 去重，故每台传唯一 hostname=agent_id=`phone-<序列号>`、machine_id=序列号；返回体 `agent_id` 字段即 agents.id UUID，并刷新 last_seen=在线）；每秒 `adb exec-out screencap -p` → 缩到 360 宽 JPEG（≤120KB）→ `POST /api/workers/<uuid>/frame`（头 `X-Agent-License`）。每 60 s 重新 register 当心跳。序列号→uuid 缓存在 `~/.config/zenithjoy/wall-agents.tsv` |
| 2 上报器 | `wall-report.sh` | 给 zsh 链用的薄壳（序列号或 `--profile P`，后者查 `~/.config/openclaw/douyin-phone-profiles.tsv` 取序列号）：`start <serial> <title> <步骤,逗号分隔>` / `step <serial> <idx> doing\|done\|failed [note]` / `done <serial>` / `fail <serial> <idx> <error_code> [diag]`。走 `/api/workers` 执行器面（只用内部 token `Authorization: Bearer`，绝不带 `X-Agent-License`）。租约 10 分钟：`note`/`step doing` 每次上报即续租，采收按词、按视频上报保活；409 WORKER_BUSY 先把本机记录的旧任务 complete 成 superseded 再试一次，仍 409 静默降级。失败自动补三件套（前台包名 `dumpsys window`、诊断行、screencap）。全部 `curl -m 3`，失败只记日志绝不阻塞主流程 |
| 3 挂钩 | `harvest-cron.sh` / `batch2.sh` / `outreach-tick.sh` | 采收：start（拉Commander/设备预检/取词单/采收主体/效果回写 5 步）→ 每步 done，batch2 每个词把「采收主体」步 note 更新成"词n: xxx"，退出路径 fail/done。触达：start（取单/拿锁/发送/核验 4 步）→ done/fail |

配置：`~/.config/zenithjoy/wall.env`（chmod 600）：`ZJ_API_BASE`、`ZJ_LICENSE`、`ZJ_INTERNAL_TOKEN`。脚本用 bash（3.2 兼容），CI ubuntu 无 zsh 也能测；图片缩放命令可注入（macOS `sips`，测试用直通）。

## 为什么改

- 0919 勘察：控制塔生产库 0 条任务、两库 24h 内 0 帧；四台机房手机由 crontab+裸 adb 驱动，日志只落本机文件——主理人"抓瞎"。
- 不做 APK（主理人明确）、不做远程控制（主理人明确"只要可视化"）、不做 WebRTC/scrcpy（调研结论：1 fps 截图对"看一眼它在干嘛"够用，毫秒级只有接管才需要）。
- 复用 register upsert（按 tenant+hostname，hostname 用 phone-<序列号> 保证唯一）= 不用手工维护映射表，且 last_seen 刷新让卡片显示在线。

## 关联上下文

- Journey 24987ee5（安卓端多平台自动发布，控制塔挂在这）；决策 e14297d4（控制塔第一刀）、dce74be9（POST 面 license 鉴权）、8dd822c4（信号桥置换 keyword_acquisition）
- 撞车检查：open PR #1751 是 Windows 桌面上墙（件3），范围不同，不冲突
- 记忆：handoff_0919_phone_visibility_wiring_map、research_0919_phone_fleet_control_reports

## 影响范围

- 只加文件 + 在三个 zsh 脚本里各加几行 `wall-report` 调用（失败不阻塞）。不改 apps/api、不改 APK、不改 OpenClaw 网关配置。
- 机器副本：M4/M1 `~/bin-harvest/` 与仓库 md5 一致（0919 核实），部署 = scp 覆盖 + launchctl load。
- 已知债（不在本刀）：APK 行与推帧器行是同一台手机的两张卡（machine_id 一个是安卓指纹一个是序列号）；1Password「ZenithJoy Internal Token」与 staging/prod 容器实际 token 不一致（账实分叉，另开单）。

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 手机"在线"判定 | 推帧成功即在线 / register 心跳刷 last_seen | register 每 60 s 一次刷 last_seen（3 分钟窗口） | normMachine 只看 last_seen | 卡片误显离线，仅显示问题 |
| 失败三件套里的前台包名 | dumpsys window mCurrentFocus / dumpsys activity | mCurrentFocus 正则 | douyin-phone-adb 同法 | 现场包名错，排障多绕一步 |
| 帧过大 | 拒发 / 降质重压 | 先 q55@360 宽，>120KB 再 q35 重压一次，仍超则跳过该帧 | 服务端 413 | 少一帧，无害 |

## 前置工作（已确认）

- [x] staging `POST /api/workers/<uuid>/frame` 用内部 token 返回 202（0919 21:2x 实测）
- [x] license `ZJ-E-ALEX5211` 在 staging 有效，租户 b0058fb7（Personal-Alex-尊享）
- [x] 内部 token：以 staging/prod 容器 `printenv ZENITHJOY_INTERNAL_TOKEN` 为准（两者一致）
- [x] M4（用户 jinnuoshengyuan）/M1（用户 xx-macmini）都有 `/usr/bin/sips`、adb、`~/bin-harvest/`、launchd 样板 `com.zenithjoy.logstreampush.plist`
- [x] 四台手机 adb 在线：M4 ANGYVB4227006983 / ANGYVB4402004137；M1 ANGYVB4311010223 / e6c7ef34
- [x] 单帧实测：抓屏 0.78 s + 压缩 0.07 s，288×640 约 25 KB

## 验收标准

- [ ] 单测（node --test，CI L3）：假 adb + 本地假中台，推帧器一轮：register 带 license/machine_id → 帧 POST 为 image/jpeg 且 ≤120KB → 缓存文件写入；上报器 start/step/done/fail 请求体正确，fail 必带三件套；缺配置/中台不可达时退出码 0 且不阻塞
- [ ] smoke `.github/workflows/scripts/smoke/phone-wall-push-smoke.sh`：语法闸 + 三脚本已挂钩（grep wall-report）+ 假服务端跑一轮；接进 ci-l3 与 smoke-baseline
- [ ] 变异自证：把帧上限改 1KB 看单测报红；把挂钩删掉看 smoke 报红
- [ ] **真机验收（staging）**：M4/M1 部署后，`GET /api/workers/<uuid>/activity` 的 `frame_age_ms < 3000`，`/dashboard/workers` 卡片显示在线且实时页有画面与真机一致；跑一轮 `harvest-cron.sh`（或触达 tick）后详情页出现步骤流
- [ ] CI 全绿
