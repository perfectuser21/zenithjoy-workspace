# Sprint PRD：GP-A 主动语音触达 — 首刀骨架（skeleton）

## 元数据

| 字段 | 值 |
|------|-----|
| task_id | b8bfb263-5a57-4fbc-8e00-7f0e5847d9ee |
| sprint_dir | sprints/07182017-gpa-voice-outreach |
| journey | 智能客服 · GP-A 主动语音触达（ID: 55d26529-2274-4c30-85fe-168edcef4d76） |
| journey_type | user_facing |
| target_environment | windows_wechat |
| maturity | not_started → skeleton |

## 本 Sprint 推进声明

本 PR 把 GP-A 主动语音触达 从「not_started」推进到「skeleton」：
- Ability `GP-A 主动语音触达`（a0bf3db6-0ce6-4b16-8a71-aff0fcdfb3d9）：planned → thin
- Feature `RPA 拨号执行`（新建 thin）：联系人名称搜索定位 + 聊天窗口标题精确匹配校验 + VOIP 拨号 + 接通/未接通判定 + 超时挂断
- Feature `虚拟声卡音频桥接`（新建 thin）：WDM-KS 写入 + 标准 WASAPI 读取 + 启动时自检设备可用性
- Feature `通话记录回写`（新建 thin）：通话时长 + 接通状态 → 中台 API

---

## Invariant 约束

（来源：Line04 铁律 + 本次真机事故驱动）

| # | 约束 | 出处 |
|---|------|------|
| I-1 | **联系人精确匹配前置**：RPA 拨号前必须用搜索框按名称定位联系人，聊天窗口标题与目标名不精确匹配时立即中止整个流程，绝不静默继续（真实事故：坐标法在微信重启后顺序漂移，打错成"嘻嘻"） | 本次事故驱动，PrepPRD 判定点 ⚠️ |
| I-2 | **音频设备阻断启动**：Agent 启动时必须自检 WDM-KS 输出设备和 WASAPI 输入设备均可打开；任一失败 → 红日志阻断，禁止带无声通道空转 | PrepPRD 失败路径 3.1 |
| I-3 | **60 秒超时兜底**：拨号后 60 秒内 VOIP 窗口未出现 mm:ss 计时器格式文字 → 判定"未接通"终态，安全清理挂断，不无限等待 | PrepPRD 失败路径 2.1 |
| I-4 | **合规开场必须播出**：接通后第一条音频输出必须是合规告知（"您好，我是 XX 的智能语音助手"），不可跳过或延后 | 法规：《人工智能拟人化互动服务管理暂行办法》第十八条 + handoff 202607180920 |
| I-5 | **WebSocket 断线不静默**：与豆包 Realtime API 的 WebSocket 连接中断 → 断线重连（含重连上限）或明确失败通知，禁止静默丢弃音频流 | PrepPRD 失败路径 3.2 |
| I-6 | **禁止坐标点击定位联系人**：联系人列表位置坐标在微信重启后会漂移，禁止用坐标定位联系人（可用坐标点击通话按钮——按钮位置是窗口相对坐标，可靠） | 本次事故驱动 + handoff 202607180920 §4 |
| I-7 | **[Line04] 后台静默发送**：只走后台 UIA；禁前台键鼠全局注入（抢焦点/发错人） | c985f7e7 |
| I-8 | **程序化恢复窗口后不可信**：程序化 ShowWindow(SW_RESTORE) 后微信内部渲染内容不会正确重绘；RPA 流程设计上要避免让微信窗口被最小化，不指望程序化恢复 | handoff 202607180920 §5 踩坑 |

---

## 累积 FR（GP-A 已落地 Features）

| 状态 | Feature | 厚度 |
|------|---------|------|
| ✅ 前置复用 | 智能客服绑定/安装（共享前置，含 qr_bind.py / preflight.py） | mvp |
| ✅ 前置复用 | 豆包 Realtime Dialogue WebSocket 协议（doubao-protocol.js，PR #1361/#1366 已验证全链路） | medium |
| ✅ 前置复用 | 国内语音管线服务端中继（/ws/domestic，server.js，PR #1368） | thin |
| 🔄 本次 | **RPA 拨号执行**（搜索定位+标题校验+拨号+接通判定+超时挂断） | planned → thin |
| 🔄 本次 | **虚拟声卡音频桥接**（WDM-KS 写入 + WASAPI 读取 + 自检） | planned → thin |
| 🔄 本次 | **通话记录回写**（时长/接通状态 → 中台 API） | planned → thin |

---

## Golden Path（核心场景，单线性步骤序列）

```
1. 人工/系统触发 → POST /api/cs/voice-outreach/call { tenant_id, contact_name, wechat_account }
   → Agent 在 xian-pc/xian-rog 接收指令

2. Agent 执行 voice_call_preflight():
   - 检查微信主窗口存在（find_weixin.py 复用，mmui::MainWindow）
   - 打开 WDM-KS 输出设备（VB-Audio Virtual Cable B 的 WDM-KS 端口）
   - 打开 WASAPI 输入设备（VoiceMeeter Out B1/AUX Output 的 WASAPI 端口）
   - 任一失败 → 立即 abort，返回 { status: 'device_error', reason: '...' }

3. RPA 定位联系人（call_rpa.py::locate_contact）:
   - 点击搜索框（窗口相对坐标，从 mmui::MainWindow 子控件中读 SearchEdit）
   - 输入 contact_name（UIA SendKeys）
   - 等待搜索结果列表出现（最多 3 秒）
   - 点击第一条结果，打开聊天窗口
   - 读取聊天窗口标题（mmui::ChatSingleWindow 的 Name 属性）
   - 若标题 != contact_name → 立即中止，返回 { status: 'contact_mismatch', expected, actual }

4. RPA 触发拨号（call_rpa.py::initiate_voice_call）:
   - 聊天窗口右上角通话图标（相对坐标：距右侧 ~60px，距顶部 ~40px，真机已定位）
   - pyautogui.click() 触发拨号（非 UIA SendClick，因通话按钮在 MMUIRenderSubWindowHW 内不可达）
   - VOIP 窗口出现 → 进入等待状态

5. 接通判定（call_rpa.py::wait_for_answer，超时 60s）:
   - 轮询 VOIP 窗口顶部文字（UIA Name 属性，mmui::VoipWindow 子树可达）
   - 文字从「等待对方接受邀请…」变为 mm:ss 格式 → 接通
   - 60 秒内未变 → 未接通，执行 safe_hangup()，返回 { status: 'no_answer' }

6. 接通后（audio_bridge.py::start_audio_bridge）:
   - 建立 WebSocket 连接到 server.js /ws/domestic（豆包中继）
   - 启动双向音频循环：
     · 读取 VoiceMeeter AUX Output（WASAPI，对方声音）→ 发送给豆包 ASR
     · 豆包 TTS 音频块 → 写入 VB-Audio Cable B WDM-KS（→ 微信发声）
   - 播出合规开场白（system_prompt 固定头："您好，我是徐先生企业自媒体的智能语音助手"）

7. 通话结束检测（call_rpa.py::wait_for_hangup）:
   - 监听 VOIP 窗口是否消失
   - 消失后读聊天气泡最后一条：
     · 「通话时长 mm:ss」→ 接通过，解析时长
     · 「对方无应答」→ 未接通，时长=0
   - 停止音频桥接，断开 WebSocket

8. 回写中台（call_recorder.py::write_call_record）:
   - POST /api/cs/voice-outreach/records { tenant_id, contact_name, status, duration_seconds, called_at }
   - 返回 { status: 'answered'|'no_answer'|'failed', duration_seconds }
```

---

## Response Schema

```typescript
// POST /api/cs/voice-outreach/call
interface VoiceOutreachRequest {
  tenant_id: string;
  contact_name: string;  // 必须精确匹配微信联系人名
  wechat_account: string; // 发起通话的微信账号（绑定的 agent 账号）
}

interface VoiceOutreachResponse {
  success: boolean;
  call_id: string;
  status: 'answered' | 'no_answer' | 'contact_mismatch' | 'device_error' | 'failed';
  duration_seconds: number;
  error?: string;
}

// GET /api/cs/voice-outreach/records?tenant_id=xxx
interface CallRecord {
  id: string;
  tenant_id: string;
  contact_name: string;
  status: 'answered' | 'no_answer' | 'failed';
  duration_seconds: number;
  called_at: string; // ISO8601
}
```

---

## 代码变更地图

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py` | 新增 | RPA 拨号执行：locate_contact / initiate_voice_call / wait_for_answer / wait_for_hangup / safe_hangup；联系人精确匹配校验（I-1/I-6 实现） |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/audio_bridge.py` | 新增 | 虚拟声卡音频桥接：WDM-KS 写入 + WASAPI 读取 + 双向音频循环；启动时自检设备（I-2 实现） |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/call_recorder.py` | 新增 | 通话记录回写：解析气泡文案（接通/未接通判定）+ POST 到中台 API |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/preflight.py` | 新增 | 启动时前置检查：微信主窗口 + 音频设备双路自检，失败即阻断 |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/__init__.py` | 新增 | 模块导出 |
| `services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_call_rpa.py` | 新增 | 单元测试：联系人标题匹配逻辑 / 接通状态字符串解析 / 未接通超时路径（mock UIA，不需真机） |
| `apps/api/src/routes/voice-outreach.ts` | 新增 | POST /api/cs/voice-outreach/call + GET /api/cs/voice-outreach/records；多租户隔离（requireCsWriteAccess） |
| `apps/api/db/migrations/20260718_voice_call_records.sql` | 新增 | `voice_call_records` 表（id/tenant_id/contact_name/status/duration_seconds/called_at/created_at） |
| `.github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh` | 新增 | E2E smoke：API 接口可达 + DB 表存在 + 逻辑接缝单元测试 + 真机段等价断言注释 |

---

## 边界情况

- `contact_name` 精确匹配区分大小写（微信联系人名为原始字符串比较），不做模糊匹配
- 通话按钮坐标依赖窗口尺寸，初始版本使用固定相对坐标（真机已定位），后续可升级为视觉识别
- 豆包 WebSocket 重连上限 3 次，每次间隔 2 秒，达到上限后判定失败并触发挂断
- 免提接听时是否存在回声环路**待验证**（PrepPRD 标注：此前观测样本在音频链路修复前采集，结论不可靠），本 sprint 不包含 AEC，需在 xian-rog 用 WDM-KS 方案单独复测后再决定
- `voice_call_records.status` 枚举：`answered` / `no_answer` / `failed`（failed 含设备错误/联系人不匹配/WebSocket 永久失联）

---

## 假设

- [ASSUMPTION: xian-rog 的 VoiceMeeter Banana + VB-Audio Virtual Cable 驱动配置与 xian-pc 一致，设备名称动态发现（sounddevice.query_devices()），不硬编码设备名]
- [ASSUMPTION: 豆包 /ws/domestic WebSocket 端点已在 server.js 部署于 HK VPS，本 sprint Agent 端只做 WebSocket 客户端接入，不改服务端]
- [ASSUMPTION: VOIP 窗口顶部文字 UIA Name 属性格式为精确的 mm:ss 计时器字符串（正则 `^\d{2}:\d{2}$`），已在 xian-pc 真机验证]
- [ASSUMPTION: 聊天气泡文案「通话时长 mm:ss」与「对方无应答」是微信客户端固定字符串，不因版本变化]

---

## NFR（非功能要求）

| # | 要求 | 指标 |
|---|------|------|
| N-1 | **启动延迟**：voice_call_preflight() 包含音频设备自检，不引入额外 LLM 调用，自检时间 < 2s | sounddevice.query_devices() 同步调用 |
| N-2 | **可观测**：每个关键节点（开始拨号/接通/挂断/回写）写结构化日志，含 contact_name + tenant_id + timestamp | `logger.info('[gpa-voice] ...')` |
| N-3 | **多租户隔离**：voice_call_records 所有写入必须带 tenant_id，通过 requireCsWriteAccess 闸 | 复用 crm.ts 架构约束（I-7） |
| N-4 | **幂等 Migration**：`CREATE TABLE IF NOT EXISTS`，可重复执行 | DDL 幂等 |
| N-5 | **设备名动态发现**：sounddevice.query_devices() 枚举设备，不硬编码设备名称，兼容 xian-pc / xian-rog 两台机器 | 动态匹配关键词 "VB-Audio" / "VoiceMeeter" |
| N-6 | **合规开场不可跳过**：合规告知 TTS 音频必须排在音频队列最前，豆包 ASR 开始监听之前完整播出 | audio_bridge.py 内部串行保证 |

---

## 验收标准（Final E2E）

真机 E2E（真机段等价断言，CI 不可达，需在 xian-rog 运行时自检）：

- [ ] `voice_call_preflight()` 在 xian-rog 上正确发现并打开 WDM-KS 输出设备 + WASAPI 输入设备，打印设备名；手动拔除虚拟声卡驱动后能正确报错阻断
- [ ] `locate_contact('默忆')` 通过搜索框定位成功，聊天窗口标题精确匹配；注入不存在的联系人名 `'_不存在的测试联系人_'` 时能正确返回 `contact_mismatch` 并中止（**不触发真实拨打**）
- [ ] 完整走一次真实拨打（联系人：默忆或小胡同学）：
  - 接通判定正确（VOIP 窗口顶部出现 mm:ss 计时器）
  - 合规开场白播出：「您好，我是徐先生企业自媒体的智能语音助手」
  - 对方真人反馈音质清晰（对照 WDM-KS 频谱数据，无"发闷/外星人"特征）
- [ ] 完整走一次"对方不接听"场景：60 秒超时后正确判定为 `no_answer` 并清理状态
- [ ] 通话记录正确回写：`voice_call_records` 表出现对应行，status/duration_seconds 字段正确（`psql` 查询验证）
- [ ] CI 全绿：`test_call_rpa.py` 单元测试（联系人标题匹配函数 / VOIP 文字解析函数 / 超时路径 mock），不需要真机

```bash
# CI 可达部分（gpa-voice-outreach-smoke.sh 节选）
# 1. API 接口可达
curl -sf http://localhost:3000/api/cs/voice-outreach/records?tenant_id=test | jq -e 'type == "array"'

# 2. DB 表存在
psql "$DATABASE_URL" -c "\d voice_call_records" | grep -q "status"

# 3. 逻辑接缝单元测试
cd services/agent/build-modules/line04/wechat-rpa && python -m pytest voice_call/tests/test_call_rpa.py -v

echo "# [真机段等价断言 - CI 不可达]"
echo "# TODO(real-machine): 需在 xian-rog 上手动运行 voice_call/preflight.py 验证音频设备自检"
echo "# TODO(real-machine): 需在 xian-rog 上手动触发一次真实拨打验证接通判定 + 音质"
echo "# TODO(real-machine): 需在 xian-rog 上验证联系人不存在分支正确中止（不产生真实来电）"

echo "✅ GP-A voice outreach smoke (CI 段) PASS"
```

---

## 不包含

- 接入 Cecelia 已有 skill/话术体系（需拆成 ASR→自有 LLM(带skill)→TTS 三段式，独立 sprint）
- 声学回声消除（AEC）算法开发（免提回声场景待复测后再决定是否需要）
- 声音克隆/音色定制（合规红线：不得克隆特定自然人音色）
- AI 自主决策"要给谁打电话"（本 sprint 触发层只做"收到指令后可靠执行"）
- xian-rog 虚拟声卡驱动安装（属于环境准备，非代码变更；PrepPRD 标注为后续补装项）
- 多账号/矩阵拨号

---

## journey_type: user_facing
## journey_type_reason: 最终面向真实客户（客户接到电话），核心价值在于客户侧感知（声音质量/合规告知），属于用户路径功能
## target_environment: windows_wechat
## target_environment_reason: 核心执行链路在 Windows 桌面（xian-pc/xian-rog），依赖 Windows 微信客户端 GUI 自动化（UIA + pyautogui）+ Windows 音频设备（WDM-KS/WASAPI），无法在 CI runner 或非 Windows 环境中自动验证
