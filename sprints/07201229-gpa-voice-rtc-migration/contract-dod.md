# Contract DoD: GP-A 语音引擎迁移至火山引擎 RTC（thin）

## Sprint 验收条件

[BEHAVIOR] Migration 文件存在且含 ADD COLUMN IF NOT EXISTS 和全部 6 个延迟字段名
[BEHAVIOR] rtc-sidecar.js 存在且含 OnUserJoined 事件发送和握手逻辑
[BEHAVIOR] rtc_voice_manager.py 存在且含 start_voice_chat / stop_voice_chat 函数
[BEHAVIOR] audio_bridge.py 改为连接 ws://127.0.0.1:8765 且含格式握手逻辑
[BEHAVIOR] smoke 脚本存在且含 ≥5 行实质断言
[BEHAVIOR] Python 测试（test_rtc_voice_manager.py）存在且全部通过

## DoD 条目

- [x] 所有代码文件按变更地图创建/修改
- [x] 测试文件（TDD：先红后绿）随实现一起提交
- [x] smoke 脚本进 smoke-baseline.txt 棘轮
- [x] E2E 验证脚本（e2e-verify.sh）存在

## 铁律覆盖

| 铁律 | 覆盖方式 |
|------|---------|
| I-9 RTC Token 超时 | rtc_voice_manager.start_voice_chat timeout=5s 断言 |
| I-10 sidecar 入房超时 | rtc-sidecar.js OnUserJoined 10s 超时逻辑 |
| I-11 AI Agent 入场验证 | rtc-sidecar.js OnUserJoined 事件等待（非仅 HTTP 200）|
| I-12 音频帧格式握手 | audio_bridge.py 握手校验 + format_mismatch 拒绝启动 |

## 判定点登记表

| 判定点 | 方法 | 断言 |
|--------|------|------|
| OnUserJoined 超时 | stub 5s 后自动发送事件 | 测试验证事件在 5s 内到达 |
| 格式握手失败 | audio_bridge 发 format_mismatch | 连接被拒绝，error code 断言 |
| StartVoiceChat timeout | start_voice_chat(timeout=5) | 超时返回 failed 而非挂起 |

## 验收命令（manual:bash）

```bash
# 全部 CI 可运行验收（在 /workspace 下执行）
bash .github/workflows/scripts/smoke/gpa-voice-rtc-smoke.sh && \
cd apps/realtime-voice-mvp && npm test -- rtc-sidecar 2>/dev/null || npx vitest run rtc-sidecar.test.js 2>/dev/null && \
cd /workspace && python3 -m pytest services/agent/wechat-rpa/voice_call/tests/test_rtc_voice_manager.py -v
```
