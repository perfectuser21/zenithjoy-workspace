# Voice Latency Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `apps/realtime-voice-mvp/server.js` 的国内豆包语音管线加延迟埋点日志（ASR完成→AI开始回复、AI开始回复→TTS首包、整轮总耗时），纯观测性质，不改变任何转发给客户端的消息内容。

**Architecture:** 把耗时计算逻辑抽成一个不依赖 WebSocket/网络的纯函数 `computeTurnLatency`，放在新文件 `apps/realtime-voice-mvp/latency-tracker.js` 里，先写单测覆盖计算逻辑；再在 `handleDomesticConnection` 里维护每连接的时间戳状态并在四个既有事件分支（ASRResponse/ChatResponse/TTSResponse/ChatEnded）调用它，`ChatEnded` 时把结果通过 `console.log(JSON.stringify(...))` 输出一行结构化日志。

**Tech Stack:** Node.js (ESM), vitest（已有测试框架，见 `apps/realtime-voice-mvp/doubao-protocol.test.js` 的写法）

## Global Constraints

- 不新增 npm 依赖
- 不修改任何 `send`/`log`/`status` 调用点或转发给浏览器的消息内容/格式
- 不做 DB 持久化（本次范围外）
- 不改动 OpenAI 版本管线（`createRealtimeSession`/`/session` 路由）
- 测试文件先于实现文件出现在 commit 历史（TDD 顺序）

---

### Task 1: `computeTurnLatency` 纯函数 + 单测

**Files:**
- Create: `apps/realtime-voice-mvp/latency-tracker.js`
- Test: `apps/realtime-voice-mvp/latency-tracker.test.js`

**Interfaces:**
- Consumes: 无（纯函数，无外部依赖）
- Produces: `computeTurnLatency({ lastAsrAt, chatStartAt, firstTtsAt, chatEndedAt })` → `{ asrToChatMs, chatToTtsMs, totalMs }`，每个字段类型为 `number | null`。后续 Task 2 直接调用此函数。

- [ ] **Step 1: 写失败的测试**

创建 `apps/realtime-voice-mvp/latency-tracker.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { computeTurnLatency } from './latency-tracker.js';

describe('computeTurnLatency', () => {
  it('三个时间戳齐全时正确计算三段耗时', () => {
    const result = computeTurnLatency({
      lastAsrAt: 1000,
      chatStartAt: 1300,
      firstTtsAt: 1800,
      chatEndedAt: 2500,
    });
    expect(result).toEqual({ asrToChatMs: 300, chatToTtsMs: 500, totalMs: 1500 });
  });

  it('lastAsrAt 缺失时三段耗时全部为 null', () => {
    const result = computeTurnLatency({
      lastAsrAt: null,
      chatStartAt: 1300,
      firstTtsAt: 1800,
      chatEndedAt: 2500,
    });
    expect(result).toEqual({ asrToChatMs: null, chatToTtsMs: null, totalMs: null });
  });

  it('chatStartAt 缺失时 asrToChatMs 和 chatToTtsMs 为 null，totalMs 仍可计算', () => {
    const result = computeTurnLatency({
      lastAsrAt: 1000,
      chatStartAt: null,
      firstTtsAt: 1800,
      chatEndedAt: 2500,
    });
    expect(result).toEqual({ asrToChatMs: null, chatToTtsMs: null, totalMs: 1500 });
  });

  it('firstTtsAt 缺失时 chatToTtsMs 为 null，其余正常计算', () => {
    const result = computeTurnLatency({
      lastAsrAt: 1000,
      chatStartAt: 1300,
      firstTtsAt: null,
      chatEndedAt: 2500,
    });
    expect(result).toEqual({ asrToChatMs: 300, chatToTtsMs: null, totalMs: 1500 });
  });

  it('chatEndedAt 缺失时抛出异常（调用方必须保证有结束时间）', () => {
    expect(() =>
      computeTurnLatency({ lastAsrAt: 1000, chatStartAt: 1300, firstTtsAt: 1800, chatEndedAt: null })
    ).toThrow('chatEndedAt is required');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/realtime-voice-mvp && npx vitest run latency-tracker.test.js`
Expected: FAIL，报错信息包含 `Failed to resolve import "./latency-tracker.js"` 或 `Cannot find module`

- [ ] **Step 3: 写最小实现**

创建 `apps/realtime-voice-mvp/latency-tracker.js`：

```js
/**
 * 计算一轮语音对话（用户说完 → AI 识别 → AI 开始回复 → TTS 首包 → 回复结束）
 * 的三段耗时。纯函数，不做 I/O，方便单测；调用方负责传入各阶段的
 * Date.now() 时间戳（缺失的阶段传 null）。
 */
export function computeTurnLatency({ lastAsrAt, chatStartAt, firstTtsAt, chatEndedAt }) {
  if (chatEndedAt == null) {
    throw new Error('chatEndedAt is required');
  }

  const asrToChatMs = lastAsrAt != null && chatStartAt != null ? chatStartAt - lastAsrAt : null;
  const chatToTtsMs = chatStartAt != null && firstTtsAt != null ? firstTtsAt - chatStartAt : null;
  const totalMs = lastAsrAt != null ? chatEndedAt - lastAsrAt : null;

  return { asrToChatMs, chatToTtsMs, totalMs };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/realtime-voice-mvp && npx vitest run latency-tracker.test.js`
Expected: PASS，5 个测试全绿

- [ ] **Step 5: Commit**

```bash
git add apps/realtime-voice-mvp/latency-tracker.js apps/realtime-voice-mvp/latency-tracker.test.js
git commit -m "test+feat(voice-latency): 加 computeTurnLatency 纯函数计算三段延迟

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 把 `computeTurnLatency` 接入 `handleDomesticConnection`

**Files:**
- Modify: `apps/realtime-voice-mvp/server.js:69-188`（`handleDomesticConnection` 函数体）
- Test: 复用 Task 1 的 `apps/realtime-voice-mvp/latency-tracker.test.js`（无需新增，纯逻辑已被覆盖），本任务用既有 `realtime-voice-mvp-domestic-smoke.sh` 做集成层验证

**Interfaces:**
- Consumes: `computeTurnLatency` from `./latency-tracker.js`（Task 1 产出，签名见上）
- Produces: 无新增导出，`handleDomesticConnection` 对外行为（转发给 `browserWs` 的消息）不变，仅新增 `console.log` 副作用

- [ ] **Step 1: 在 server.js 顶部加 import**

修改 `apps/realtime-voice-mvp/server.js` 第 8 行（`import { buildJsonFrame, ... } from './doubao-protocol.js';` 之后）：

```js
import { buildJsonFrame, buildAudioFrame, parseFrame, EventSend } from './doubao-protocol.js';
import { computeTurnLatency } from './latency-tracker.js';
```

- [ ] **Step 2: 在 handleDomesticConnection 里新增状态变量**

修改第 69-71 行，从：

```js
function handleDomesticConnection(browserWs) {
  let doubaoWs = null;
  let sessionId = null;
```

改为：

```js
function handleDomesticConnection(browserWs) {
  let doubaoWs = null;
  let sessionId = null;
  let lastAsrAt = null;
  let chatStartAt = null;
  let firstTtsAt = null;
  let turnIndex = 0;
```

- [ ] **Step 3: 在 ASRResponse 分支记录时间戳**

修改第 124-128 行，从：

```js
        case 'ASRResponse': {
          const text = (parsed.payload.results || []).map((r) => r.text).join('');
          if (text) log(`识别中: ${text}`);
          break;
        }
```

改为：

```js
        case 'ASRResponse': {
          const text = (parsed.payload.results || []).map((r) => r.text).join('');
          if (text) {
            log(`识别中: ${text}`);
            lastAsrAt = Date.now();
          }
          break;
        }
```

- [ ] **Step 4: 在 ChatResponse 分支记录时间戳（仅第一次触发）**

修改第 129-131 行，从：

```js
        case 'ChatResponse':
          status('speaking');
          break;
```

改为：

```js
        case 'ChatResponse':
          status('speaking');
          if (chatStartAt === null) chatStartAt = Date.now();
          break;
```

- [ ] **Step 5: 在 TTSResponse 分支记录首包时间戳**

修改第 132-136 行，从：

```js
        case 'TTSResponse':
          if (parsed.audio && parsed.audio.length && browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(parsed.audio, { binary: true });
          }
          break;
```

改为：

```js
        case 'TTSResponse':
          if (parsed.audio && parsed.audio.length && browserWs.readyState === WebSocket.OPEN) {
            if (firstTtsAt === null) firstTtsAt = Date.now();
            browserWs.send(parsed.audio, { binary: true });
          }
          break;
```

- [ ] **Step 6: 在 ChatEnded 分支输出延迟日志并重置状态**

修改第 137-140 行，从：

```js
        case 'ChatEnded':
          status('connected');
          log('AI 回复结束');
          break;
```

改为：

```js
        case 'ChatEnded': {
          status('connected');
          log('AI 回复结束');
          if (lastAsrAt !== null) {
            turnIndex += 1;
            const latency = computeTurnLatency({
              lastAsrAt,
              chatStartAt,
              firstTtsAt,
              chatEndedAt: Date.now(),
            });
            console.log(JSON.stringify({ event: 'voice_latency', sessionId, turn: turnIndex, ...latency }));
          }
          lastAsrAt = null;
          chatStartAt = null;
          firstTtsAt = null;
          break;
        }
```

- [ ] **Step 7: 运行既有单测确认没有破坏协议编解码逻辑**

Run: `cd apps/realtime-voice-mvp && npx vitest run`
Expected: PASS，`doubao-protocol.test.js` 和 `latency-tracker.test.js` 全绿（无新增测试文件，这里只是回归确认）

- [ ] **Step 8: 跑 domestic smoke 脚本确认协议行为未变**

Run: `bash .github/workflows/scripts/smoke/realtime-voice-mvp-domestic-smoke.sh`
Expected: `realtime-voice-mvp-domestic smoke: PASS`（脚本自包含起服务+测试+关服务，不需要额外准备）

- [ ] **Step 9: Commit**

```bash
git add apps/realtime-voice-mvp/server.js
git commit -m "feat(voice-latency): 国内豆包管线接入延迟埋点日志

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage**：设计文档四个插桩点（ASRResponse/ChatResponse/TTSResponse/ChatEnded）在 Task 2 Step 3-6 逐一覆盖；边界情况（时间戳缺失输出 null、重复触发只记录首次）在 Task 1 单测 + Task 2 的 `=== null` 判断里覆盖。
- **占位符扫描**：无 TBD/TODO，所有 Step 均含完整可运行代码。
- **类型一致性**：`computeTurnLatency` 的参数名/返回字段名在 Task 1 定义、Task 2 调用处完全一致（`lastAsrAt`/`chatStartAt`/`firstTtsAt`/`chatEndedAt` → `asrToChatMs`/`chatToTtsMs`/`totalMs`）。
- **不含**：DB 持久化、前端展示、OpenAI 管线改动——均在设计文档"不包含"里已声明，本计划未新增任务覆盖它们，符合预期。
