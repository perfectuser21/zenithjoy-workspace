# Bug PrepPRD：智能获客录制的音量棘轮把办公室吵死

Brain task: 0bb7c5f2-aed5-476a-8410-1daa8a299d0c
GP-Anchor: line02/keyword_acquisition keep-green

## 症状

西安办公室噪音不可忍。生产两台采收手机的媒体音量被顶到 12/17 与 10/17，
非录制阶段（搜索/刷卡片/开评论区/采集/私信）全程大音量外放。

## 根因（2026-09-24 真机实测钉死）

`services/phone-adb-controller/douyin-phone-adb` record_start：
每录一条视频无条件按两次 `KEYCODE_VOLUME_UP`，录完从不复位
→ 每条视频 +2 的单向棘轮，一路爬到接近满格。

该双击是 2026-09-12 为治"判定阶段静音空转"加的（抖音从外链进默认静音，
录到 -91dB 死寂 → 通义 ASR 报 ASR_RESPONSE_HAVE_NO_WORDS）。治对了病，
但没做对称复位。

## 实测依据（xian-m1 ANGYVB4311010223，同型号 HONOR MAA-AN00 / Android 15，每档录 10s）

| 媒体音量 | mean_volume | max_volume | 结论 |
|---|---|---|---|
| 0 | -91.0 dB | -91.0 dB | 死寂，ASR 必挂 |
| 1 | -35.4 dB | -25.0 dB | 与大音量等价 |
| 4 | -35.3 dB | -24.9 dB | — |
| 0（复测） | -91.0 dB | -91.0 dB | 可复现 |

结论：REMOTE_SUBMIX 采集电平是**开关行为**，不随媒体音量线性衰减。
0 = 硬静音录不到，≥1 = 满格音质。

补充实测：`cmd media_session volume --stream 3 --set N` 在该机型上只声明
`will set volume to index=N` 但不生效，程序化设音量被系统挡掉，只能走物理键事件。

## 关联上下文

- Journey/能力节点：line02 / keyword_acquisition
- 历史决策：2026-09-24 Alex 拍板（category=invariant）——录前驱动到 1，
  录完不复位不压回 0（1/17 办公室已听不见，压回 0 多按键多弹浮层，收益不抵成本）

## 修法

1. `douyin-phone-adb` 新增幂等函数 `ensure_media_volume <target>`：
   读当前值（`cmd media_session volume --stream 3 --get`）→ 按差值精确
   驱动 VOLUME_UP / VOLUME_DOWN → 有界重试上限，读不到时降级为一次 VOLUME_UP
   并 warning。
2. `record_start` 改调 `ensure_media_volume 1`，删除无条件双击。
3. `record_stop` 不动（决策：不复位）。
4. `deploy.sh` 把 `douyin-phone-adb` 加进 `DEVICE_SH_FILES`，并清掉那条已过期的
   排除理由（它是纯 zsh 脚本，与仓库版字节一致 137843，不是编译后二进制）。

副作用为正：稳态下音量已是 1 → 一次键都不按，音量浮层不再弹
（现状是每条视频必弹两次，本身就是视觉定位的干扰源）。

## Regression Test 计划

`phone-adb-controller-smoke.sh` 新增一层（逻辑守卫，CI）：
- 断言 `douyin-phone-adb` 存在 `ensure_media_volume` 定义
- 断言 `record_start` 调用 `ensure_media_volume 1`
- 断言 `record_start` 里不再有无条件连续双 `KEYCODE_VOLUME_UP`
- 断言 `deploy.sh` 的 `DEVICE_SH_FILES` 含 `douyin-phone-adb`

每条逐一变异测试（改坏→亲眼看它报红→恢复）达成 proven-to-fire。

环境接缝（真机音量行为）CI 测不到，已由本次真机三档 dB 对照实测覆盖。

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 当前媒体音量读取 | ①`cmd media_session volume --get` 解析 ②`dumpsys audio` 解析 | ①`cmd media_session volume --stream 3 --get` 抓 `volume is N` | 真机实测稳定返回 `volume is N in range [0..17]`；dumpsys 输出格式跨机型差异大 | 读不到→降级单次 VOLUME_UP（等价于旧行为的一半），不会静默录到死寂 |

## 前置工作

- [x] 真机：xian-m4 两台生产机 + xian-m1 一台同型号（已用于实测）
- [x] 无需新凭据
- [x] GP 锚点：leadgen/keyword_acquisition（product-map 已有）

## 不包含

- 不改 `record_stop`（决策已定：不复位）
- 不改 scrcpy 采集参数（`--audio-source=output` 默认行为正确）
- 不改 3 倍速播放逻辑

## 验收标准

- [ ] failing smoke 先 commit（RED）
- [ ] 修复代码让 smoke 变绿（GREEN）
- [ ] 四条守卫逐条变异测试 proven-to-fire
- [ ] 真机验证：跑一次 record-start/stop/extract-audio，音量停在 1，录到 dB ≈ -35
- [ ] CI 全绿
