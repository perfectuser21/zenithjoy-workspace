# 设计：realtime-voice-mvp 国内豆包管线延迟埋点

## 背景
`apps/realtime-voice-mvp/server.js` 的 `handleDomesticConnection`（国内豆包 Realtime Dialogue 中继）目前对每轮"用户说话→AI识别→AI回复→TTS出声"的耗时没有任何记录。2026-07-19 真机测试反馈延迟明显变重，人工排查已确认网络三跳（xian-pc→中转~60ms、中转→火山API~200ms握手）和服务器资源（CPU/内存/容器负载）均正常，问题大概率出在火山引擎 AI 推理侧的响应速度波动，但目前没有数据能证明/量化这一点。

## 目标
纯观测性质加日志，不改变任何转发给浏览器/微信桥接客户端的消息内容和格式，不新增依赖，不做 DB 持久化（本次范围内）。

## 设计

在 `handleDomesticConnection(browserWs)` 闭包内新增几个每连接作用域的状态变量（与现有 `doubaoWs`、`sessionId` 同级）：

```js
let lastAsrAt = null;      // 最近一次收到非空 ASR 文本的时间戳
let chatStartAt = null;    // 本轮 ChatResponse 首次触发的时间戳
let firstTtsAt = null;     // 本轮首个 TTSResponse 音频包到达时间戳
let turnIndex = 0;         // 本连接内第几轮对话，纯自增计数，日志用
```

三个耗时区间对应三个既有事件的插桩点：

1. **`ASRResponse`**（已有分支，`text` 非空时）：额外执行 `lastAsrAt = Date.now()`。
2. **`ChatResponse`**（已有分支，触发 `status('speaking')`）：仅在 `chatStartAt === null`（本轮第一次触发，因为该事件在一轮回复中可能连续触发多次）时记录：
   - `chatStartAt = Date.now()`
   - 若 `lastAsrAt` 非空，计算 `asrToChatMs = chatStartAt - lastAsrAt` 并暂存到本轮统计对象
3. **`TTSResponse`**（已有分支，音频包非空时）：仅在 `firstTtsAt === null`（本轮首个音频包）时记录：
   - `firstTtsAt = Date.now()`
   - 若 `chatStartAt` 非空，计算 `chatToTtsMs = firstTtsAt - chatStartAt`
4. **`ChatEnded`**（已有分支，`status('connected')` + 日志"AI 回复结束"）：
   - 计算 `totalMs`（从 `lastAsrAt` 到当前时刻，若 `lastAsrAt` 为空则跳过整条日志，不报 NaN）
   - `turnIndex += 1`
   - 用 `console.log(JSON.stringify({...}))` 输出一条结构化日志：`{event: 'voice_latency', sessionId, turn: turnIndex, asrToChatMs, chatToTtsMs, totalMs}`
   - 重置 `lastAsrAt = null; chatStartAt = null; firstTtsAt = null` 为下一轮做准备

## 边界情况
- 若某个时间戳因为事件顺序异常（如没收到 ASRResponse 就直接 ChatEnded）缺失 → 对应耗时字段输出 `null`，不影响其它字段，不抛异常
- 多次 `ChatResponse`/`TTSResponse` 触发时用 `=== null` 判断保证只记录本轮"第一次"，避免被后续重复触发覆盖成错误的短耗时

## 测试策略
- **单元测试**（vitest，新增 `apps/realtime-voice-mvp/latency-tracker.test.js` 或直接在现有测试文件里加 case）：把耗时计算逻辑抽成一个不依赖 WebSocket 的纯函数 `computeTurnLatency({lastAsrAt, chatStartAt, firstTtsAt, chatEndedAt})`，用 mock 时间戳断言三个耗时数值计算正确，以及缺失时间戳时输出 `null` 不抛异常
- **既有 smoke 保持绿**：`realtime-voice-mvp-domestic-smoke.sh` 覆盖的握手/协议行为不应因加日志而改变，本次不新增 smoke（无新增用户可见行为）
- **手动验证**：本次改完在本地起服务，用已有测试凭据跑一次真实豆包会话，肉眼确认能看到 `voice_latency` 结构化日志行

## 不包含
- DB 持久化 / 趋势查询（下一步如果需要再加）
- 前端展示延迟数据
- 对 OpenAI 版本管线（`createRealtimeSession`）的改动
