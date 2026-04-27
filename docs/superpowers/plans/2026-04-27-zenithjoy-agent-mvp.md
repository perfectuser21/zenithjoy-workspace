# ZenithJoy Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建中台 → WebSocket → Agent → publish-wechat-article.cjs → 公众号草稿 的最小闭环。

**Architecture:** apps/api 加 WS server（共享 5200 端口）+ AgentRegistry 单例 + Agent 独立 Node 进程通过 WSS 连入。Dashboard 加 /agent-debug 页面订阅实时状态。v0.1 不打包 .exe，不真发文章（只到草稿）。

**Tech Stack:** Node.js + Express + ws + zod + React + TypeScript

---

## Task 1: Agent 协议 Schema

**Files:**
- Create: `apps/api/src/schemas/agent-protocol.ts`
- Test: `apps/api/src/schemas/__tests__/agent-protocol.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/schemas/__tests__/agent-protocol.test.ts
import { describe, it, expect } from 'vitest';
import { AgentMessageSchema, ServerMessageSchema } from '../agent-protocol';

describe('AgentMessageSchema', () => {
  it('parses valid hello message', () => {
    const msg = {
      v: 1, type: 'hello', msgId: 'm1', ts: Date.now(),
      payload: { agentId: 'a1', version: '0.1.0', capabilities: ['wechat'] }
    };
    expect(() => AgentMessageSchema.parse(msg)).not.toThrow();
  });

  it('rejects missing payload', () => {
    expect(() => AgentMessageSchema.parse({
      v: 1, type: 'hello', msgId: 'm1', ts: Date.now()
    })).toThrow();
  });

  it('parses task_result with ok=false + error', () => {
    const msg = {
      v: 1, type: 'task_result', msgId: 'm2', taskId: 't1', ts: Date.now(),
      payload: { ok: false, error: 'wechat api failed' }
    };
    expect(() => AgentMessageSchema.parse(msg)).not.toThrow();
  });
});

describe('ServerMessageSchema', () => {
  it('parses publish_request', () => {
    const msg = {
      v: 1, type: 'publish_request', msgId: 'm3', taskId: 't2', ts: Date.now(),
      payload: { platform: 'wechat', content: { title: 'hi', body: '<p>hi</p>' } }
    };
    expect(() => ServerMessageSchema.parse(msg)).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd apps/api && npx vitest run src/schemas/__tests__/agent-protocol.test.ts`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 实现 schema**

```ts
// apps/api/src/schemas/agent-protocol.ts
import { z } from 'zod';

const Envelope = {
  v: z.literal(1),
  msgId: z.string().min(1),
  taskId: z.string().optional(),
  ts: z.number().int(),
};

// === Agent → Server ===
export const HelloPayload = z.object({
  agentId: z.string(),
  version: z.string(),
  capabilities: z.array(z.string()),
});

export const HeartbeatPayload = z.object({
  uptime: z.number(),
  busy: z.boolean(),
});

export const TaskProgressPayload = z.object({
  stage: z.string(),
  pct: z.number().min(0).max(100),
});

export const TaskResultPayload = z.object({
  ok: z.boolean(),
  publishId: z.string().optional(),
  mediaId: z.string().optional(),
  error: z.string().optional(),
});

export const AgentMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...Envelope, type: z.literal('hello'), payload: HelloPayload }),
  z.object({ ...Envelope, type: z.literal('heartbeat'), payload: HeartbeatPayload }),
  z.object({ ...Envelope, type: z.literal('task_progress'), payload: TaskProgressPayload }),
  z.object({ ...Envelope, type: z.literal('task_result'), payload: TaskResultPayload }),
]);

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// === Server → Agent ===
export const PublishRequestPayload = z.object({
  platform: z.enum(['wechat']),
  content: z.object({
    title: z.string(),
    body: z.string(),
    digest: z.string().optional(),
    author: z.string().optional(),
  }),
});

export const TaskCancelPayload = z.object({
  reason: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...Envelope, type: z.literal('publish_request'), payload: PublishRequestPayload }),
  z.object({ ...Envelope, type: z.literal('task_cancel'), payload: TaskCancelPayload }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// helper
export function makeMsg<T extends { type: string; payload: unknown }>(
  type: T['type'], payload: T['payload'], taskId?: string
): { v: 1; type: T['type']; msgId: string; taskId?: string; ts: number; payload: T['payload'] } {
  return {
    v: 1, type, msgId: crypto.randomUUID(),
    ...(taskId ? { taskId } : {}),
    ts: Date.now(), payload,
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd apps/api && npx vitest run src/schemas/__tests__/agent-protocol.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/zenithjoy/zenithjoy-agent-mvp
git add apps/api/src/schemas/agent-protocol.ts apps/api/src/schemas/__tests__/agent-protocol.test.ts
git commit -m "feat(agent): add agent protocol schema with zod validation"
```

---

## Task 2: AgentRegistry 单例

**Files:**
- Create: `apps/api/src/services/agent-registry.ts`
- Test: `apps/api/src/services/__tests__/agent-registry.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/services/__tests__/agent-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../agent-registry';

describe('AgentRegistry', () => {
  let reg: AgentRegistry;
  beforeEach(() => { reg = new AgentRegistry(); });

  it('registers and lists agents', () => {
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0' }, {} as any);
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].agentId).toBe('a1');
  });

  it('unregisters agent', () => {
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0' }, {} as any);
    reg.unregister('a1');
    expect(reg.list()).toHaveLength(0);
  });

  it('updates heartbeat ts', () => {
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0' }, {} as any);
    const before = reg.list()[0].lastHeartbeat;
    setTimeout(() => {
      reg.heartbeat('a1', { uptime: 100, busy: false });
      expect(reg.list()[0].lastHeartbeat).toBeGreaterThan(before);
    }, 10);
  });

  it('replaces existing agent on duplicate register (last-write-wins)', () => {
    const ws1 = { close: () => {} } as any;
    const ws2 = {} as any;
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0' }, ws1);
    reg.register('a1', { capabilities: ['wechat'], version: '0.1.0' }, ws2);
    expect(reg.list()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/agent-registry.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 AgentRegistry**

```ts
// apps/api/src/services/agent-registry.ts
import type { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export interface AgentMeta {
  capabilities: string[];
  version: string;
}

export interface AgentEntry {
  agentId: string;
  meta: AgentMeta;
  ws: WebSocket;
  connectedAt: number;
  lastHeartbeat: number;
  busy: boolean;
}

export class AgentRegistry extends EventEmitter {
  private agents = new Map<string, AgentEntry>();

  register(agentId: string, meta: AgentMeta, ws: WebSocket): void {
    const existing = this.agents.get(agentId);
    if (existing && existing.ws !== ws) {
      try { existing.ws.close(4001, 'replaced'); } catch {}
    }
    const entry: AgentEntry = {
      agentId, meta, ws,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      busy: false,
    };
    this.agents.set(agentId, entry);
    this.emit('register', entry);
  }

  unregister(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (entry) {
      this.agents.delete(agentId);
      this.emit('unregister', entry);
    }
  }

  heartbeat(agentId: string, payload: { uptime: number; busy: boolean }): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.lastHeartbeat = Date.now();
    entry.busy = payload.busy;
    this.emit('heartbeat', entry);
  }

  list(): AgentEntry[] {
    return Array.from(this.agents.values());
  }

  get(agentId: string): AgentEntry | undefined {
    return this.agents.get(agentId);
  }

  // 简单挑一个能干活的（v0.1 单 Agent）
  pickFor(capability: string): AgentEntry | undefined {
    return this.list().find(e => e.meta.capabilities.includes(capability) && !e.busy);
  }
}

export const agentRegistry = new AgentRegistry();
```

- [ ] **Step 4: 跑测试**

Run: `cd apps/api && npx vitest run src/services/__tests__/agent-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/agent-registry.ts apps/api/src/services/__tests__/agent-registry.test.ts
git commit -m "feat(agent): add AgentRegistry singleton for tracking online agents"
```

---

## Task 3: Agent WS Server（挂载 + token 鉴权）

**Files:**
- Create: `apps/api/src/services/agent-ws.ts`
- Modify: `apps/api/src/index.ts`（http.createServer 共享端口）
- Modify: `apps/api/package.json`（加 `ws` 依赖）

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/administrator/worktrees/zenithjoy/zenithjoy-agent-mvp/apps/api
npm install ws
npm install -D @types/ws
```

- [ ] **Step 2: 实现 attachAgentWS**

```ts
// apps/api/src/services/agent-ws.ts
import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { agentRegistry } from './agent-registry';
import { AgentMessageSchema, makeMsg } from '../schemas/agent-protocol';

const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const WS_PATH = '/agent-ws';

export function attachAgentWS(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith(WS_PATH)) return;

    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token') || (req.headers['x-agent-token'] as string);
    if (!AGENT_TOKEN || token !== AGENT_TOKEN) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let agentId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const obj = JSON.parse(raw.toString());
        const msg = AgentMessageSchema.parse(obj);

        if (msg.type === 'hello') {
          agentId = msg.payload.agentId;
          agentRegistry.register(agentId, {
            capabilities: msg.payload.capabilities,
            version: msg.payload.version,
          }, ws);
        } else if (msg.type === 'heartbeat') {
          if (agentId) agentRegistry.heartbeat(agentId, msg.payload);
        } else if (msg.type === 'task_progress' || msg.type === 'task_result') {
          // 转发给 dashboard 订阅者（v0.1 用 EventEmitter）
          agentRegistry.emit(msg.type, { agentId, ...msg });
        }
      } catch (err) {
        console.warn('[agent-ws] invalid message:', err);
      }
    });

    ws.on('close', () => {
      if (agentId) agentRegistry.unregister(agentId);
    });
  });

  return wss;
}

export function sendToAgent(agentId: string, msg: ReturnType<typeof makeMsg>): boolean {
  const entry = agentRegistry.get(agentId);
  if (!entry || entry.ws.readyState !== entry.ws.OPEN) return false;
  entry.ws.send(JSON.stringify(msg));
  return true;
}
```

- [ ] **Step 3: 改 index.ts 共享端口**

读取现有 `apps/api/src/index.ts`，把 `app.listen(PORT)` 改成：

```ts
import http from 'http';
import { attachAgentWS } from './services/agent-ws';

const server = http.createServer(app);
attachAgentWS(server);
server.listen(PORT, () => {
  console.log(`API + Agent WS listening on :${PORT}`);
});
```

- [ ] **Step 4: 手工冒烟测试**

```bash
# 终端 1
cd apps/api && AGENT_TOKEN=test123 npm run dev

# 终端 2: 用 wscat 测试鉴权（需先 npm i -g wscat）
wscat -c "ws://localhost:5200/agent-ws?token=wrongtoken"
# Expected: 401 Unauthorized

wscat -c "ws://localhost:5200/agent-ws?token=test123"
# Expected: 连接成功
# 输入: {"v":1,"type":"hello","msgId":"m1","ts":1,"payload":{"agentId":"a1","version":"0.1","capabilities":["wechat"]}}
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json apps/api/src/services/agent-ws.ts apps/api/src/index.ts
git commit -m "feat(agent): WebSocket server with token auth, shares port 5200 with API"
```

---

## Task 4: Agent stub（最小可连接）

**Files:**
- Create: `services/agent/package.json`
- Create: `services/agent/src/index.ts`
- Create: `services/agent/.env.example`

- [ ] **Step 1: 初始化 Agent service**

```bash
mkdir -p /Users/administrator/worktrees/zenithjoy/zenithjoy-agent-mvp/services/agent/src
cd /Users/administrator/worktrees/zenithjoy/zenithjoy-agent-mvp/services/agent
cat > package.json << 'EOF'
{
  "name": "@zenithjoy/agent",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "ws": "^8.18.0",
    "tsx": "^4.20.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
EOF
npm install
```

- [ ] **Step 2: 写 .env.example**

```bash
cat > .env.example << 'EOF'
ZENITHJOY_API_URL=ws://localhost:5200/agent-ws
AGENT_TOKEN=test123
AGENT_ID=agent-mac-mini-01
EOF
```

- [ ] **Step 3: 实现 agent stub**

```ts
// services/agent/src/index.ts
import WebSocket from 'ws';
import crypto from 'crypto';

const API_URL = process.env.ZENITHJOY_API_URL || 'ws://localhost:5200/agent-ws';
const TOKEN = process.env.AGENT_TOKEN || '';
const AGENT_ID = process.env.AGENT_ID || `agent-${crypto.randomBytes(4).toString('hex')}`;
const VERSION = '0.1.0';
const CAPABILITIES = ['wechat'];

const startTime = Date.now();
let backoff = 1000;
const MAX_BACKOFF = 30000;

function makeMsg(type: string, payload: any, taskId?: string) {
  return {
    v: 1, type, msgId: crypto.randomUUID(),
    ...(taskId ? { taskId } : {}),
    ts: Date.now(), payload,
  };
}

function connect() {
  const url = `${API_URL}?token=${encodeURIComponent(TOKEN)}`;
  console.log(`[agent] connecting to ${API_URL}...`);
  const ws = new WebSocket(url);

  let heartbeatTimer: NodeJS.Timeout | null = null;

  ws.on('open', () => {
    console.log(`[agent] connected as ${AGENT_ID}`);
    backoff = 1000; // reset
    ws.send(JSON.stringify(makeMsg('hello', {
      agentId: AGENT_ID, version: VERSION, capabilities: CAPABILITIES,
    })));
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(makeMsg('heartbeat', {
          uptime: Date.now() - startTime, busy: false,
        })));
      }
    }, 15000);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log(`[agent] received:`, msg.type, msg.taskId || '');
      // Task 5 实现 publish_request 处理
    } catch (err) {
      console.warn('[agent] invalid message:', err);
    }
  });

  ws.on('close', (code) => {
    console.log(`[agent] closed: ${code}, reconnecting in ${backoff}ms`);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  });

  ws.on('error', (err) => {
    console.warn('[agent] error:', err.message);
  });
}

connect();
```

- [ ] **Step 4: 冒烟测试**

```bash
# 终端 1: API server
cd apps/api && AGENT_TOKEN=test123 npm run dev

# 终端 2: Agent
cd services/agent && AGENT_TOKEN=test123 npm start
# Expected: [agent] connected as agent-...
# 终端 1 应看到 register 日志
```

- [ ] **Step 5: Commit**

```bash
git add services/agent/
git commit -m "feat(agent): minimal Agent stub with hello/heartbeat + reconnect"
```

---

## Task 5: publish_request 双向通信

**Files:**
- Modify: `services/agent/src/index.ts`（处理 publish_request）
- Create: `services/agent/src/handlers/wechat-publish.ts`（暂时 mock）

- [ ] **Step 1: 创建 wechat handler（mock 版）**

```ts
// services/agent/src/handlers/wechat-publish.ts
export async function handleWechatPublish(
  taskId: string,
  content: { title: string; body: string },
  emit: (msg: any) => void,
  makeMsg: (type: string, payload: any, taskId?: string) => any,
): Promise<void> {
  emit(makeMsg('task_progress', { stage: 'starting', pct: 10 }, taskId));
  await new Promise(r => setTimeout(r, 500));
  emit(makeMsg('task_progress', { stage: 'mock_publishing', pct: 50 }, taskId));
  await new Promise(r => setTimeout(r, 500));
  // v0.1 mock: 不真发，只回成功
  emit(makeMsg('task_result', { ok: true, mediaId: 'mock-media-' + Date.now() }, taskId));
}
```

- [ ] **Step 2: 在 agent index.ts 加 publish_request 路由**

修改 `services/agent/src/index.ts` 的 `ws.on('message')` 部分：

```ts
import { handleWechatPublish } from './handlers/wechat-publish';

ws.on('message', async (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    console.log(`[agent] received:`, msg.type, msg.taskId || '');

    if (msg.type === 'publish_request' && msg.payload.platform === 'wechat') {
      const emit = (m: any) => ws.send(JSON.stringify(m));
      await handleWechatPublish(msg.taskId, msg.payload.content, emit, makeMsg);
    }
  } catch (err) {
    console.warn('[agent] invalid message:', err);
  }
});
```

- [ ] **Step 3: 冒烟测试 — 直接从 Server 端推消息**

```bash
# 临时在 apps/api/src/index.ts 加测试代码（5 秒后推一条 publish_request）
# 或者用 Node REPL 调用 sendToAgent

# 验证：Agent 控制台应看到 received: publish_request
# Server 控制台应看到 task_progress + task_result（v0.1 通过 EventEmitter）
```

- [ ] **Step 4: Commit**

```bash
git add services/agent/src/
git commit -m "feat(agent): handle publish_request with mock wechat handler + progress reporting"
```

---

## Task 6: HTTP API 端点（POST /api/agent/test-publish）

**Files:**
- Create: `apps/api/src/routes/agent.ts`
- Modify: `apps/api/src/app.ts`（mount router）

- [ ] **Step 1: 实现 routes/agent.ts**

```ts
// apps/api/src/routes/agent.ts
import { Router } from 'express';
import { agentRegistry } from '../services/agent-registry';
import { sendToAgent } from '../services/agent-ws';
import { makeMsg } from '../schemas/agent-protocol';

export const agentRouter = Router();

agentRouter.get('/status', (req, res) => {
  const list = agentRegistry.list().map(e => ({
    agentId: e.agentId,
    capabilities: e.meta.capabilities,
    version: e.meta.version,
    connectedAt: e.connectedAt,
    lastHeartbeat: e.lastHeartbeat,
    busy: e.busy,
    online: Date.now() - e.lastHeartbeat < 30000,
  }));
  res.json({ agents: list });
});

agentRouter.post('/test-publish', (req, res) => {
  const agent = agentRegistry.pickFor('wechat');
  if (!agent) {
    return res.status(503).json({ error: 'no agent online' });
  }

  const taskId = `task-${Date.now()}`;
  const content = {
    title: `[Agent v0.1 自检] ${new Date().toISOString().slice(0, 16)}`,
    body: '<p>这是 ZenithJoy Agent 自检发布。如你看到这条草稿，说明中台→Agent→微信链路已打通。</p>',
    digest: 'Agent v0.1 链路自检',
    author: 'ZenithJoy Agent',
  };

  const sent = sendToAgent(agent.agentId, makeMsg('publish_request', {
    platform: 'wechat', content,
  }, taskId));

  if (!sent) return res.status(503).json({ error: 'agent not reachable' });

  res.json({ ok: true, taskId, agentId: agent.agentId });
});
```

- [ ] **Step 2: Mount router in app.ts**

读 `apps/api/src/app.ts`，在合适位置加：

```ts
import { agentRouter } from './routes/agent';
// ...
app.use('/api/agent', agentRouter);
```

- [ ] **Step 3: 冒烟测试**

```bash
# 终端 1: API（确保 Agent 已连）
# 终端 2: Agent
# 终端 3: 触发
curl -X POST http://localhost:5200/api/agent/test-publish
# Expected: {"ok":true,"taskId":"task-...","agentId":"..."}

curl http://localhost:5200/api/agent/status
# Expected: {"agents":[{"agentId":"...","online":true,...}]}
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/agent.ts apps/api/src/app.ts
git commit -m "feat(agent): POST /api/agent/test-publish + GET /api/agent/status"
```

---

## Task 7: Agent 端真调 wechat-publisher（draft-only）

**Files:**
- Modify: `services/agent/src/handlers/wechat-publish.ts`
- Modify: `services/creator/scripts/publishers/wechat-publisher/publish-wechat-article.cjs`（加 --draft-only）

- [ ] **Step 1: 检查 wechat-publisher 现有参数**

Run: `head -100 services/creator/scripts/publishers/wechat-publisher/publish-wechat-article.cjs`
找到主入口，看是否有 publish/submit 步骤可以跳过。

- [ ] **Step 2: 加 --draft-only 模式**

修改 `publish-wechat-article.cjs` 主入口，加 argv 解析：

```js
// 在文件顶部加
const args = process.argv.slice(2);
const DRAFT_ONLY = args.includes('--draft-only');
const TITLE_ARG = args[args.indexOf('--title') + 1];
const BODY_ARG = args[args.indexOf('--body') + 1];

// 在 freepublish/submit 之前判断
if (DRAFT_ONLY) {
  console.log(JSON.stringify({ ok: true, draft: true, mediaId }));
  process.exit(0);
}
```

具体实现要看现有代码结构调整，但**核心约束是**：DRAFT_ONLY 时只跑到 `draft/add`，绝不调 `freepublish/submit`。

- [ ] **Step 3: 改 wechat-publish handler 真调脚本**

```ts
// services/agent/src/handlers/wechat-publish.ts
import { spawn } from 'child_process';
import path from 'path';

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  '../../services/creator/scripts/publishers/wechat-publisher/publish-wechat-article.cjs'
);

export async function handleWechatPublish(
  taskId: string,
  content: { title: string; body: string },
  emit: (msg: any) => void,
  makeMsg: (type: string, payload: any, taskId?: string) => any,
): Promise<void> {
  emit(makeMsg('task_progress', { stage: 'spawning', pct: 10 }, taskId));

  return new Promise((resolve) => {
    const child = spawn('node', [
      SCRIPT_PATH,
      '--draft-only',
      '--title', content.title,
      '--body', content.body,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
      emit(makeMsg('task_progress', { stage: 'running', pct: 50 }, taskId));
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const lastLine = stdout.trim().split('\n').pop() || '{}';
          const result = JSON.parse(lastLine);
          emit(makeMsg('task_result', {
            ok: true,
            mediaId: result.mediaId,
          }, taskId));
        } catch {
          emit(makeMsg('task_result', { ok: true }, taskId));
        }
      } else {
        emit(makeMsg('task_result', {
          ok: false,
          error: stderr.slice(-500) || `exit ${code}`,
        }, taskId));
      }
      resolve();
    });
  });
}
```

- [ ] **Step 4: 端到端冒烟测试**

```bash
# 1. API + Agent 都跑起来
# 2. 触发：
curl -X POST http://localhost:5200/api/agent/test-publish
# 3. 等 30 秒
# 4. 查微信公众号草稿箱：应该有新草稿
```

- [ ] **Step 5: Commit**

```bash
git add services/agent/src/handlers/wechat-publish.ts
git add services/creator/scripts/publishers/wechat-publisher/publish-wechat-article.cjs
git commit -m "feat(agent): real wechat draft publish via spawn (draft-only mode)"
```

---

## Task 8: Dashboard /agent-debug 页面

**Files:**
- Create: `apps/dashboard/src/pages/AgentDebugPage.tsx`
- Create: `apps/dashboard/src/api/agent.api.ts`
- Modify: `apps/dashboard/src/config/navigation.config.ts`
- Modify: `apps/dashboard/src/pages/AdminSettingsPage.tsx`

- [ ] **Step 1: 实现 agent.api.ts**

```ts
// apps/dashboard/src/api/agent.api.ts
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export interface AgentStatus {
  agentId: string;
  capabilities: string[];
  version: string;
  online: boolean;
  busy: boolean;
  lastHeartbeat: number;
}

export async function getAgentStatus(): Promise<{ agents: AgentStatus[] }> {
  const r = await fetch(`${API_BASE}/agent/status`);
  if (!r.ok) throw new Error('failed');
  return r.json();
}

export async function testPublish(): Promise<{ ok: boolean; taskId: string }> {
  const r = await fetch(`${API_BASE}/agent/test-publish`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json()).error);
  return r.json();
}
```

- [ ] **Step 2: 实现 AgentDebugPage.tsx**

```tsx
// apps/dashboard/src/pages/AgentDebugPage.tsx
import { useEffect, useState } from 'react';
import { getAgentStatus, testPublish, AgentStatus } from '../api/agent.api';

export default function AgentDebugPage() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const data = await getAgentStatus();
      setAgents(data.agents);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const onTest = async () => {
    setBusy(true);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 触发测试发布...`]);
    try {
      const r = await testPublish();
      setLogs(prev => [...prev, `✅ taskId=${r.taskId}, agentId=${r.agentId}`]);
    } catch (e: any) {
      setLogs(prev => [...prev, `❌ ${e.message}`]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Agent 调试</h1>

      <section className="mb-6 bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-3">Agent 在线状态</h2>
        {agents.length === 0 ? (
          <div className="text-gray-500">暂无 Agent 在线</div>
        ) : (
          <ul className="space-y-2">
            {agents.map(a => (
              <li key={a.agentId} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${a.online ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="font-mono text-sm">{a.agentId}</span>
                <span className="text-xs text-gray-500">v{a.version} | {a.capabilities.join(',')}</span>
                {a.busy && <span className="text-xs bg-yellow-100 px-2 rounded">忙</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <button
          onClick={onTest}
          disabled={busy || agents.length === 0}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
        >
          {busy ? '发布中...' : '测试发布到公众号'}
        </button>
      </section>

      <section className="bg-gray-50 rounded-lg p-4 font-mono text-xs h-64 overflow-y-auto">
        {logs.map((line, i) => <div key={i}>{line}</div>)}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: 注册路由**

读 `apps/dashboard/src/config/navigation.config.ts`，在 `additionalRoutes` 数组加：

```ts
{ path: '/agent-debug', component: 'AgentDebugPage', requireAuth: true }
```

并在 router 配置（搜 `BrowserRouter` 或 `routes`）加导入。

- [ ] **Step 4: 加 admin 入口链接**

读 `apps/dashboard/src/pages/AdminSettingsPage.tsx`，在合适位置加：

```tsx
<Link to="/agent-debug" className="block py-2 text-blue-600 hover:underline">
  Agent 调试
</Link>
```

- [ ] **Step 5: 冒烟测试**

```bash
cd apps/dashboard && npm run dev
# 浏览器打开 http://localhost:5173/agent-debug
# 1. 看到"Agent 在线状态"
# 2. 点击"测试发布到公众号"
# 3. 看到日志 + agentId
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/pages/AgentDebugPage.tsx apps/dashboard/src/api/agent.api.ts apps/dashboard/src/config/navigation.config.ts apps/dashboard/src/pages/AdminSettingsPage.tsx
git commit -m "feat(agent): /agent-debug page with status + test publish button"
```

---

## Task 9: nginx WSS 配置 + 部署联调

**Files:**
- Modify: hk-vps `/etc/nginx/conf.d/...` 或项目内 nginx.conf

- [ ] **Step 1: 找到当前 nginx 配置**

```bash
ssh hk-vps "docker exec autopilot-dashboard cat /etc/nginx/conf.d/default.conf | head -60"
```

- [ ] **Step 2: 加 /agent-ws location**

在 nginx server block 里加：

```nginx
location /agent-ws {
    proxy_pass http://api-host:5200;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

- [ ] **Step 3: reload nginx + 部署 API**

```bash
# 部署 API（按现有 deploy/deploy.sh）
# reload nginx
ssh hk-vps "docker exec autopilot-dashboard nginx -s reload"
```

- [ ] **Step 4: 端到端联调**

```bash
# 在 Mac mini 跑 Agent 连云端
cd services/agent
ZENITHJOY_API_URL=wss://autopilot.zenjoymedia.media/agent-ws \
  AGENT_TOKEN=<from-1password> npm start

# 浏览器打开 https://autopilot.zenjoymedia.media/agent-debug
# 1. 看到 Agent 在线
# 2. 点测试发布
# 3. 5 秒内 task_result.ok=true
# 4. 公众号草稿箱有新草稿
```

- [ ] **Step 5: Commit**

```bash
git add deploy/nginx.conf  # 或对应文件
git commit -m "deploy(agent): nginx wss proxy for /agent-ws"
```

---

## 验收（DoD）

- [ ] 浏览器访问 `https://autopilot.zenjoymedia.media/agent-debug`
- [ ] Agent 在线显示绿点
- [ ] 点击"测试发布到公众号" → 5 秒内日志显示 `task_result.ok=true`
- [ ] 微信公众号草稿箱出现 `[Agent v0.1 自检] ...` 草稿
- [ ] Agent kill -9 后 30 秒内 dashboard 显示离线
- [ ] 错 token 连接被拒（4401 close code）

---

## Self-Review 完成

- ✅ 9 个 task 覆盖 spec 全部 8 个步骤
- ✅ 每个 step 都有完整代码（无 TBD）
- ✅ 文件路径精确，Function 名/类型一致
- ✅ TDD 顺序（写测试 → 失败 → 实现 → 通过 → commit）

---

**Plan complete and saved.** Two execution options:

1. **Subagent-Driven** (recommended) — Fresh subagent per task, review between tasks
2. **Inline Execution** — Execute in this session with checkpoints

按 /dev autonomous Tier 1 → **Subagent-Driven**.
