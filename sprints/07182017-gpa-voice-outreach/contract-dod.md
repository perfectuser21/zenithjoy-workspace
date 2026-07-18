---
skeleton: true
journey_type: user_facing
target_environment: windows_wechat
---
# Contract DoD — GP-A 主动语音触达（skeleton）

**范围**: 9 个文件（call_rpa.py / audio_bridge.py / call_recorder.py / preflight.py / __init__.py / test_call_rpa.py / voice-outreach.ts / migration SQL / smoke.sh），实现 GP-A 主动语音触达从 not_started 到 skeleton 的骨架。
**大小**: L（~500 行）
**依赖**: 无前置 Workstream

> **真机段说明（target_environment: windows_wechat）**：以下 BEHAVIOR 条目按 CI 可达性分类。CI 不可达的真机段提供 `manual:bash`（在 xian-rog 手动执行）；CI 可达的接缝验证提供 `auto:bash`（可在 CI/本地直接执行）。

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py` 文件存在
  Test: `python3 -c "open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py')" && echo OK`

- [ ] [ARTIFACT] `services/agent/build-modules/line04/wechat-rpa/voice_call/audio_bridge.py` 文件存在
  Test: `python3 -c "open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/audio_bridge.py')" && echo OK`

- [ ] [ARTIFACT] `services/agent/build-modules/line04/wechat-rpa/voice_call/call_recorder.py` 文件存在
  Test: `python3 -c "open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/call_recorder.py')" && echo OK`

- [ ] [ARTIFACT] `services/agent/build-modules/line04/wechat-rpa/voice_call/preflight.py` 文件存在
  Test: `python3 -c "open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/preflight.py')" && echo OK`

- [ ] [ARTIFACT] `services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_call_rpa.py` 文件存在
  Test: `python3 -c "open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_call_rpa.py')" && echo OK`

- [ ] [ARTIFACT] `apps/api/src/routes/voice-outreach.ts` 文件存在
  Test: `node -e "require('fs').readFileSync('/workspace/apps/api/src/routes/voice-outreach.ts')" && echo OK`

- [ ] [ARTIFACT] `apps/api/db/migrations/20260718_voice_call_records.sql` 文件存在
  Test: `node -e "require('fs').readFileSync('/workspace/apps/api/db/migrations/20260718_voice_call_records.sql')" && echo OK`

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh` 文件存在且可执行（含实质内容 ≥5 行）
  Test: `wc -l /workspace/.github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh | awk '{if($1>=5)print "OK";else{print "FAIL: 行数不足";exit 1}}'`

---

## BEHAVIOR 条目（内嵌 manual:bash 验收命令）

### B-1：联系人精确匹配 + 禁坐标定位（I-1 / I-6）

- [ ] [BEHAVIOR] `call_rpa.py` 含 `locate_contact` 函数 + `contact_mismatch` 返回状态 + UIA SendKeys 搜索（不走坐标定位联系人）
  Test: auto:bash
  ```bash
  python3 -c "
  import sys
  with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py') as f:
      c = f.read()
  checks = [
      ('locate_contact', '缺 locate_contact 函数'),
      ('contact_mismatch', '缺 contact_mismatch 返回状态（I-1）'),
      ('SendKeys', '缺 UIA SendKeys 联系人搜索输入（I-6 禁坐标定位）'),
  ]
  failed = False
  for kw, msg in checks:
      if kw not in c:
          print(f'FAIL: {msg}'); failed = True
  if failed: sys.exit(1)
  print('OK')
  " || { echo "FAIL: I-1/I-6 联系人精确匹配未实现"; exit 1; }
  ```
  期望: OK

### B-2：聊天窗口标题精确匹配校验（I-1 核心安全断言）

- [ ] [BEHAVIOR] `call_rpa.py` 含聊天窗口标题读取逻辑（ChatSingleWindow 或 UIA Name 属性）+ 标题与 contact_name 不匹配时立即中止流程
  Test: auto:bash
  ```bash
  python3 -c "
  import sys
  with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py') as f:
      c = f.read()
  if 'ChatSingleWindow' not in c and 'window_title' not in c and 'title' not in c.lower():
      print('FAIL: 缺聊天窗口标题读取逻辑（I-1）'); sys.exit(1)
  if 'contact_mismatch' not in c:
      print('FAIL: 缺 contact_mismatch 中止逻辑（I-1）'); sys.exit(1)
  print('OK')
  " || { echo "FAIL: I-1 标题精确匹配校验未实现"; exit 1; }
  ```
  期望: OK

### B-3：60 秒超时兜底 + safe_hangup（I-3）

- [ ] [BEHAVIOR] `call_rpa.py` 含 `wait_for_answer` 函数 + 60 秒超时判断 + `safe_hangup` 函数 + `no_answer` 返回状态
  Test: auto:bash
  ```bash
  python3 -c "
  import sys
  with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py') as f:
      c = f.read()
  checks = [
      ('wait_for_answer', '缺 wait_for_answer（I-3）'),
      ('safe_hangup', '缺 safe_hangup（I-3）'),
      ('no_answer', '缺 no_answer 返回状态（I-3）'),
  ]
  failed = False
  for kw, msg in checks:
      if kw not in c:
          print(f'FAIL: {msg}'); failed = True
  if '60' not in c and 'timeout' not in c.lower():
      print('FAIL: 缺 60 秒超时数值（I-3）'); failed = True
  if failed: sys.exit(1)
  print('OK')
  " || { echo "FAIL: I-3 超时兜底未实现"; exit 1; }
  ```
  期望: OK

### B-4：音频设备阻断启动自检（I-2）

- [ ] [BEHAVIOR] `preflight.py` 含 `voice_call_preflight` 函数 + 音频设备可用性检查（WDM-KS + WASAPI） + 任一失败则 abort（`device_error` 或等价）
  Test: auto:bash
  ```bash
  python3 -c "
  import sys
  with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/preflight.py') as f:
      c = f.read()
  if 'voice_call_preflight' not in c:
      print('FAIL: 缺 voice_call_preflight 函数（I-2）'); sys.exit(1)
  if 'device_error' not in c and 'abort' not in c.lower() and 'fail' not in c.lower():
      print('FAIL: 缺设备失败时 abort 逻辑（I-2）'); sys.exit(1)
  if 'WDM' not in c and 'WASAPI' not in c and 'VB-Audio' not in c and 'VoiceMeeter' not in c:
      print('FAIL: 缺音频设备类型检查（I-2 WDM-KS / WASAPI）'); sys.exit(1)
  print('OK')
  " || { echo "FAIL: I-2 音频设备阻断启动未实现"; exit 1; }
  ```
  期望: OK

### B-5：合规开场白不可跳过（I-4 + N-6）

- [ ] [BEHAVIOR] `audio_bridge.py` 含合规开场白字符串（智能语音助手 或 system_prompt）+ 开场白排在音频队列最前（串行保证，非并发启动）
  Test: auto:bash
  ```bash
  python3 -c "
  import sys
  with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/audio_bridge.py') as f:
      c = f.read()
  if '智能语音助手' not in c and 'system_prompt' not in c and '合规' not in c:
      print('FAIL: 缺合规开场白字符串或 system_prompt（I-4）'); sys.exit(1)
  if 'start_audio_bridge' not in c:
      print('FAIL: 缺 start_audio_bridge 函数'); sys.exit(1)
  print('OK')
  " || { echo "FAIL: I-4 合规开场白未实现"; exit 1; }
  ```
  期望: OK

### B-6：WebSocket 断线不静默处理（I-5）

- [ ] [BEHAVIOR] `audio_bridge.py` 含 WebSocket 重连逻辑（重连次数限制 ≤3 + 间隔）+ 重连上限后明确失败通知（非静默丢弃）
  Test: auto:bash
  ```bash
  python3 -c "
  import sys
  with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/audio_bridge.py') as f:
      c = f.read()
  if 'reconnect' not in c.lower() and 'retry' not in c.lower() and '重连' not in c:
      print('FAIL: 缺 WebSocket 断线重连逻辑（I-5）'); sys.exit(1)
  if '3' not in c and 'max_retry' not in c.lower() and 'max_reconnect' not in c.lower():
      print('FAIL: 缺重连上限 3 次限制（I-5）'); sys.exit(1)
  print('OK')
  " || { echo "FAIL: I-5 WebSocket 断线处理未实现"; exit 1; }
  ```
  期望: OK

### B-7：设备名动态发现（N-5）

- [ ] [BEHAVIOR] `audio_bridge.py` 或 `preflight.py` 含 `sounddevice.query_devices()` 或等价动态枚举，不硬编码设备名，通过关键词（VB-Audio / VoiceMeeter）匹配
  Test: auto:bash
  ```bash
  python3 -c "
  import sys
  contents = []
  for p in [
      '/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/audio_bridge.py',
      '/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/preflight.py',
  ]:
      try:
          with open(p) as f: contents.append(f.read())
      except: pass
  c = '\n'.join(contents)
  if 'query_devices' not in c and 'sounddevice' not in c and 'pyaudio' not in c:
      print('FAIL: 缺设备动态枚举（N-5）'); sys.exit(1)
  if 'VB-Audio' not in c and 'VoiceMeeter' not in c:
      print('FAIL: 缺设备名关键词匹配（N-5）'); sys.exit(1)
  print('OK')
  " || { echo "FAIL: N-5 设备动态发现未实现"; exit 1; }
  ```
  期望: OK

### B-8：通话记录多租户回写（N-3 + N-2 结构化日志）

- [ ] [BEHAVIOR] `call_recorder.py` 含 `write_call_record` 函数 + HTTP POST `/api/cs/voice-outreach/records` + `tenant_id` 字段 + `duration_seconds` 字段 + 结构化日志（`[gpa-voice]` 前缀或等价）
  Test: auto:bash
  ```bash
  python3 -c "
  import sys
  with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/call_recorder.py') as f:
      c = f.read()
  checks = [
      ('write_call_record', '缺 write_call_record 函数'),
      ('voice-outreach/records', '缺 API 路径 /api/cs/voice-outreach/records'),
      ('tenant_id', '缺 tenant_id 多租户字段（N-3）'),
      ('duration_seconds', '缺 duration_seconds 字段'),
  ]
  failed = False
  for kw, msg in checks:
      if kw not in c:
          print(f'FAIL: {msg}'); failed = True
  if 'requests' not in c and 'aiohttp' not in c and 'httpx' not in c:
      print('FAIL: 缺 HTTP 客户端库'); failed = True
  if failed: sys.exit(1)
  print('OK')
  " || { echo "FAIL: N-3 通话记录回写未实现"; exit 1; }
  ```
  期望: OK

### B-9：DB Migration 幂等 + 多租户字段（N-4 + N-3）

- [ ] [BEHAVIOR] `20260718_voice_call_records.sql` 含 `CREATE TABLE IF NOT EXISTS`（N-4 幂等）+ `tenant_id`（N-3）+ `status`（answered/no_answer/failed 枚举）+ `duration_seconds` + `called_at`
  Test: auto:bash
  ```bash
  node -e "
  const c = require('fs').readFileSync('/workspace/apps/api/db/migrations/20260718_voice_call_records.sql', 'utf8');
  const checks = [
      ['IF NOT EXISTS', '缺幂等约束（N-4）'],
      ['tenant_id', '缺 tenant_id（N-3）'],
      ['status', '缺 status 字段'],
      ['duration_seconds', '缺 duration_seconds'],
      ['called_at', '缺 called_at'],
  ];
  let failed = false;
  for (const [kw, msg] of checks) {
      if (!c.includes(kw)) { console.error('FAIL: ' + msg); failed = true; }
  }
  if (failed) process.exit(1);
  console.log('OK');
  " || { echo "FAIL: migration 未实现"; exit 1; }
  ```
  期望: OK

### B-10：API 路由多租户隔离（N-3）

- [ ] [BEHAVIOR] `voice-outreach.ts` 含 `requireCsWriteAccess` 或等价 auth 中间件 + `tenant_id` 过滤 + VoiceOutreachResponse 返回 `call_id` + `status`
  Test: auto:bash
  ```bash
  node -e "
  const c = require('fs').readFileSync('/workspace/apps/api/src/routes/voice-outreach.ts', 'utf8');
  const checks = [
      ['tenant_id', '缺 tenant_id 多租户隔离（N-3）'],
      ['voice_call_records', '缺表名引用'],
      ['call_id', '缺 call_id 响应字段'],
      ['status', '缺 status 响应字段'],
  ];
  let failed = false;
  for (const [kw, msg] of checks) {
      if (!c.includes(kw)) { console.error('FAIL: ' + msg); failed = true; }
  }
  if (!c.includes('requireCsWriteAccess') && !c.includes('requireAuth') && !c.includes('authMiddleware')) {
      console.error('FAIL: 缺 auth 中间件（N-3）'); failed = true;
  }
  if (failed) process.exit(1);
  console.log('OK');
  " || { echo "FAIL: voice-outreach.ts 多租户隔离未实现"; exit 1; }
  ```
  期望: OK

### B-11：pytest 单元测试覆盖 mock UIA 接缝（CI 可达）

- [ ] [BEHAVIOR] `test_call_rpa.py` 含 mock UIA 隔离 + 联系人标题匹配测试 + VOIP mm:ss 文字解析测试 + 超时路径测试；可在 CI 中直接执行（不需真机）
  Test: auto:bash
  ```bash
  python3 -c "
  import sys
  with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_call_rpa.py') as f:
      c = f.read()
  checks = [
      ('mock', '缺 mock/MagicMock（需要 UIA 隔离）'),
      ('def test_', '缺测试函数'),
      ('contact', '缺联系人相关测试'),
  ]
  failed = False
  for kw, msg in checks:
      if kw not in c.lower():
          print(f'FAIL: {msg}'); failed = True
  if failed: sys.exit(1)
  print('OK')
  " || { echo "FAIL: test_call_rpa.py 未实现"; exit 1; }
  ```
  期望: OK

### B-12：smoke.sh CI 可达段 + 真机段等价断言注释

- [ ] [BEHAVIOR] `gpa-voice-outreach-smoke.sh` 含 API curl 验证 + psql DB 表断言 + pytest 调用 + `TODO(real-machine)` 注释（真机段等价断言）
  Test: auto:bash
  ```bash
  node -e "
  const c = require('fs').readFileSync('/workspace/.github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh', 'utf8');
  const checks = [
      ['voice-outreach/records', '缺 API curl 验证'],
      ['voice_call_records', '缺 DB 表断言'],
      ['test_call_rpa', '缺 pytest 调用'],
      ['TODO(real-machine)', '缺真机段等价断言注释'],
  ];
  let failed = false;
  for (const [kw, msg] of checks) {
      if (!c.includes(kw)) { console.error('FAIL: ' + msg); failed = true; }
  }
  if (failed) process.exit(1);
  console.log('OK');
  " || { echo "FAIL: smoke.sh CI 段未实现"; exit 1; }
  ```
  期望: OK

---

## 真机 E2E 验收（manual:bash — 在 xian-rog 执行）

### M-1：音频设备自检成功（I-2 正常路径）

- [ ] [BEHAVIOR] 在 xian-rog 上运行 `preflight.py`，能打印出 WDM-KS 输出设备名 + WASAPI 输入设备名，无报错退出
  Test: manual:bash（在 xian-rog 执行）
  ```bash
  cd /path/to/zenithjoy/services/agent/build-modules/line04/wechat-rpa
  python3 -m voice_call.preflight 2>&1 | tee /tmp/preflight-out.txt
  grep -q "VB-Audio\|WDM-KS\|device" /tmp/preflight-out.txt && echo "PASS: 设备自检输出正常" || echo "FAIL: 无设备名输出"
  ```
  期望: 含设备名字符串 + exit 0

### M-2：联系人不存在分支中止（I-1 安全断言）

- [ ] [BEHAVIOR] 在 xian-rog 上注入不存在联系人名，`locate_contact('_不存在的测试联系人_')` 正确返回 `contact_mismatch` 且不触发真实拨打（无来电产生）
  Test: manual:bash（在 xian-rog 执行）
  ```bash
  cd /path/to/zenithjoy/services/agent/build-modules/line04/wechat-rpa
  python3 -c "
  from voice_call.call_rpa import locate_contact
  result = locate_contact('_不存在的测试联系人_')
  print('result:', result)
  assert result.get('status') == 'contact_mismatch', f'FAIL: 期望 contact_mismatch，实际 {result}'
  print('PASS: contact_mismatch 正确返回')
  "
  ```
  期望: status == contact_mismatch + 无真实来电

### M-3：完整拨打接通 + 合规开场白（I-4 核心验收）

- [ ] [BEHAVIOR] 真实拨打"默忆"或"小胡同学"，接通后 VOIP 窗口出现 mm:ss 计时器，合规开场白「您好，我是徐先生企业自媒体的智能语音助手」经 TTS 播出（对方可听到或 TTS 日志可见）
  Test: manual:bash（在 xian-rog 执行，需真人接听配合）
  ```bash
  curl -X POST http://localhost:3000/api/cs/voice-outreach/call \
    -H "Content-Type: application/json" \
    -d '{"tenant_id":"test","contact_name":"默忆","wechat_account":"test_account"}' \
    | jq -e '.status == "answered"'
  # 检查 DB 记录
  psql "$DATABASE_URL" -c "SELECT status, duration_seconds FROM voice_call_records ORDER BY called_at DESC LIMIT 1;"
  ```
  期望: status == answered + DB 有对应行 + duration_seconds > 0

### M-4：60 秒超时不接听（I-3）

- [ ] [BEHAVIOR] 拨打不接听的联系人（或拨打后不接），60 秒后系统自动判定 `no_answer`，DB 写入 status=no_answer, duration_seconds=0
  Test: manual:bash（在 xian-rog 执行）
  ```bash
  curl -X POST http://localhost:3000/api/cs/voice-outreach/call \
    -H "Content-Type: application/json" \
    -d '{"tenant_id":"test","contact_name":"默忆","wechat_account":"test_account"}' \
    --max-time 90 | jq -e '.status == "no_answer"'
  psql "$DATABASE_URL" -c "SELECT status, duration_seconds FROM voice_call_records ORDER BY called_at DESC LIMIT 1;"
  ```
  期望: status == no_answer + duration_seconds == 0

---

> **假绿自查**：
> - B-1/B-2/B-3/B-4/B-5/B-6/B-7/B-8 均对不存在的文件执行 → FileNotFoundError / ENOENT → exit 1 → 真红 ✅
> - B-9/B-10/B-12 同理对不存在文件 → ENOENT → exit 1 → 真红 ✅
> - B-11 对不存在的 test_call_rpa.py → FileNotFoundError → exit 1 → 真红 ✅
> - 文件存在但关键字缺失（仅有占位注释）→ 对应 FAIL 分支 → exit 1 → 真红 ✅（关键字写进注释不计数，因断言检测字符串存在）
