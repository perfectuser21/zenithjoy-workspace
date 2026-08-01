# Handoff：测试设备基建打通（4台PC + 2台安卓可用 + 第二个CI runner）

- task_id: unknown（交互式运维，未注册 Brain task）
- journey_id: 无（基建，不挂 GP）
- verdict: PASS（基建目标达成，遗留 3 项均已定位根因）
- created_at: 2026-08-01T03:00:00.000Z

## 背景：为什么做这件事

用户诉求链条（从上一个 handoff 的业务线健康页面延伸出来）：
1. 想看每条业务线各环境跑的是什么版本 → 已交付（PR #1548/#1550/#1551）
2. 想让测试机去跑 **Line02 智能获客**（安卓端）E2E 找 bug
3. **核心担忧**：不同品牌/不同安卓版本会导致同一个 E2E 表现不同，现在发现不了

第 3 点是这次所有工作的驱动力。用户原话："我担心的比如说不同品牌，不同安卓型号，
对吧？你可能都会导致我们同一个 E2E test，然后你在这儿有那个问题。"

## 完成

### 设备接入（从 0 到可远程操控）
- **5台PC全部 SSH 打通**（1/3/4/5号机 + rog），`~/.ssh/config` 已配别名 `xian-pc/xian-pc2/xian-pc3/xian-pc4/xian-5060/xian-rog`
- 认证用 ed25519 短密钥 `~/.ssh/id_ed25519_zenithjoy_bootstrap`（RSA 长公钥跨机器转发屡次被吃字符）
- Windows Administrator 公钥必须写系统级 `C:\ProgramData\ssh\administrators_authorized_keys`
- 全部关闭休眠（`powercfg standby-timeout-ac 0`），常在线
- 3台安卓手机无线调试配对打通（小黄/小白/小粉），**不绑定任何PC，任意PC可连任意手机**
- adb 装到 1/3/4/5 号机 `C:\platform-tools\adb.exe`

### 修掉一个隐藏的 CI 单点故障（价值最高的一项）
rog 的 GitHub Actions runner 原先是**手动 `run.cmd` 挂在控制台会话跑的**——机器重启/注销就死。
这是"rog 一掉线整条 CI 就断"的真根因，之前一直被当成网络问题。
已改成 Windows 服务 + 开机自启（`actions.runner.perfectuser21.zenithjoy-workspace.xian-rog-wechat`）。

### 新增第二个 runner（解开安卓E2E的结构性死结）
**关键发现：办公室有两个互不相通的内网段，rog 和手机池不在同一段，实测够不到。**
所以把安卓 E2E 挂在 rog 上从架构上就是错的——它只能测自己 USB 上那一台（而那台还坏了）。

新注册 `xian-pc4-android`（4号机，与手机池同网段），标签 `self-hosted,android-capable,Windows,X64`，
服务模式 + 开机自启。**已实测：该 runner 能同时驱动小粉+小白两台手机**。

> 具体网段划分/主机地址/序列号见 memory `machines.md`（不入库，避免仓库文档承载内网拓扑细节）。

### 手机池自愈守护
`C:\platform-tools\watchdog.ps1`（4号机）+ 定时任务 `ZJPhonePoolWatchdog`，每5分钟：
mDNS发现手机 → 重连 → Agent没跑就拉起 → 补电池白名单+永不息屏 → 电量<40%且没插电则告警。
日志 `C:\platform-tools\watchdog.log`。

### 顺手修的
- 三台手机的 Agent App **全都停了**（最久2天没心跳），已远程拉起，小粉小白心跳恢复
- 两台手机加了 `deviceidle whitelist`（防后台被杀）

## 未完成（三项，均已定位根因，不是未知问题）

### 1. 手机矩阵 E2E ← **这是下一步该做的，也是用户最想要的**
`.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh:49`：
```bash
DEV=$("$ADB" devices | awk '/[[:space:]]device$/{print $1; exit}')
```
`exit` = **抓到第一台就停**。所以现在：只测一台、测的是哪台不确定、另外两台机型的兼容 bug 永远发现不了。
这正是用户担忧的问题在代码里的具体形态。

改法：
- `e2e-line02-android-collect.yml:46` 的 `runs-on: [self-hosted, wechat-capable]` → 改成 `android-capable`（用新runner）
- 加 matrix strategy，三台手机各跑一个并行 job，按序列号 `-s` 锁定设备
- smoke 脚本支持 `ANDROID_SERIAL` 环境变量指定设备，而不是抓第一台

矩阵价值：小粉红了但另两台绿 → 立刻知道是 Android 13 特有问题，
不用像上次那样把一个根因（WS 401）当成三个独立 bug 排查（见 `docs/android-device-compatibility-matrix.md`）。

### 2. 配置脚本化
今天所有配置（装adb、关休眠、分发密钥、装runner、装守护）**全是手敲 SSH 命令**，不在版本控制里。
机器一重装全部丢失。建议加 `scripts/setup-test-machine.ps1` 把这套固化成可复现脚本。

### 2b. PC 侧无监控（守护只覆盖手机）
`watchdog.ps1` 只巡检手机池。**PC 本身掉线（如 rog 今天反复失联）没有任何自动发现机制**，
全靠人工 `ssh` 撞上才知道。建议扩展守护或另建：定期探活 5 台 PC + 2 个 runner 状态，异常告警。

### 3. 三台设备待人工（都是物理层，远程无解）
- **2号机 PC**：sshd 起不来报 `Couldn't open /dev/null`，已排查网络/权限/执行策略/系统日志/杀软全正常，未解决
- **小黄（MAA-AN00）**：重启后停在锁屏（BFU 状态），安卓全盘加密下 adbd 拒绝一切连接。
  判据：MTP 设备可见但 `ITEM COUNT: 0`。**需人解锁**（输密码），解锁后自动恢复，不用重新配对
- **第4台安卓（rog USB 上）**：物理断开。已试 adb kill-server/reconnect、单设备重新枚举、
  `pnputil /scan-devices`、**USB根集线器整体断电重启**——全无效。需人重插/换数据线

## 下一步（建议顺序）

1. **改 workflow 做矩阵 E2E**（走 /dev，改代码）——直接兑现用户的核心诉求
2. 配置脚本化 `setup-test-machine.ps1`
3. 微信客服 E2E 的备份 runner（现仍是 rog 单点，需另一台装微信4.1.8 + 独立微信号，属成本项待拍板）

## 数据源

- **设备台账（权威，先读这个）**：memory `machines.md` —— 含全部设备IP/序列号/网段/踩坑/命令模板
- 员工操作手册（公网免登录）：https://docs.zenjoymedia.media/phone-adb-setup.html
- 手机心跳查询：`zenithjoy_staging` 库（不是 `zenithjoy` 生产库）
- 待改的文件：`.github/workflows/e2e-line02-android-collect.yml`、
  `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`

## 关键踩坑（避免重复劳动）

1. **操作手机一律从 3/4/5 号机发起**（与手机池同网段）。走 Tailscale 跨国会退化成 DERP 中转
   300-700ms，adb TCP 握手直接超时。1号机/rog 在另一网段，够不着手机
2. 手机 IP 是 DHCP 会变，**用 `adb mdns services` 发现，别写死**
3. adb 授权是 per-电脑的。1号机密钥已分发给 3/4/5 号机共享；**rog 用的是另一把**（指纹不同）
4. 国内机器从 GitHub 下大文件只有 0.04~0.09 MB/s，**开 HK exit node 反而更慢**（GFW 入境限速）。
   正解走 COS 中转：美国下载→`coscmd upload`→国内拉，实测 **17 MB/s，快400倍**
5. `config.cmd --runasservice` 在中文 Windows 报 `CreateService failed 1783`，
   改用 `sc.exe create <名> binPath= C:\actions-runner\bin\RunnerService.exe start= auto`
6. 手机失联的头号杀手是**重启后没人解锁**（BFU），不是没电——一次重启同时打死
   ADB/Tailscale/Agent 三条通道，看着像三个故障其实一个根因。建议手机设免密码开机

## 产物

- 无 PR（本次全是运维配置，未改仓库代码）
- memory `machines.md` 已全面更新（设备清单/命令模板/踩坑/收盘状态）
- 4号机：`C:\actions-runner\`（runner）、`C:\platform-tools\watchdog.ps1`（守护）
- 公网手册：https://docs.zenjoymedia.media/phone-adb-setup.html
