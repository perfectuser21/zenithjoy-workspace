# 录制音量棘轮修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `record_start` 把手机媒体音量幂等驱动到 1（而不是每条视频无脑 +2 且永不复位），消灭把西安办公室吵死的音量棘轮，同时保证录制音轨不退化。

**Architecture:** 在 `douyin-phone-adb` 新增 `media_volume()`（读）+ `ensure_media_volume()`（幂等驱动）两个 zsh 函数，`record_start` 用一行调用替换原来的两次无条件 `KEYCODE_VOLUME_UP`；`deploy.sh` 把该控制器纳入自动下发清单（否则改动到不了手机机）；`phone-adb-controller-smoke.sh` 新增层25 四条静态守卫锁死这三件事。

**Tech Stack:** zsh（设备控制器）、bash（deploy / smoke）、adb `cmd media_session volume`、GitHub Actions smoke。

**Spec:** `docs/superpowers/specs/2026-09-24-record-media-volume-ratchet-fix-design.md`

**GP-Anchor:** `line02/keyword_acquisition keep-green`

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/phone-adb-controller/douyin-phone-adb` | Modify | 新增常量 `RECORD_MEDIA_VOLUME`、函数 `media_volume` / `ensure_media_volume`；改写 `record_start:1569-1576` |
| `services/phone-adb-controller/deploy.sh` | Modify | `DEVICE_SH_FILES` 加 `douyin-phone-adb`；删掉已过期的"编译后二进制"排除说明 |
| `.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh` | Modify | 末尾（`echo "phone-adb-controller-smoke: PASS"` 之前）新增层25 四条守卫 |

本仓库该控制器的既有守卫形态一律是 smoke 静态断言（它是单文件 zsh 可执行脚本，尾部即命令分发，无法 source 后隔离调用单个函数），因此本计划的 RED 步骤是先写 smoke 守卫并看它报红。

---

### Task 1: 先写会失败的 smoke 守卫（RED）

**Files:**
- Modify: `.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`（在最后一行 `echo "phone-adb-controller-smoke: PASS"` 之前插入）

- [ ] **Step 1: 写四条守卫**

在 `.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh` 中，找到最后一行：

```bash
echo "phone-adb-controller-smoke: PASS"
```

在它**之前**插入下面整段（注意本文件头部死规矩：对变量做 grep 一律用 here-string）：

```bash
# 层25: 录制前音量必须幂等驱动到 RECORD_MEDIA_VOLUME,不能再无脑 VOLUME_UP x2
# (0924 真机复盘: record_start 每条视频无条件按两次 KEYCODE_VOLUME_UP 且录完不复位,
#  形成 +2 单向棘轮,生产两台实测爬到 12/17 和 10/17,非录制阶段全程大音量外放,
#  西安办公室不可忍。同轮实测钉死:媒体音量 0 录到 -91dB 死寂、1 录到 -35.4dB、
#  4 录到 -35.3dB —— 采集电平是开关行为不随音量衰减,故驱动到 1 即零音质损失。
#  另证抖音不存在独立 app 内静音标志,稳态零按键安全。)
grep -qE '^RECORD_MEDIA_VOLUME=' "$C" || fail "douyin-phone-adb 缺 RECORD_MEDIA_VOLUME 常量(录制目标音量没有单一出处)"
grep -qE '^ensure_media_volume\(\)' "$C" || fail "douyin-phone-adb 缺 ensure_media_volume() 幂等音量驱动函数"
grep -qE 'ensure_media_volume "\$RECORD_MEDIA_VOLUME"' "$C" || fail "record_start 没有调用 ensure_media_volume \"\$RECORD_MEDIA_VOLUME\"(音量棘轮会复发)"
_RS_BODY="$(sed -n '/^record_start()/,/^}/p' "$C")"
_RS_VOLUP_COUNT="$(grep -c 'KEYCODE_VOLUME_UP' <<< "$_RS_BODY" || true)"
[[ "$_RS_VOLUP_COUNT" == "0" ]] || fail "record_start 里仍有 $_RS_VOLUP_COUNT 处裸 KEYCODE_VOLUME_UP(音量棘轮的病根,必须全部收进 ensure_media_volume)"
_DEVICE_LIST="$(sed -n '/^DEVICE_SH_FILES=(/,/^)/p' "$D/deploy.sh")"
grep -qE '(^|[[:space:]])douyin-phone-adb([[:space:]]|$)' <<< "$_DEVICE_LIST" || fail "deploy.sh 的 DEVICE_SH_FILES 漏了 douyin-phone-adb(改了控制器却到不了手机机)"
```

- [ ] **Step 2: 跑守卫确认它报红**

Run: `bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`
Expected: FAIL，输出
`::error::phone-adb-controller-smoke: douyin-phone-adb 缺 RECORD_MEDIA_VOLUME 常量(录制目标音量没有单一出处)`

- [ ] **Step 3: 提交 RED**

```bash
git add .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh
git commit -m "test(leadgen): 层25 录制音量幂等守卫(RED,音量棘轮回归防线)

GP-Anchor: line02/keyword_acquisition keep-green

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 实现幂等音量驱动（GREEN 第一半）

**Files:**
- Modify: `services/phone-adb-controller/douyin-phone-adb`

- [ ] **Step 1: 加常量**

在第 85 行 `DOUYIN_PACKAGE="com.ss.android.ugc.aweme"` 之后插入：

```zsh
# 录制前把手机媒体音量幂等驱动到这一档（0924 Alex 拍板，decisions invariant）。
# 1 = 17 档里的最低非零档：办公室已听不见，而采集电平与大音量完全等价（见下方 ensure_media_volume 注释）。
RECORD_MEDIA_VOLUME=1
```

- [ ] **Step 2: 加两个函数**

在第 1551 行 `record_start() {` 之**前**插入：

```zsh
# media_volume：读当前媒体音量（0..max），读不到输出空串。
# 实测：HONOR MAA-AN00/Android 15 上 `cmd media_session volume --stream 3 --get`
# 稳定回 "volume is N in range [0..17]"；dumpsys audio 的格式跨机型差异大，不用。
media_volume() {
  "$ADB" -s "$SERIAL" shell cmd media_session volume --stream 3 --get 2>/dev/null \
    | /usr/bin/grep -o 'volume is [0-9]*' | /usr/bin/tail -1 | /usr/bin/grep -o '[0-9]*$'
}

# ensure_media_volume <target>：把媒体音量幂等驱动到 target。
#
# 2026-09-24 真机实测（xian-m1 ANGYVB4311010223，scrcpy --audio-source=output 各录 10s）：
#   媒体音量 0 → mean_volume -91.0 dB（死寂，通义 ASR 报 ASR_RESPONSE_HAVE_NO_WORDS）
#   媒体音量 1 → mean_volume -35.4 dB
#   媒体音量 4 → mean_volume -35.3 dB
# 即 REMOTE_SUBMIX 采集电平是开关行为、不随音量线性衰减：0 录不到，≥1 就是满格。
#
# 同轮实测纠正了 0912 写下的一条误判——当时注释称"外链/详情页打开的抖音视频默认静音播放，
# 按物理音量键触发 unmute"。实际不存在独立的 app 内静音标志：全新进程经外链打开详情页、
# 音量已在 1、全程不按任何音量键 → 录到 -36.1 dB（另一条视频复测 -37.9 dB）。当年双击
# VOLUME_UP 之所以管用，只是因为把音量从 0 抬起来了。故稳态无需任何 unmute 按键。
#
# 旧实现每条视频无条件按两次 VOLUME_UP 且录完不复位 = +2 单向棘轮，生产两台爬到
# 12/17 和 10/17，非录制阶段全程外放（录制期间反而是静的：--audio-source=output
# 的语义就是 disables playback on the device）。改为幂等驱动后稳态零按键，
# 音量浮层也不再弹——那玩意儿本身就是视觉定位的干扰源。
#
# 注：该机型上 `--set N` / `--adj raise|lower` 只回显不生效，只能走 input keyevent。
ensure_media_volume() {
  local target="$1" cur i=0
  require_uint "$target"
  cur="$(media_volume)"
  if [[ -z "$cur" ]]; then
    # 读不到音量（ROM 差异 / adb 抖动）：降级按一次 VOLUME_UP 保证不是 0。
    # 宁可略吵，不可静默录出 -91dB 死寂让整条判定链假绿。
    print -u2 -- "warning: media volume unreadable; falling back to single VOLUME_UP"
    "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_VOLUME_UP >/dev/null 2>&1
    wait_ms 400
    MEDIA_VOLUME_NOW=unknown
    return 0
  fi
  while [[ "$cur" -ne "$target" && $i -lt 30 ]]; do
    if [[ "$cur" -gt "$target" ]]; then
      "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_VOLUME_DOWN >/dev/null 2>&1
    else
      "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_VOLUME_UP >/dev/null 2>&1
    fi
    wait_ms 250
    cur="$(media_volume)"
    [[ -z "$cur" ]] && break
    i=$((i+1))
  done
  MEDIA_VOLUME_NOW="${cur:-unknown}"
  [[ "$MEDIA_VOLUME_NOW" == "$target" ]] \
    || print -u2 -- "warning: media volume settled at $MEDIA_VOLUME_NOW (target $target)"
}
```

- [ ] **Step 3: 改 record_start**

把第 1569-1576 行这 8 行：

```zsh
  # 取消静音（0912 根治判定阶段静音空转）：通过外部链接/详情页打开的抖音视频默认静音播放，
  # scrcpy output 源录到的是 -91dB 死寂 → 通义 ASR 报 ASR_RESPONSE_HAVE_NO_WORDS → 判定必失败。
  # 抖音视频静音时按物理音量键会触发 unmute（详情页无可点的静音控件，自绘不进无障碍树）。
  # 连按两次 KEYCODE_VOLUME_UP 确定性取消静音；实测 unmute 后稳定录到 -37dB，通义逐字转写成功。
  "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_VOLUME_UP >/dev/null 2>&1
  wait_ms 400
  "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_VOLUME_UP >/dev/null 2>&1
  wait_ms 600
```

整体替换为这 3 行：

```zsh
  # 媒体音量必须非 0 否则录到 -91dB 死寂（ASR 必挂）；幂等驱动到最低非零档，
  # 稳态零按键、不再形成音量棘轮。依据见 ensure_media_volume 注释。
  ensure_media_volume "$RECORD_MEDIA_VOLUME"
```

- [ ] **Step 4: 改 record_started 输出行**

把第 1588 行：

```zsh
  print -- "record_started pid=$pid path=$out max_seconds=$max"
```

改为：

```zsh
  print -- "record_started pid=$pid path=$out max_seconds=$max media_volume=${MEDIA_VOLUME_NOW:-unknown}"
```

- [ ] **Step 5: 语法检查**

Run: `zsh -n services/phone-adb-controller/douyin-phone-adb`
Expected: 无输出（退出码 0）

- [ ] **Step 6: 提交**

```bash
git add services/phone-adb-controller/douyin-phone-adb
git commit -m "fix(leadgen): record_start 音量改为幂等驱动到 1,拆掉 +2 单向棘轮

GP-Anchor: line02/keyword_acquisition keep-green

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 把控制器纳入自动下发清单（GREEN 第二半）

**Files:**
- Modify: `services/phone-adb-controller/deploy.sh`

- [ ] **Step 1: 删掉已过期的排除说明**

删除第 20 行：

```bash
#   - douyin-phone-adb 编译后二进制: 单独构建/发版流程,盲目覆盖有版本不匹配风险
```

理由写进 Step 2 的清单注释，不留悬空。

- [ ] **Step 2: 把控制器加进 DEVICE_SH_FILES**

把第 41-46 行：

```bash
DEVICE_SH_FILES=(
  harvest-keyword.sh batch2.sh harvest-cron.sh outreach-tick.sh
  refill-profile-links.sh wall-report.sh wall-lib.sh phone-wall-push.sh
  disk-gateway-guard.sh device-job-claimer.sh log-stream-push.sh
  workflow-result.sh escort-claude-escalation.sh
)
```

替换为：

```bash
# douyin-phone-adb 于 0924 补进本清单:此前被当成"编译后二进制、单独发版"排除在外,
# 实测该说法与事实不符——机器上 ~/bin-harvest/douyin-phone-adb 与仓库版字节完全一致
# (137843),file 判定为 zsh script text executable,也不存在任何单独构建流程。
# 不下发 = 改了控制器却永远到不了手机机(0924 音量棘轮修复就差点栽在这)。
DEVICE_SH_FILES=(
  douyin-phone-adb
  harvest-keyword.sh batch2.sh harvest-cron.sh outreach-tick.sh
  refill-profile-links.sh wall-report.sh wall-lib.sh phone-wall-push.sh
  disk-gateway-guard.sh device-job-claimer.sh log-stream-push.sh
  workflow-result.sh escort-claude-escalation.sh
)
```

- [ ] **Step 3: 语法检查**

Run: `bash -n services/phone-adb-controller/deploy.sh`
Expected: 无输出（退出码 0）

- [ ] **Step 4: 跑 smoke 确认全绿**

Run: `bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`
Expected: 最后一行 `phone-adb-controller-smoke: PASS`

- [ ] **Step 5: 提交**

```bash
git add services/phone-adb-controller/deploy.sh
git commit -m "fix(leadgen): douyin-phone-adb 补进自动下发清单,排除理由已过期

GP-Anchor: line02/keyword_acquisition keep-green

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 四条守卫逐条变异测试（proven-to-fire）

**Files:** 无改动（只做验证，每步结束必须把文件恢复原状）

- [ ] **Step 1: 变异守卫1（RECORD_MEDIA_VOLUME 常量）**

```bash
sed -i '' 's/^RECORD_MEDIA_VOLUME=1/RECORD_MEDIA_VOLUME_X=1/' services/phone-adb-controller/douyin-phone-adb
bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh; echo "exit=$?"
git checkout -- services/phone-adb-controller/douyin-phone-adb
```

Expected: 报 `缺 RECORD_MEDIA_VOLUME 常量`，`exit=1`

- [ ] **Step 2: 变异守卫2（ensure_media_volume 定义）**

```bash
sed -i '' 's/^ensure_media_volume() {/ensure_media_volume_x() {/' services/phone-adb-controller/douyin-phone-adb
bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh; echo "exit=$?"
git checkout -- services/phone-adb-controller/douyin-phone-adb
```

Expected: 报 `缺 ensure_media_volume() 幂等音量驱动函数`，`exit=1`

- [ ] **Step 3: 变异守卫3+4（record_start 调用 与 裸 VOLUME_UP）**

把 `record_start` 里那行 `ensure_media_volume "$RECORD_MEDIA_VOLUME"` 换回裸按键：

```bash
sed -i '' 's|  ensure_media_volume "\$RECORD_MEDIA_VOLUME"|  "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_VOLUME_UP >/dev/null 2>\&1|' services/phone-adb-controller/douyin-phone-adb
bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh; echo "exit=$?"
git checkout -- services/phone-adb-controller/douyin-phone-adb
```

Expected: 先报 `record_start 没有调用 ensure_media_volume`，`exit=1`
（该变异同时触发守卫4；守卫3 在前先命中即可，守卫4 由 Step 4 单独证明）

- [ ] **Step 4: 单独变异守卫4（裸 VOLUME_UP 计数）**

在 `record_start` 里 `ensure_media_volume "$RECORD_MEDIA_VOLUME"` 那行**之后**临时加一行裸按键：

```bash
sed -i '' 's|  ensure_media_volume "\$RECORD_MEDIA_VOLUME"|  ensure_media_volume "$RECORD_MEDIA_VOLUME"\n  "$ADB" -s "$SERIAL" shell input keyevent KEYCODE_VOLUME_UP >/dev/null 2>\&1|' services/phone-adb-controller/douyin-phone-adb
bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh; echo "exit=$?"
git checkout -- services/phone-adb-controller/douyin-phone-adb
```

Expected: 报 `record_start 里仍有 1 处裸 KEYCODE_VOLUME_UP`，`exit=1`

- [ ] **Step 5: 变异守卫5（deploy.sh 清单）**

```bash
sed -i '' 's/^  douyin-phone-adb$//' services/phone-adb-controller/deploy.sh
bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh; echo "exit=$?"
git checkout -- services/phone-adb-controller/deploy.sh
```

Expected: 报 `DEVICE_SH_FILES 漏了 douyin-phone-adb`，`exit=1`

- [ ] **Step 6: 确认全部恢复且 smoke 全绿**

```bash
git status --porcelain services/phone-adb-controller/
bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh
```

Expected: `git status` 无输出；smoke 输出 `phone-adb-controller-smoke: PASS`

---

### Task 5: 真机验证（环境接缝，CI 测不到）

**Files:** 无改动

- [ ] **Step 1: 把改好的控制器下发到空闲测试机**

```bash
scp -q services/phone-adb-controller/douyin-phone-adb xian-m1:~/bin-harvest/douyin-phone-adb
ssh xian-m1 'chmod +x ~/bin-harvest/douyin-phone-adb && zsh -n ~/bin-harvest/douyin-phone-adb && echo SYNTAX_OK'
```

Expected: `SYNTAX_OK`

- [ ] **Step 2: 把测试机音量故意打到高位，验证幂等驱动会把它压回 1**

```bash
ssh xian-m1 'for i in $(seq 1 8); do /opt/homebrew/bin/adb -s ANGYVB4311010223 shell input keyevent KEYCODE_VOLUME_UP; sleep 0.2; done; /opt/homebrew/bin/adb -s ANGYVB4311010223 shell cmd media_session volume --stream 3 --get 2>&1 | grep -o "volume is [0-9]*"'
```

Expected: 打印一个明显大于 1 的音量（如 `volume is 9`）

- [ ] **Step 3: 跑一轮真实录制**

```bash
ssh xian-m1 '~/bin-harvest/douyin-phone-adb --profile xiaolongxia record-start volratchet-verify 12 && sleep 15 && ~/bin-harvest/douyin-phone-adb --profile xiaolongxia record-stop volratchet-verify && ~/bin-harvest/douyin-phone-adb --profile xiaolongxia record-extract-audio volratchet-verify'
```

Expected: `record_started ... media_volume=1`、`record_stopped ... audio_streams=1`、`audio_extracted ...`

- [ ] **Step 4: 断言音量停在 1 且录到的不是死寂**

```bash
ssh xian-m1 '/opt/homebrew/bin/adb -s ANGYVB4311010223 shell cmd media_session volume --stream 3 --get 2>&1 | grep -o "volume is [0-9]*"; /opt/homebrew/bin/ffmpeg -i /private/tmp/openclaw-phone/evidence/xiaolongxia/volratchet-verify.rec.mkv -af volumedetect -f null - 2>&1 | grep mean_volume'
```

Expected: `volume is 1`，且 `mean_volume` 在 -45 dB 以上（远离 -91.0 dB 死寂）

- [ ] **Step 5: 清理测试证据**

```bash
ssh xian-m1 'rm -f /private/tmp/openclaw-phone/evidence/xiaolongxia/volratchet-verify.*'
```

Expected: 无输出

---

## Self-Review

**1. Spec coverage**
- spec「组件与改动点 1」（常量 + 两函数 + record_start + record_started 行）→ Task 2 Step 1-4 ✅
- spec「组件与改动点 2」（deploy.sh 清单 + 删排除说明）→ Task 3 Step 1-2 ✅
- spec「组件与改动点 3」（smoke 层25 四条）→ Task 1 Step 1 ✅
- spec「测试策略 · smoke proven-to-fire」→ Task 4 ✅
- spec「测试策略 · 真机环境接缝」→ Task 5 ✅
- spec「不包含」各项：本计划无任何任务触碰 `record_stop`、scrcpy 参数、倍速逻辑、
  dB 断言、plist/config 排除 ✅

**2. Placeholder scan**：无 TBD/TODO/"类似 Task N"；每个代码步骤均给出完整可粘贴代码与期望输出 ✅

**3. Type consistency**：`RECORD_MEDIA_VOLUME`、`media_volume`、`ensure_media_volume`、
`MEDIA_VOLUME_NOW` 四个标识符在 Task 1（守卫）、Task 2（实现）、Task 4（变异）中拼写一致 ✅
