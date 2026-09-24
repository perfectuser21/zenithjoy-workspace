# 智能获客录制音量棘轮修复 — 设计

Brain task: `0bb7c5f2-aed5-476a-8410-1daa8a299d0c`
GP-Anchor: `line02/keyword_acquisition keep-green`
决策: 2026-09-24 Alex 拍板（invariant + bug-fix 两条已入 `decisions`）

## 背景

主理人反馈西安办公室被采收手机的外放声吵到不可忍。初诊怀疑"录音必须外放才能拿到声音"，
实测推翻：录制期间设备扬声器本来就是哑的（scrcpy `--audio-source=output` 的语义即
"forwards the whole audio output, **and disables playback on the device**"）。

真实根因在 `services/phone-adb-controller/douyin-phone-adb` 的 `record_start`：
为治 2026-09-12 的"判定阶段静音空转"，它在每次录制前**无条件**按两次
`KEYCODE_VOLUME_UP`，且录完从不复位 —— 形成每条视频 +2 的单向棘轮。
生产两台手机实测已爬到 12/17 与 10/17，于是**非录制阶段**（搜索 / 刷卡片 /
开评论区 / 采集 / 私信）全程大音量外放。噪音来自这一段，不是录制那一段。

## 真机实测证据（2026-09-24，xian-m1 `ANGYVB4311010223`，HONOR MAA-AN00 / Android 15）

方法：`scrcpy --no-window --no-playback --record` 各录 10s，`ffmpeg -af volumedetect` 读电平。

### 实验一：采集电平 vs 媒体音量

| 媒体音量 | mean_volume | max_volume |
|---|---|---|
| 0 | -91.0 dB | -91.0 dB |
| 1 | -35.4 dB | -25.0 dB |
| 4 | -35.3 dB | -24.9 dB |
| 0（复测） | -91.0 dB | -91.0 dB |

**结论：REMOTE_SUBMIX 采集电平是开关行为，不随媒体音量线性衰减。0 录不到，≥1 即满格。**

### 实验二：抖音是否存在独立的「app 内静音标志」

旧注释断言"外链/详情页打开的抖音视频默认静音播放，按物理音量键触发 unmute"。
逐档验证（每档先 `am force-stop` 抖音再经 `am start -a VIEW -d <v.douyin.com 链接>`
打开详情页，确认 focus 落在 `DetailActivity`）：

| 档 | 场景 | mean_volume |
|---|---|---|
| T1 | 全新进程 + 外链开详情页 + 音量=1 + **全程不按任何音量键** | -36.1 dB |
| T2 | 同页 + VOLUME_UP 后 VOLUME_DOWN（净零，仍停 1） | -36.0 dB |
| T3 | 另一视频 + 全新进程外链 + 现生产做法 VOLUME_UP×2（音量=3） | -36.2 dB |
| T4 | 再一视频 + 全新进程外链 + 音量=1 + **不按键**复测 | -37.9 dB |

**结论：抖音不存在独立的 app 内静音标志。旧注释是误判——真实机制就是系统媒体音量为 0，
当年双击 VOLUME_UP 之所以管用，只是因为把音量从 0 抬起来了。**
因此"稳态零按键"安全，不需要任何 unmute 触发按键。

### 实验三：程序化设音量是否可用

`cmd media_session volume --stream 3 --set N` 在该机型上回显
`will set volume to index=N` 但音量不变；`--adj raise/lower` 同样无效。
`media volume` 命令不存在。**只能走 `input keyevent` 物理键事件。**
读取则可用：`cmd media_session volume --stream 3 --get` → `volume is N in range [0..17]`。

## 架构 / 数据流

```
harvest-keyword.sh 每条视频
  → douyin-phone-adb set-playback-speed 3.0
  → douyin-phone-adb record-start <eid> <secs>
       ├─ 【改】ensure_media_volume $RECORD_MEDIA_VOLUME   ← 幂等驱动到 1
       │     · 读 cmd media_session volume --stream 3 --get
       │     · 已等于 1 → 零按键（稳态常态，音量浮层不再弹）
       │     · 高于 1 → 按 VOLUME_DOWN 至 1；低于 1 → 按 VOLUME_UP 至 1
       │     · 读不到 → 降级按一次 VOLUME_UP + warning（宁可略吵不可录死寂）
       └─ scrcpy --no-window --no-playback --record --time-limit
  → record-stop（不动，决策：不复位音量）
  → record-extract-audio
```

## 组件与改动点

### 1. `services/phone-adb-controller/douyin-phone-adb`

**a. 新增常量**（与 `RECORD_DURATION_MS` 等录制常量同区）

```zsh
RECORD_MEDIA_VOLUME=1
```

**b. 新增两个函数**（置于 `record_start` 之前）

- `media_volume()` — 读当前媒体音量，解析 `volume is N`，读不到输出空串。
- `ensure_media_volume <target>` — 幂等驱动：读当前值 → 按差值方向逐次
  `KEYCODE_VOLUME_DOWN` / `KEYCODE_VOLUME_UP`，每次 `wait_ms 250` 后复读，
  循环上限 30 次防死循环；读不到时降级单次 `VOLUME_UP` 并 warning 到 stderr；
  把最终值写进全局 `MEDIA_VOLUME_NOW` 供调用方打点。

**c. `record_start` 改动**

删除那段"取消静音"注释 + 两次无条件 `KEYCODE_VOLUME_UP` + 两处 `wait_ms`，
换成一行 `ensure_media_volume "$RECORD_MEDIA_VOLUME"`。
注释重写为本文实测结论（纠正旧误判，保留为什么不能是 0 的依据）。
`record_started` 输出行追加 `media_volume=${MEDIA_VOLUME_NOW:-unknown}` 便于日志回溯。

### 2. `services/phone-adb-controller/deploy.sh`

把 `douyin-phone-adb` 加进 `DEVICE_SH_FILES`，并删掉"不在本次范围"里那条
`douyin-phone-adb 编译后二进制` 的排除说明——该说明与事实不符：机器上
`~/bin-harvest/douyin-phone-adb` 与仓库版**字节完全一致（137843）**，
`file` 判定为 `zsh script text executable`，不是二进制，也没有单独发版流程。
不下发则本修复合并后永远到不了手机机。

`DEVICE_SH_FILES` 的同步循环本就 `chmod +x` + `zsh -n` 校验，对该文件天然适用。

### 3. `.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`

新增「层25」（现有最大为层24）：

- `douyin-phone-adb` 含 `ensure_media_volume()` 定义
- `record_start` 调用 `ensure_media_volume "$RECORD_MEDIA_VOLUME"`
- `record_start` 中不再存在无条件连续两次 `KEYCODE_VOLUME_UP`
- `deploy.sh` 的 `DEVICE_SH_FILES` 含 `douyin-phone-adb`

按本文件头部死规矩，对变量做 grep 一律用 here-string。

## 判定点登记

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 当前媒体音量读取 | ① `cmd media_session volume --get` 解析 ② `dumpsys audio` 解析 | ① 抓 `volume is N` | 真机实测稳定返回 `volume is N in range [0..17]`；dumpsys 输出跨机型差异大 | 读不到 → 降级单次 VOLUME_UP，不会静默录到死寂 |

## 测试策略

**Unit**：不适用。`douyin-phone-adb` 是单文件 zsh 可执行脚本，尾部即命令分发，
无法 source 后隔离调用单个函数；本仓库该文件的既有守卫形态一律是 smoke 静态断言。

**Integration**：不适用。本改动不跨进程、不碰 DB、不碰 HTTP。

**E2E / smoke（本次主要守卫，逻辑接缝）**：
`phone-adb-controller-smoke.sh` 新增一层 4 条静态断言（见上）。每条逐一变异测试
（改坏 → 亲眼看它报红 → 恢复）达成 proven-to-fire。

**真机（环境接缝，CI 测不到）**：
本设计所依据的三组真机实验即为该接缝的验证；合并部署后再跑一次
`record-start / record-stop / record-extract-audio`，断言音量停在 1 且
`ffmpeg volumedetect` 读到 mean_volume ≈ -35 dB（远离 -91 dB 死寂）。

**Trivial（不单独测）**：
`record_started` 输出行追加字段——调用方 `harvest-keyword.sh` 对 record-start
的 stdout 是 `>/dev/null` 丢弃的，不存在解析破坏面。

## 不包含

- 不改 `record_stop`（决策已定：录完不复位、不压回 0；1/17 办公室已听不见，
  压回 0 会多按键、多弹一次音量浮层、增加撞视觉定位的风险，收益不抵成本）
- 不改 scrcpy 采集参数（`--audio-source=output` 默认行为正确）
- 不改 3 倍速播放逻辑
- 不在 `record_stop` 增加 dB 断言（真实无声视频会误伤，另行评估）
- 不动 `deploy.sh` 对 `*.plist` / `config/*.json` 的既有排除
