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
