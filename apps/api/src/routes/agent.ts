// apps/api/src/routes/agent.ts
import { Router, Request, Response } from 'express';
import { agentRegistry } from '../services/agent-registry';
import { sendToAgent } from '../services/agent-ws';
import { makeMsg } from '../schemas/agent-protocol';
import {
  registerAgent,
  isValidLicenseKeyFormat,
} from '../services/license.service';

export const agentRouter = Router();

// ---------- v1.2 Agent License 注册端点（公开，无 internal token） ----------
//
// POST /api/agent/register
//   请求体：{ license_key, machine_id, hostname?, agent_id?, version? }
//   响应：
//     200 OK: { ok:true, license_id, tier, max_machines, registered_machine_id, ws_token }
//     401   : { ok:false, code:'INVALID_LICENSE' }
//     403   : { ok:false, code:'EXPIRED' | 'SUSPENDED' | 'QUOTA_EXCEEDED' }
//     400   : { ok:false, code:'BAD_REQUEST' }
agentRouter.post('/register', async (req: Request, res: Response) => {
  const { license_key, machine_id, hostname, agent_id, version } =
    req.body ?? {};

  if (typeof license_key !== 'string' || !isValidLicenseKeyFormat(license_key)) {
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: 'license_key 格式不合法（应为 ZJ-X-XXXXXXXX）',
    });
  }
  if (
    typeof machine_id !== 'string' ||
    machine_id.length < 4 ||
    machine_id.length > 200
  ) {
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: 'machine_id 长度需 4..200',
    });
  }

  try {
    const result = await registerAgent({
      license_key,
      machine_id,
      hostname: typeof hostname === 'string' ? hostname.slice(0, 200) : undefined,
      agent_id: typeof agent_id === 'string' ? agent_id.slice(0, 200) : undefined,
      version: typeof version === 'string' ? version.slice(0, 50) : undefined,
    });

    if (result.ok) {
      return res.status(200).json(result);
    }
    if (result.code === 'INVALID_LICENSE') return res.status(401).json(result);
    return res.status(403).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({
      ok: false,
      code: 'REGISTER_FAILED',
      message: msg,
    });
  }
});

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

// 抖音 dry-run 自检：路由到含 'douyin' capability 的 Agent（通常是 Windows PC）
agentRouter.post('/test-publish-douyin', (req, res) => {
  const agent = agentRegistry.pickFor('douyin');
  if (!agent) {
    return res.status(503).json({ error: 'no douyin-capable agent online' });
  }

  const taskId = `task-${Date.now()}`;
  const content = {
    title: `[Agent v0.1 抖音自检] ${new Date().toISOString().slice(0, 16)}`,
    content: '这是 ZenithJoy Agent 抖音 dry-run 自检。脚本会走完上传/填标题/填文案，但不会点击发布按钮。',
    // images 留空，Agent 端用自带 sample image
  };

  const sent = sendToAgent(agent.agentId, makeMsg('publish_request', {
    platform: 'douyin', content,
  }, taskId));

  if (!sent) return res.status(503).json({ error: 'agent not reachable' });

  res.json({ ok: true, taskId, agentId: agent.agentId });
});

// v0.3：6 个新平台 dry-run 自检（统一模式 — 1:1 复用 douyin handler 形态）
const DRY_RUN_PLATFORMS: Array<{ slug: string; label: string }> = [
  { slug: 'kuaishou', label: '快手' },
  { slug: 'xiaohongshu', label: '小红书' },
  { slug: 'toutiao', label: '头条' },
  { slug: 'weibo', label: '微博' },
  { slug: 'shipinhao', label: '视频号' },
  { slug: 'zhihu', label: '知乎' },
];

for (const { slug, label } of DRY_RUN_PLATFORMS) {
  agentRouter.post(`/test-publish-${slug}`, (req, res) => {
    const agent = agentRegistry.pickFor(slug);
    if (!agent) {
      return res.status(503).json({ error: `no ${slug}-capable agent online` });
    }

    const taskId = `task-${Date.now()}`;
    const content = {
      title: `[Agent v0.3 ${label}自检] ${new Date().toISOString().slice(0, 16)}`,
      content: `这是 ZenithJoy Agent ${label} dry-run 自检。脚本会走完上传/填标题/填文案，但不会点击发布按钮。`,
      // images 留空，Agent 端用自带 sample image
    };

    const sent = sendToAgent(agent.agentId, makeMsg('publish_request', {
      platform: slug, content,
    }, taskId));

    if (!sent) return res.status(503).json({ error: 'agent not reachable' });

    res.json({ ok: true, taskId, agentId: agent.agentId });
  });
}
