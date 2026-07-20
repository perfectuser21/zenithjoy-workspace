# Contract Draft: GP-A 语音管线迁移 → 火山引擎 RTC 对话式AI（thin）

**Sprint**: `07201229-gpa-voice-rtc-migration`
**Task ID**: `16179076-26eb-4d94-b9cf-f6a1c81e1a4d`
**Journey**: 智能客服 · GP-A 主动语音触达
**Maturity**: skeleton → thin

---

## Step 1：DB Migration — voice_call_records 新增 6 个延迟时间戳字段（N-4 幂等）

**来源**: `[FROM_PRD]` — PRD 变更地图 `apps/api/db/migrations/20260720_voice_call_rtc_timestamps.sql`；NFR N-4（Migration 幂等，ADD COLUMN IF NOT EXISTS）

**可观测行为**:
[BEHAVIOR] Migration 文件 `20260720_voice_call_rtc_timestamps.sql` 存在于 `apps/api/db/migrations/` 目录
[BEHAVIOR] 文件含 `ADD COLUMN IF NOT EXISTS` 关键字，确保幂等性
[BEHAVIOR] 文件含全部 6 个延迟时间戳字段：`rtc_token_issued_at`、`sidecar_joined_at`、`ai_agent_joined_at`、`first_audio_at`、`tts_first_byte_at`、`cleanup_done_at`

**验证命令**:
```bash
FILE=apps/api/db/migrations/20260720_voice_call_rtc_timestamps.sql
test -f "$FILE" && echo "PASS: migration file exists" || echo "FAIL: migration file missing"
grep -c "ADD COLUMN IF NOT EXISTS" "$FILE" | grep -q "^[1-9]" && echo "PASS: idempotent" || echo "FAIL: not idempotent"
for col in rtc_token_issued_at sidecar_joined_at ai_agent_joined_at first_audio_at tts_first_byte_at cleanup_done_at; do
  grep -q "$col" "$FILE" && echo "PASS: $col" || echo "FAIL: missing $col"
done
```

**硬阈值**: 6 个字段名全部出现；`ADD COLUMN IF NOT EXISTS` 出现 ≥1 次

---

## Step 2：RTC sidecar stub — 本地 WebSocket WS:8765（N-5 thin stub）

**来源**: `[FROM_PRD]` — PRD 变更地图 `apps/realtime-voice-mvp/rtc-sidecar.js`；FR-4（RTC sidecar：本地 WS:8765 接入火山引擎 RTC SDK，转发音频帧）；NFR N-5（thin 阶段 sidecar 允许 stub，但必须实现 OnUserJoined 事件协议）

**可观测行为**:
[BEHAVIOR] `apps/realtime-voice-mvp/rtc-sidecar.js` 文件存在
[BEHAVIOR] 文件含 `createServer` 或 WebSocket Server 相关字样，监听端口 `8765`
[BEHAVIOR] 文件实现 `OnUserJoined` 事件发送协议，含字符串 `"OnUserJoined"`
[BEHAVIOR] 文件含格式握手逻辑（含 `"format_mismatch"` 或 `"handshake"` 关键字），不一致时拒绝连接

**验证命令**:
```bash
FILE=apps/realtime-voice-mvp/rtc-sidecar.js
test -f "$FILE" && echo "PASS: rtc-sidecar.js exists" || echo "FAIL: missing"
grep -q "8765" "$FILE" && echo "PASS: port 8765" || echo "FAIL: port 8765 not found"
grep -q "OnUserJoined" "$FILE" && echo "PASS: OnUserJoined" || echo "FAIL: OnUserJoined missing"
grep -qE "format_mismatch|handshake" "$FILE" && echo "PASS: handshake logic" || echo "FAIL: handshake missing"
```

**硬阈值**: 端口 `8765`、字符串 `OnUserJoined`、格式握手关键字均出现

---

## Step 3：RTC sidecar TDD 测试（先红后绿）

**来源**: `[FROM_PRD]` — PRD 变更地图 `apps/realtime-voice-mvp/rtc-sidecar.test.js`；E2E-First 原则（先写失败测试，再写实现）

**可观测行为**:
[BEHAVIOR] `apps/realtime-voice-mvp/rtc-sidecar.test.js` 文件存在
[BEHAVIOR] 文件含 `describe` / `it` 或 `test` 结构，覆盖「OnUserJoined 超时 5s」场景
[BEHAVIOR] 文件覆盖「格式握手 format_mismatch」场景（含对应断言）

**验证命令**:
```bash
FILE=apps/realtime-voice-mvp/rtc-sidecar.test.js
test -f "$FILE" && echo "PASS: test file exists" || echo "FAIL: missing"
grep -qE "describe|it\(|test\(" "$FILE" && echo "PASS: test structure" || echo "FAIL: no test structure"
grep -q "OnUserJoined" "$FILE" && echo "PASS: OnUserJoined test" || echo "FAIL: OnUserJoined test missing"
grep -q "format_mismatch" "$FILE" && echo "PASS: format_mismatch test" || echo "FAIL: format_mismatch test missing"

# Python 测试文件：test_rtc_voice_manager.py 验证
PYTEST=services/agent/wechat-rpa/voice_call/tests/test_rtc_voice_manager.py
test -f "$PYTEST" && echo "PASS: test_rtc_voice_manager.py exists" || echo "FAIL: test_rtc_voice_manager.py missing"
grep -qE "def test_" "$PYTEST" && echo "PASS: test functions exist" || echo "FAIL: no test functions"
grep -qE "timeout.*5|5.*timeout" "$PYTEST" && echo "PASS: I-9 timeout=5s test scenario" || echo "FAIL: I-9 timeout scenario missing"
grep -qE "timeout.*10|10.*timeout" "$PYTEST" && echo "PASS: I-10 timeout=10s test scenario" || echo "FAIL: I-10 timeout scenario missing"
```

**硬阈值**: `describe`/`it`/`test` 结构存在；`OnUserJoined` 与 `format_mismatch` 两场景均有测试；`test_rtc_voice_manager.py` 存在且含 `def test_`；含 I-9（5s）和 I-10（10s）超时场景关键字

---

## Step 4：Python rtc_voice_manager stub（I-9 / I-10 / I-11）

**来源**: `[FROM_PRD]` — PRD 变更地图 `services/agent/wechat-rpa/voice_call/rtc_voice_manager.py`；FR-5（StartVoiceChat/StopVoiceChat OpenAPI 封装）；I-9（RTC Token 超时 5s）；I-10（sidecar 入房超时 10s）；I-11（AI Agent 入场验证 OnUserJoined）

**可观测行为**:
[BEHAVIOR] `services/agent/wechat-rpa/voice_call/rtc_voice_manager.py` 文件存在
[BEHAVIOR] 文件含 `start_voice_chat` 函数，签名含 `room_id` 和 `token` 参数
[BEHAVIOR] 文件含 `stop_voice_chat` 函数
[BEHAVIOR] 文件含超时控制逻辑（含 `timeout` 关键字），对应 I-9（5s）和 I-10（10s）约束
[BEHAVIOR] 文件含 `OnUserJoined` 等待逻辑（I-11：AI Agent 入场验证非仅 HTTP 200，需等待 OnUserJoined 事件）

**验证命令**:
```bash
FILE=services/agent/wechat-rpa/voice_call/rtc_voice_manager.py
test -f "$FILE" && echo "PASS: rtc_voice_manager.py exists" || echo "FAIL: missing"
grep -q "start_voice_chat" "$FILE" && echo "PASS: start_voice_chat" || echo "FAIL: start_voice_chat missing"
grep -q "stop_voice_chat" "$FILE" && echo "PASS: stop_voice_chat" || echo "FAIL: stop_voice_chat missing"
grep -qE "room_id|token" "$FILE" && echo "PASS: signature params" || echo "FAIL: signature params missing"
grep -qE 'timeout\s*=\s*5' "$FILE" && echo "PASS: I-9 timeout=5s" || echo "FAIL: I-9 timeout=5s missing"
grep -qE 'timeout\s*=\s*10' "$FILE" && echo "PASS: I-10 timeout=10s" || echo "FAIL: I-10 timeout=10s missing"
grep -q "OnUserJoined" "$FILE" && echo "PASS: I-11 OnUserJoined" || echo "FAIL: I-11 OnUserJoined missing"
```

**硬阈值**: `start_voice_chat`、`stop_voice_chat` 均出现；`timeout=5`（I-9）和 `timeout=10`（I-10）具体数值均可验证；`OnUserJoined`（I-11）出现；函数签名含 `room_id` 或 `token`

---

## Step 5：audio_bridge.py 改造（I-12 格式握手）

**来源**: `[FROM_PRD]` — PRD 变更地图 `services/agent/wechat-rpa/voice_call/audio_bridge.py`；I-12（音频帧格式握手校验：握手时校验采样率/编码/帧长，不一致直接拒绝启动）；NFR N-5

**可观测行为**:
[BEHAVIOR] `audio_bridge.py` 中 `ws_url` 默认值指向 `ws://127.0.0.1:8765`（改为本地 sidecar，不再走远程黑盒）
[BEHAVIOR] 文件含格式握手逻辑（含 `handshake` 或 `format_mismatch` 关键字），格式不一致时拒绝启动
[BEHAVIOR] 文件含 `sample_rate=16000` 字样，明确音频格式参数

**验证命令**:
```bash
FILE=services/agent/wechat-rpa/voice_call/audio_bridge.py
test -f "$FILE" && echo "PASS: audio_bridge.py exists" || echo "FAIL: missing"
grep -q "127.0.0.1:8765" "$FILE" && echo "PASS: ws_url=127.0.0.1:8765" || echo "FAIL: ws_url not updated"
grep -qE "handshake|format_mismatch" "$FILE" && echo "PASS: handshake logic" || echo "FAIL: handshake missing"
grep -q "16000" "$FILE" && echo "PASS: sample_rate=16000" || echo "FAIL: sample_rate missing"
```

**硬阈值**: `127.0.0.1:8765`、握手关键字、`16000` 均出现

---

## Step 6：smoke 脚本（门禁覆盖）

**来源**: `[FROM_PRD]` — PRD 变更地图 `.github/workflows/scripts/smoke/gpa-voice-rtc-smoke.sh`；E2E 验收声明（PRD § E2E 验收）；铁律「真机 bug 修复 PR 必须回流 smoke」

**可观测行为**:
[BEHAVIOR] `.github/workflows/scripts/smoke/gpa-voice-rtc-smoke.sh` 文件存在
[BEHAVIOR] 脚本含 `set -euo pipefail`，任何断言失败即退出
[BEHAVIOR] 脚本含 ≥5 行实质 CI 可验证断言（非 `exit 0` 占位）
[BEHAVIOR] 脚本含对 `rtc-sidecar.js` 和 `rtc_voice_manager.py` 的文件存在性检查
[BEHAVIOR] 脚本含对 migration 文件关键字（6 个延迟字段名）的检查
[BEHAVIOR] NFR N-3：`voice_rtc_latency_log.jsonl` 文件存在且行数 ≥3（核心指标延迟日志必须落盘）

**验证命令**:
```bash
FILE=.github/workflows/scripts/smoke/gpa-voice-rtc-smoke.sh
test -f "$FILE" && echo "PASS: smoke exists" || echo "FAIL: smoke missing"
grep -q "set -euo pipefail" "$FILE" && echo "PASS: pipefail" || echo "FAIL: pipefail missing"
grep -qE "rtc-sidecar\.js" "$FILE" && echo "PASS: sidecar check" || echo "FAIL: sidecar check missing"
grep -q "rtc_voice_manager" "$FILE" && echo "PASS: manager check" || echo "FAIL: manager check missing"
grep -c "PASS\|assert\|grep\|test -f\|python" "$FILE" | awk '{if ($1>=5) print "PASS: >=5 assertions"; else print "FAIL: too few assertions"}'

# NFR N-3：延迟日志断言
LATENCY_LOG=voice_rtc_latency_log.jsonl
test -f "$LATENCY_LOG" && echo "PASS: N-3 latency log exists" || echo "FAIL: N-3 voice_rtc_latency_log.jsonl missing"
LINE_COUNT=$(wc -l < "$LATENCY_LOG" 2>/dev/null || echo 0)
[ "$LINE_COUNT" -ge 3 ] && echo "PASS: N-3 latency log >=3 records (got $LINE_COUNT)" || echo "FAIL: N-3 latency log <3 records (got $LINE_COUNT)"
```

**硬阈值**: `set -euo pipefail` 存在；sidecar、manager 文件检查均有；实质断言行 ≥5；`voice_rtc_latency_log.jsonl` 存在且行数 ≥3

---

## E2E 验收

### E2E 场景（windows_wechat 真机，CI 不可达）

**TODO(real-machine)**: 以下步骤需真机 xian-rog 执行，CI 段用等价断言替代

1. sidecar 启动后 Python audio_bridge.py 连接 WS:8765，握手校验通过（采样率=16000，编码=pcm，帧长=20ms）
2. 模拟 StartVoiceChat 调用 → room_id + token 返回（≤5s）
3. sidecar 发出 OnUserJoined 事件（≤5s）
4. 模拟挂断 → StopVoiceChat 调用 + sidecar 退房
5. NFR N-3：核心指标 latency log 落盘——`voice_rtc_latency_log.jsonl` 文件存在且行数 ≥3（验证命令：`test -f voice_rtc_latency_log.jsonl && [ $(wc -l < voice_rtc_latency_log.jsonl) -ge 3 ]`）

**E2E 验证脚本**：`sprints/07201229-gpa-voice-rtc-migration/e2e-verify.sh`

### CI 等价断言（gpa-voice-rtc-smoke.sh 覆盖）
- 所有实现文件存在性检查
- 关键函数/字符串存在性检查
- Python 单元测试（mock 真机，不需真实 RTC SDK）

## 未覆盖真实链路清单

| 链路段 | 为何未覆盖 | mock 边界 |
|--------|-----------|-----------|
| 火山引擎 RTC SDK 真实入房 | CI 无真实 AppId/Token | stub 实现 OnUserJoined 协议 |
| 微信语音通话真实拨打 | CI 无微信环境 | 真机 xian-rog 手动 |
| StartVoiceChat HTTP 真实调用 | CI 无 IAM 凭据（NFR N-1） | 函数签名 + 超时逻辑断言 |
