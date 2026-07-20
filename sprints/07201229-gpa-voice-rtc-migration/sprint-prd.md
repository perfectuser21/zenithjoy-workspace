# Sprint PRD: GP-A 语音管线迁移 → 火山引擎 RTC 对话式AI（thin）

## 元数据

| 字段 | 值 |
|---|---|
| task_id | 16179076-26eb-4d94-b9cf-f6a1c81e1a4d |
| sprint_dir | sprints/07201229-gpa-voice-rtc-migration |
| journey | 智能客服 · GP-A 主动语音触达（55d26529-2274-4c30-85fe-168edcef4d76）|
| journey_type | user_facing |
| target_environment | windows_wechat |
| maturity | skeleton → thin |

## 本 Sprint 推进声明

本 PR 把 Journey GP-A 主动语音触达从 skeleton → thin，推进 Feature：**RTC对话式AI引擎接入 thin**。

具体：用火山引擎 RTC 对话式AI替换裸 WebSocket 黑盒（volc.speech.dialog），引入本地 RTC sidecar 隔离层，记录延迟对比数据，验证延迟是否改善。

## Invariant 约束

| # | 约束 | 违反处理 |
|---|---|---|
| I-1 | 联系人精确匹配：通话只发给白名单内精确匹配联系人 | 立即终止，飞书告警 |
| I-2 | 音频设备阻断：通话前检测麦克风/扬声器可用，任一不可用 → 拒绝启动 | 返回 device_unavailable 错误 |
| I-7 | Line04 后台静默：Line04 进程在后台时不弹任何系统对话框 | 静默失败 + 日志 |
| I-9 | RTC Token 超时：签发房间号+Token 超过 5s 未成功 → 判失败，飞书告警，通话终止 | StopVoiceChat + 告警 |
| I-10 | sidecar 入房超时：sidecar 进程加入 RTC 房间超过 10s → 判失败清理 | 强杀进程 + call failed |
| I-11 | AI Agent 入场验证：必须等 OnUserJoined 事件（非仅信 HTTP 200），5s 超时 → StopVoiceChat + 退房 | 退房 + call failed |
| I-12 | 音频帧格式握手校验：握手时校验采样率/编码/帧长，不一致直接拒绝启动 | 返回 format_mismatch 错误 |

## 累积 FR

| # | Feature | 状态 |
|---|---|---|
| FR-1 | 音频桥接：Python audio_bridge.py 采集/播放音频，通过 WS 双向传输 | ✅ 已有（旧引擎） |
| FR-2 | 联系人匹配 + 微信 RPA 触发通话 | ✅ 已有 |
| FR-3 | voice_call_records 落库（通话记录持久化） | ✅ 已有 |
| FR-4 | RTC sidecar：本地 WS:8765 接入火山引擎 RTC SDK，转发音频帧 | 🔄 本次新增（thin） |
| FR-5 | StartVoiceChat/StopVoiceChat OpenAPI 封装 + 延迟对比日志落地 | 🔄 本次新增（thin） |

## 代码变更地图

```
新增  apps/realtime-voice-mvp/rtc-sidecar.js          # RTC sidecar，WS:8765 + RTC SDK stub
新增  apps/realtime-voice-mvp/rtc-sidecar.test.js     # TDD 测试（先红后绿）
修改  services/agent/wechat-rpa/voice_call/audio_bridge.py  # ws_url 改 127.0.0.1:8765，加握手格式校验
新增  services/agent/wechat-rpa/voice_call/rtc_voice_manager.py   # StartVoiceChat/StopVoiceChat API 封装
新增  services/agent/wechat-rpa/voice_call/tests/test_rtc_voice_manager.py  # TDD 测试
修改  apps/api/db/migrations/20260720_voice_call_rtc_timestamps.sql  # 新增 6 个延迟时间戳字段
新增  .github/workflows/scripts/smoke/gpa-voice-rtc-smoke.sh         # 本 sprint smoke
```

## NFR

| # | 要求 |
|---|---|
| N-1 | StartVoiceChat/StopVoiceChat 通过 IAM AccessKey 签名，AK/SK 从环境变量读取，不入 git |
| N-2 | sidecar 崩溃直接判 call failed，本次不做看门狗 |
| N-3 | 延迟对比数据追加写入 `voice_rtc_latency_log.jsonl`（≥3 通新引擎 vs 旧引擎），不能只 console.log |
| N-4 | Migration 幂等（ADD COLUMN IF NOT EXISTS） |
| N-5 | thin 阶段 sidecar 允许 stub（但 stub 必须实现 OnUserJoined 事件协议） |

## E2E 验收（smoke 定义完成）

smoke 文件：`.github/workflows/scripts/smoke/gpa-voice-rtc-smoke.sh`

关键断言：
1. StartVoiceChat API 返回 room_id + token（≤5s）
2. sidecar WS:8765 启动后 10s 内收到 OnUserJoined 事件
3. 音频帧格式握手通过（采样率=16000，编码=pcm，帧长=20ms）
4. `voice_rtc_latency_log.jsonl` 存在且包含 ≥3 条记录
5. voice_call_records 表含新增 6 个时间戳字段

---

journey_type: user_facing
target_environment: windows_wechat
