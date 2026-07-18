# Sprint Contract Draft — GP-A 主动语音触达（skeleton）

## 元数据

| 字段 | 值 |
|------|-----|
| task_id | b8bfb263-5a57-4fbc-8e00-7f0e5847d9ee |
| sprint_dir | sprints/07182017-gpa-voice-outreach |
| journey | 智能客服 · GP-A 主动语音触达（ID: 55d26529-2274-4c30-85fe-168edcef4d76） |
| target_environment | windows_wechat（真机 xian-rog，CI 不可达） |
| maturity | not_started → skeleton |
| round | 1（无上轮 reviewer feedback） |

## Golden Path（完整链路）

```
POST /api/cs/voice-outreach/call { tenant_id, contact_name, wechat_account }
  → Agent 接收 → voice_call_preflight()（音频设备自检）
  → locate_contact(contact_name)（搜索框定位 + 标题精确匹配）
  → initiate_voice_call()（相对坐标点击通话按钮）
  → wait_for_answer(timeout=60s)（VOIP 窗口 mm:ss 判定）
  → start_audio_bridge()（WDM-KS 写入 + WASAPI 读取 + 豆包中继）
  → 合规开场白播出
  → wait_for_hangup()（VOIP 窗口消失 + 气泡解析）
  → write_call_record()（POST /api/cs/voice-outreach/records）
  → { status: 'answered'|'no_answer'|'failed', duration_seconds }
```

---

## Step 1：DB Migration — voice_call_records 表（I-4 合规 + N-3 多租户）

**来源**: `[FROM_PRD]` — PRD "代码变更地图" `apps/api/db/migrations/20260718_voice_call_records.sql`；NFR N-4 幂等 Migration（CREATE TABLE IF NOT EXISTS）；NFR N-3 多租户字段 tenant_id

**可观测行为**: Migration 文件存在；含 `voice_call_records` 表名；含 `tenant_id` / `status` / `duration_seconds` / `called_at` 字段；含 `CREATE TABLE IF NOT EXISTS`（幂等）；status 枚举约束含 `answered`/`no_answer`/`failed`

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('/workspace/apps/api/db/migrations/20260718_voice_call_records.sql', 'utf8');
if (!c.includes('voice_call_records')) { console.error('FAIL: 缺表名'); process.exit(1); }
if (!c.includes('tenant_id')) { console.error('FAIL: 缺 tenant_id'); process.exit(1); }
if (!c.includes('status')) { console.error('FAIL: 缺 status'); process.exit(1); }
if (!c.includes('duration_seconds')) { console.error('FAIL: 缺 duration_seconds'); process.exit(1); }
if (!c.includes('called_at')) { console.error('FAIL: 缺 called_at'); process.exit(1); }
if (!c.includes('IF NOT EXISTS')) { console.error('FAIL: 缺幂等约束'); process.exit(1); }
console.log('OK');
" || { echo "FAIL: migration 未实现"; exit 1; }
```

**硬阈值**: 文件存在且含全部 6 项关键字

---

## Step 2：API 路由 — POST /api/cs/voice-outreach/call + GET /api/cs/voice-outreach/records（N-3 多租户）

**来源**: `[FROM_PRD]` — PRD "代码变更地图" `apps/api/src/routes/voice-outreach.ts`；PRD Response Schema；NFR N-3 通过 `requireCsWriteAccess` 多租户隔离

**可观测行为**: 路由文件存在；含 `POST /api/cs/voice-outreach/call` 注册；含 `GET /api/cs/voice-outreach/records`；含 `requireCsWriteAccess`（或等价 auth 中间件）；含 `voice_call_records` 表名（直接查询或通过 ORM）

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('/workspace/apps/api/src/routes/voice-outreach.ts', 'utf8');
if (!c.includes('voice-outreach')) { console.error('FAIL: 缺路由路径'); process.exit(1); }
if (!c.includes('voice_call_records')) { console.error('FAIL: 缺表名引用'); process.exit(1); }
if (!c.includes('requireCsWriteAccess') && !c.includes('requireAuth') && !c.includes('authMiddleware')) {
  console.error('FAIL: 缺 auth 中间件'); process.exit(1);
}
if (!c.includes('tenant_id')) { console.error('FAIL: 缺 tenant_id 隔离'); process.exit(1); }
console.log('OK');
" || { echo "FAIL: voice-outreach.ts 未实现"; exit 1; }
```

**硬阈值**: 文件存在且含 4 项关键字

---

## Step 3：RPA 拨号执行 — locate_contact（I-1 精确匹配 + I-6 禁坐标定位）

**来源**: `[FROM_PRD]` — PRD I-1 联系人精确匹配前置；I-6 禁止坐标点击定位联系人；Golden Path Step 3 `locate_contact`；PRD Response Schema `contact_mismatch` 状态

**可观测行为**: `call_rpa.py` 文件存在；含 `locate_contact` 函数；含搜索框 UIA 关键字（`SearchEdit` 或 `SendKeys`）；含标题精确匹配逻辑（`ChatSingleWindow` 或 `window.Name` 或等价 UIA 属性读取）；含 `contact_mismatch` 返回值

**验证命令**:
```bash
python3 -c "
import sys
with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py') as f:
    c = f.read()
checks = [
    ('locate_contact', '缺 locate_contact 函数'),
    ('contact_mismatch', '缺 contact_mismatch 返回'),
    ('SendKeys', '缺 UIA SendKeys 联系人输入'),
]
failed = False
for kw, msg in checks:
    if kw not in c:
        print(f'FAIL: {msg}'); failed = True
if failed: sys.exit(1)
print('OK')
" || { echo "FAIL: call_rpa.py 联系人精确匹配未实现"; exit 1; }
```

**硬阈值**: 含 `locate_contact` + `contact_mismatch` + UIA 搜索关键字

---

## Step 4：RPA 接通判定 + 超时挂断（I-3 60 秒超时兜底）

**来源**: `[FROM_PRD]` — PRD I-3 60 秒超时兜底；Golden Path Step 5 `wait_for_answer`（轮询 VOIP 窗口 mm:ss 格式）；Golden Path Step 7 `wait_for_hangup` + 气泡文案解析

**可观测行为**: `call_rpa.py` 含 `wait_for_answer` 函数；含 60 秒超时判断（数字 60 或 `timeout`）；含 mm:ss 格式正则（`\d{2}:\d{2}` 或等价）；含 `safe_hangup` 函数；含 `wait_for_hangup` 函数；含气泡解析文案（`通话时长` 或 `无应答`）

**验证命令**:
```bash
python3 -c "
import sys
with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py') as f:
    c = f.read()
checks = [
    ('wait_for_answer', '缺 wait_for_answer'),
    ('safe_hangup', '缺 safe_hangup'),
    ('wait_for_hangup', '缺 wait_for_hangup'),
    ('通话时长', '缺气泡文案解析（通话时长）'),
]
failed = False
for kw, msg in checks:
    if kw not in c:
        print(f'FAIL: {msg}'); failed = True
if not ('60' in c or 'timeout' in c.lower()):
    print('FAIL: 缺 60 秒超时逻辑'); failed = True
if failed: sys.exit(1)
print('OK')
" || { echo "FAIL: call_rpa.py 接通判定未实现"; exit 1; }
```

**硬阈值**: 含 `wait_for_answer` + `safe_hangup` + `wait_for_hangup` + 气泡文案 + 超时判断

---

## Step 5：虚拟声卡音频桥接 — WDM-KS 写入 + WASAPI 读取 + 设备自检（I-2 阻断启动）

**来源**: `[FROM_PRD]` — PRD I-2 音频设备阻断启动；NFR N-5 设备名动态发现（sounddevice.query_devices()）；Golden Path Step 6 `start_audio_bridge`；NFR N-6 合规开场不可跳过（I-4）

**可观测行为**: `audio_bridge.py` 文件存在；含 `start_audio_bridge` 函数；含 `sounddevice` 或 `pyaudio` 引用（音频 I/O 库）；含 `query_devices` 或设备自检逻辑；含 VB-Audio 或 VoiceMeeter 关键字（设备名动态匹配）；含 `preflight` 或设备可用性检查；含合规开场白字符串或 `system_prompt`

**验证命令**:
```bash
python3 -c "
import sys
with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/audio_bridge.py') as f:
    c = f.read()
checks = [
    ('start_audio_bridge', '缺 start_audio_bridge 函数'),
    ('VB-Audio', '缺 VB-Audio 设备关键字'),
    ('VoiceMeeter', '缺 VoiceMeeter 设备关键字'),
]
failed = False
for kw, msg in checks:
    if kw not in c:
        print(f'FAIL: {msg}'); failed = True
if 'sounddevice' not in c and 'pyaudio' not in c:
    print('FAIL: 缺音频 I/O 库（sounddevice/pyaudio）'); failed = True
if 'query_devices' not in c and 'device' not in c.lower():
    print('FAIL: 缺设备枚举/自检逻辑'); failed = True
if failed: sys.exit(1)
print('OK')
" || { echo "FAIL: audio_bridge.py 未实现"; exit 1; }
```

**硬阈值**: 含 `start_audio_bridge` + 音频库引用 + VB-Audio/VoiceMeeter 关键字

---

## Step 6：通话记录回写 — write_call_record POST 中台（N-3 多租户）

**来源**: `[FROM_PRD]` — PRD "代码变更地图" `call_recorder.py`；Golden Path Step 8 `write_call_record`；PRD Response Schema POST /api/cs/voice-outreach/records

**可观测行为**: `call_recorder.py` 文件存在；含 `write_call_record` 函数；含 HTTP POST 调用（`requests.post` 或等价）；含 `/api/cs/voice-outreach/records` URL；含 `tenant_id` + `contact_name` + `status` + `duration_seconds` 字段

**验证命令**:
```bash
python3 -c "
import sys
with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/call_recorder.py') as f:
    c = f.read()
checks = [
    ('write_call_record', '缺 write_call_record 函数'),
    ('voice-outreach/records', '缺 API 路径'),
    ('tenant_id', '缺 tenant_id'),
    ('duration_seconds', '缺 duration_seconds'),
    ('status', '缺 status 字段'),
]
failed = False
for kw, msg in checks:
    if kw not in c:
        print(f'FAIL: {msg}'); failed = True
if 'requests' not in c and 'aiohttp' not in c and 'httpx' not in c:
    print('FAIL: 缺 HTTP 客户端库'); failed = True
if failed: sys.exit(1)
print('OK')
" || { echo "FAIL: call_recorder.py 未实现"; exit 1; }
```

**硬阈值**: 含 `write_call_record` + HTTP 库 + API 路径 + 多租户字段

---

## Step 7：preflight 启动自检 + smoke 脚本（I-2 阻断 + CI 可达段）

**来源**: `[FROM_PRD]` — PRD I-2 音频设备阻断启动；NFR N-1 启动延迟 < 2s；PRD "验收标准" CI 可达部分（gpa-voice-outreach-smoke.sh）

**可观测行为**: `preflight.py` 文件存在；含 `voice_call_preflight` 函数；smoke.sh 文件存在；含 API curl 验证；含 DB 表存在验证；含 pytest 单元测试调用；含真机段等价断言注释（TODO(real-machine)）

**验证命令**:
```bash
# 验证 preflight.py
python3 -c "
import sys
with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/preflight.py') as f:
    c = f.read()
if 'voice_call_preflight' not in c:
    print('FAIL: 缺 voice_call_preflight 函数'); sys.exit(1)
print('preflight.py OK')
"

# 验证 smoke.sh 存在且含核心断言
node -e "
const c = require('fs').readFileSync('/workspace/.github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh', 'utf8');
if (!c.includes('voice-outreach/records')) { console.error('FAIL: 缺 API 验证'); process.exit(1); }
if (!c.includes('voice_call_records')) { console.error('FAIL: 缺 DB 表验证'); process.exit(1); }
if (!c.includes('test_call_rpa')) { console.error('FAIL: 缺 pytest 调用'); process.exit(1); }
if (!c.includes('TODO(real-machine)')) { console.error('FAIL: 缺真机段等价断言注释'); process.exit(1); }
console.log('smoke.sh OK');
" || { echo "FAIL: smoke.sh 未实现"; exit 1; }
```

**硬阈值**: preflight.py + smoke.sh 均存在且含对应关键字

---

## Step 8：pytest 单元测试骨架（联系人精确匹配 + VOIP 文字解析 + 超时路径 mock）

**来源**: `[FROM_PRD]` — PRD "代码变更地图" `voice_call/tests/test_call_rpa.py`；PRD "验收标准" CI 可达第 3 项

**可观测行为**: `tests/test_call_rpa.py` 文件存在；含 `test_contact_title_match` 或等价函数（联系人标题匹配）；含 `test_voip_text_parse` 或等价函数（VOIP 文字解析 mm:ss）；含 `test_timeout_no_answer` 或等价函数（超时路径 mock）；含 `mock` 或 `MagicMock`（不需真机）

**验证命令**:
```bash
python3 -c "
import sys
with open('/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_call_rpa.py') as f:
    c = f.read()
checks = [
    ('mock', '缺 mock（需要 UIA 隔离）'),
    ('contact', '缺联系人相关测试'),
]
failed = False
for kw, msg in checks:
    if kw not in c.lower():
        print(f'FAIL: {msg}'); failed = True
if 'def test_' not in c:
    print('FAIL: 缺测试函数（def test_）'); failed = True
if failed: sys.exit(1)
print('OK')
" || { echo "FAIL: test_call_rpa.py 未实现"; exit 1; }
```

**硬阈值**: 文件存在 + 含 mock + 含 def test_ + 含 contact 关键字

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_wechat（真机，CI 不可达）

> 本 sprint 为 skeleton maturity，真机 E2E 是最终验收，CI 仅覆盖接缝单元测试 + API/DB 可达性。

### CI 可达段（gpa-voice-outreach-smoke.sh）

```bash
# 1. API 接口可达
curl -sf http://localhost:3000/api/cs/voice-outreach/records?tenant_id=test | jq -e 'type == "array"'

# 2. DB 表存在
psql "$DATABASE_URL" -c "\d voice_call_records" | grep -q "status"

# 3. 逻辑接缝单元测试（mock UIA，不需真机）
cd services/agent/build-modules/line04/wechat-rpa && python -m pytest voice_call/tests/test_call_rpa.py -v

echo "# [真机段等价断言 - CI 不可达]"
echo "# TODO(real-machine): 在 xian-rog 上手动运行 voice_call/preflight.py 验证音频设备自检"
echo "# TODO(real-machine): 在 xian-rog 上手动触发真实拨打验证接通判定 + 音质"
echo "# TODO(real-machine): 在 xian-rog 上验证联系人不存在分支正确中止（不产生真实来电）"

echo "✅ GP-A voice outreach smoke (CI 段) PASS"
```

### 真机 E2E（PASS 标准，需在 xian-rog 人工确认）

| # | 验收项 | 判定方式 |
|---|-------|--------|
| E-1 | `voice_call_preflight()` 发现并打开 WDM-KS + WASAPI 设备，打印设备名 | 日志含设备名字符串 |
| E-2 | 手动拔除虚拟声卡驱动后 preflight 报错阻断（I-2） | 返回 `device_error` + 不进入拨号流程 |
| E-3 | `locate_contact('_不存在的测试联系人_')` 正确返回 `contact_mismatch` 并中止（不触发真实拨打）（I-1） | 日志含 `contact_mismatch` + 无来电 |
| E-4 | 完整真实拨打（默忆/小胡同学）：接通判定正确（VOIP 窗口出现 mm:ss）（I-3） | VOIP 窗口出现 mm:ss 计时器 |
| E-5 | 合规开场白播出「您好，我是徐先生企业自媒体的智能语音助手」（I-4） | 对方真人反馈/TTS 日志 |
| E-6 | 60 秒超时不接听 → 判定 `no_answer` + 清理状态（I-3） | 日志 + DB status=no_answer |
| E-7 | `voice_call_records` 表出现对应行，status/duration_seconds 字段正确（psql 查询） | psql SELECT 返回对应行 |

---

## Workstreams

workstream_count: 1（单一 Workstream，skeleton maturity 不拆分）

### Workstream 1：GP-A 语音触达骨架实现

**范围**: 以下所有文件（见 PRD 代码变更地图）：
- `services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py`（RPA 拨号执行）
- `services/agent/build-modules/line04/wechat-rpa/voice_call/audio_bridge.py`（音频桥接）
- `services/agent/build-modules/line04/wechat-rpa/voice_call/call_recorder.py`（回写记录）
- `services/agent/build-modules/line04/wechat-rpa/voice_call/preflight.py`（启动自检）
- `services/agent/build-modules/line04/wechat-rpa/voice_call/__init__.py`（模块导出）
- `services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_call_rpa.py`（单元测试）
- `apps/api/src/routes/voice-outreach.ts`（API 路由）
- `apps/api/db/migrations/20260718_voice_call_records.sql`（DB Migration）
- `.github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh`（E2E smoke）

**大小**: L（~500 行，9 文件）
**依赖**: 无
**DoD 详情**: 见 `sprints/07182017-gpa-voice-outreach/contract-dod.md`

---

## Test Contract

| 层级 | 文件 | 红绿证据 |
|------|------|---------|
| TDD 红绿（Proposer 写） | `sprints/07182017-gpa-voice-outreach/tests/test_contract.py` | 实现前文件不存在 → ENOENT/ImportError → Red |
| 单元测试（Generator 写） | `services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_call_rpa.py` | mock UIA，不需真机，CI 可达 |
| smoke（CI 可达段） | `.github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh` | API + DB 可达性断言 |

---

## Risks

| # | Risk | 影响 | Mitigation |
|---|------|------|------------|
| R1 | xian-rog VoiceMeeter/VB-Audio 驱动配置与 xian-pc 不一致，设备名无法动态匹配 | audio_bridge.py 无法发现设备 → 启动失败 | N-5 动态发现（sounddevice.query_devices() 关键词匹配），不硬编码；PrepPRD ASSUMPTION 已标注 |
| R2 | 微信 VOIP 窗口 UIA Name 属性格式在版本更新后变化，mm:ss 正则失效 | wait_for_answer 永远判定未接通 | ASSUMPTION 已在 PRD 标注；真机验证为验收前置条件（E-4）；实现时加明确的正则 + 异常日志 |
| R3 | 联系人搜索结果顺序漂移，第一条不是目标联系人（I-1 保护层） | 打错人 | I-1 标题精确匹配作为双重保险；搜索后读 ChatSingleWindow.Name 验证 |
| R4 | 豆包 WebSocket /ws/domestic 端点离线，导致音频通道空转（I-5） | 无声通话，合规开场白未播出 | 断线重连上限 3 次 × 2s 间隔；超限明确 fail + 挂断；I-5 约束已写入实现要求 |
| R5 | 免提接听回声环路（PrepPRD 标注待验证） | 对方听到回音，音质差 | 本 sprint skeleton 阶段不含 AEC；E-5 真机验证时观察；回声问题驱动下个 sprint |

---

## 未覆盖真实链路清单

> 以下链路在 CI 中无法自动验证，属于真机 E2E 覆盖范围，skeleton maturity 阶段标注为 TODO(real-machine)。

| # | 未覆盖项 | 原因 | 补偿措施 |
|---|---------|------|---------|
| U-1 | WDM-KS 输出设备可打开（真实 Windows 音频驱动） | CI 无 Windows 音频驱动环境 | preflight.py 自检 + E-1/E-2 真机验证 |
| U-2 | WASAPI 输入设备可打开（VoiceMeeter AUX Output） | 同上 | 同上 |
| U-3 | UIA 定位微信 SearchEdit 控件 + SendKeys 联系人名 | CI 无 Windows UIA 环境 | mock UIA 接缝单元测试（test_call_rpa.py） + E-3 真机验证 |
| U-4 | ChatSingleWindow.Name 精确匹配验证（I-1） | 同上 | 接缝单元测试覆盖标题匹配逻辑 + E-3 真机验证 |
| U-5 | 通话按钮 pyautogui.click()（I-6 相对坐标） | CI 无图形界面 | E-4 真机验证 |
| U-6 | VOIP 窗口顶部 mm:ss 文字 UIA 轮询 | CI 无微信客户端 | 接缝单元测试覆盖字符串解析逻辑 + E-4 真机验证 |
| U-7 | WDM-KS 音频写入→微信发声（对方听到合规开场白） | CI 无音频链路 | E-5 真机验证（对方真人反馈） |
| U-8 | WASAPI 读取→豆包 ASR（对方声音传入 AI） | 同上 | 同上 |
| U-9 | 气泡文案解析「通话时长 mm:ss」（微信客户端真实行为） | CI 无微信客户端 | 接缝单元测试覆盖正则解析 + E-7 psql 验证 |
| U-10 | 60 秒超时真实场景（对方不接听） | 需真实电话等待 | E-6 真机场景验证 |
| U-11 | 豆包 WebSocket 断线重连（I-5） | 需豆包服务端配合 | 单元测试 mock WebSocket 断连路径；E2E 阶段人工模拟断网 |
