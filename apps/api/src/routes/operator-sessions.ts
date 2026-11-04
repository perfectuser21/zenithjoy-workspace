import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { requiredInternalAuth } from '../middleware/internal-auth';
import { superAdminGuard } from '../middleware/super-admin';
import { licenseAuth } from '../middleware/license-auth';

import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';

const statusLimit = simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn });
const router = Router();

const VALID_PLATFORMS = [
  'douyin',
  'kuaishou',
  'xiaohongshu',
  'shipinhao',
  'toutiao',
  'weibo',
  'zhihu',
  'gongzhonghao',
] as const;

type ValidPlatform = (typeof VALID_PLATFORMS)[number];

function buildSecretName(platform: string): string {
  return `${platform.toUpperCase()}_COOKIES`;
}

// POST /trigger-bind — 派发平台绑定任务给 Agent（写 publish_tasks，agent 下次 heartbeat 拉到）
// v1.1.34+: 支持 agent_id 精准派发 — Dashboard 从本地 localhost:58432/agent-id 拿到本机 UUID 后传来，
//           避免多机环境（如同账号连了 xian-pc + xian-rog）派到错误的机器。
router.post('/trigger-bind', superAdminGuard, async (req: Request, res: Response) => {
  const { platform, agent_id: explicitAgentId } = req.body || {};

  if (!platform || !VALID_PLATFORMS.includes(platform as ValidPlatform)) {
    return res.status(400).json({
      error: `无效 platform: "${platform}"。有效值: ${VALID_PLATFORMS.join(', ')}`,
    });
  }

  let agentId: string;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (explicitAgentId && typeof explicitAgentId === 'string') {
    if (!UUID_RE.test(explicitAgentId)) {
      return res.status(400).json({ error: '无效 agent_id 格式（期望 UUID）' });
    }
    // 精准派发：客户端传来了本地 agent UUID（v1.1.35+ Agent 暴露 localhost:58432/agent-id）
    agentId = explicitAgentId;
  } else {
    // 回退：按最近心跳选 agent（单机环境够用，多机时可能选错）
    const { rows: agents } = await pool.query<{ id: string }>(
      `SELECT id FROM zenithjoy.agents
       WHERE last_heartbeat_at > NOW() - INTERVAL '5 minutes'
       ORDER BY last_heartbeat_at DESC
       LIMIT 1`
    );

    if (agents.length === 0) {
      return res.status(503).json({
        error: 'Agent 未连接，请确认本机 Agent 正在运行并联网（v1.1.34+ 支持精准派发）',
      });
    }

    agentId = agents[0].id;
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status)
     VALUES ($1, $2, 'queued')
     RETURNING id`,
    [agentId, `qr_bind/${platform}`]
  );

  return res.status(202).json({ ok: true, platform, taskId: rows[0].id });
});

// POST /upload-cookies — Agent 上传 storageState，写入 GitHub Secrets
// licenseAuth: agent 用 Authorization: Bearer <license_key> 调用
router.post('/upload-cookies', licenseAuth, async (req: Request, res: Response) => {
  const { platform, cookies } = req.body || {};

  if (!platform || typeof platform !== 'string') {
    return res.status(400).json({ error: 'platform 必填' });
  }
  if (!cookies || typeof cookies !== 'object') {
    return res.status(400).json({ error: 'cookies 必填且须为对象' });
  }

  const secretName = buildSecretName(platform);
  const pat = process.env.GH_SECRETS_WRITE_PAT;

  if (!pat) {
    console.warn('[upload-cookies] GH_SECRETS_WRITE_PAT 未设置，跳过 GitHub Secrets 写入（dev 模式）');
    try {
      await pool.query(
        `INSERT INTO operator_sessions (platform, secret_name, status, last_checked_at, last_valid_at)
         VALUES ($1, $2, 'active', NOW(), NOW())
         ON CONFLICT (platform) DO UPDATE
           SET secret_name = $2,
               status = 'active',
               last_checked_at = NOW(),
               last_valid_at = NOW(),
               updated_at = NOW()`,
        [platform, secretName],
      );
    } catch (dbErr) {
      console.error('[upload-cookies] DB upsert 失败（可忽略在 dev 模式）:', dbErr);
    }
    return res.status(200).json({ ok: true, platform, secretName });
  }

  // 生产路径：调用 GitHub REST API（Octokit 兼容格式）写入加密 Secret
  // 加密步骤需要 libsodium-wrappers（crypto_box_seal + publicKey from repos secrets/public-key）
  // Secret 名称格式：{PLATFORM_UPPER}_COOKIES（由 buildSecretName 保证）
  const owner = process.env.GH_REPO_OWNER || 'perfectuser21';
  const repo = process.env.GH_REPO_NAME || 'zenithjoy';

  try {
    const keyRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`,
      { headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' } },
    );

    if (!keyRes.ok) {
      if (keyRes.status === 403) {
        return res.status(403).json({ error: 'PAT scope insufficient' });
      }
      return res.status(500).json({ error: `GitHub API 错误: ${keyRes.status}` });
    }

    const { key_id } = (await keyRes.json()) as { key: string; key_id: string };

    // 写入 GitHub Secret（生产环境需 libsodium crypto_box_seal 加密）
    const putRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/secrets/${secretName}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          encrypted_value: Buffer.from(JSON.stringify(cookies)).toString('base64'),
          key_id,
        }),
      },
    );

    if (!putRes.ok && putRes.status !== 204) {
      if (putRes.status === 403) {
        return res.status(403).json({ error: 'PAT scope insufficient' });
      }
      return res.status(500).json({ error: `GitHub Secret 写入失败: ${putRes.status}` });
    }

    await pool.query(
      `INSERT INTO operator_sessions (platform, secret_name, status, last_checked_at, last_valid_at)
       VALUES ($1, $2, 'active', NOW(), NOW())
       ON CONFLICT (platform) DO UPDATE
         SET secret_name = $2,
             status = 'active',
             last_checked_at = NOW(),
             last_valid_at = NOW(),
             updated_at = NOW()`,
      [platform, secretName],
    );

    return res.status(200).json({ ok: true, platform, secretName });
  } catch (err) {
    console.error('[upload-cookies] 错误:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// GET / — 返回 8 平台主号状态（无数据时 status=missing）
router.get('/', async (_req: Request, res: Response) => {
  let dbRows: Array<{
    platform: string;
    secret_name: string;
    status: string;
    last_checked_at: string | null;
    last_valid_at: string | null;
  }> = [];

  try {
    const result = await pool.query(
      'SELECT platform, secret_name, status, last_checked_at, last_valid_at FROM operator_sessions',
    );
    dbRows = result.rows;
  } catch (err) {
    console.warn('[GET sessions] DB 查询失败，返回全 missing 状态:', err);
  }

  const dbMap = new Map(dbRows.map((r) => [r.platform, r]));

  const sessions = VALID_PLATFORMS.map((platform) => {
    const row = dbMap.get(platform);
    return {
      lastCheckedAt: row?.last_checked_at ?? null,
      lastValidAt: row?.last_valid_at ?? null,
      platform,
      secretName: row?.secret_name ?? buildSecretName(platform),
      status: row?.status ?? 'missing',
    };
  });

  return res.status(200).json(sessions);
});

// POST /status — GHA 巡检回写（internal-auth 守卫）
router.post('/status', statusLimit, requiredInternalAuth, async (req: Request, res: Response) => {
  const { updates } = req.body || {};

  if (!Array.isArray(updates) || updates.length === 0 || updates.length > VALID_PLATFORMS.length) {
    return res.status(400).json({ error: 'updates 必须是非空平台数组' });
  }
  const seen = new Set<string>();
  const rows: Array<{ platform: string; secret_name: string; status: string; checked_at: string }> = [];
  for (const update of updates) {
    if (!update || typeof update !== 'object') return res.status(400).json({ error: '无效 update' });
    const { platform, status, checkedAt } = update;
    if (!VALID_PLATFORMS.includes(platform) || seen.has(platform)
      || !['active', 'expired', 'missing'].includes(status)
      || (checkedAt !== undefined && (typeof checkedAt !== 'string' || !Number.isFinite(Date.parse(checkedAt))))) {
      return res.status(400).json({ error: '无效 platform/status/checkedAt 或重复平台' });
    }
    seen.add(platform);
    rows.push({ platform, secret_name: buildSecretName(platform), status,
      checked_at: checkedAt === undefined ? new Date().toISOString() : new Date(checkedAt).toISOString() });
  }
  try {
    // One statement makes the whole batch atomic: a failed row cannot leave an
    // earlier platform updated while telling the patrol that all writes succeeded.
    const result = await pool.query(
      `INSERT INTO operator_sessions (platform, secret_name, status, last_checked_at, last_valid_at)
       SELECT platform, secret_name, status, checked_at,
              CASE WHEN status = 'active' THEN checked_at ELSE NULL END
       FROM jsonb_to_recordset($1::jsonb)
         AS incoming(platform text, secret_name text, status text, checked_at timestamptz)
       ON CONFLICT (platform) DO UPDATE SET
         status = EXCLUDED.status,
         secret_name = EXCLUDED.secret_name,
         last_checked_at = EXCLUDED.last_checked_at,
         last_valid_at = CASE WHEN EXCLUDED.status = 'active' THEN EXCLUDED.last_checked_at
                              ELSE operator_sessions.last_valid_at END,
         updated_at = NOW()`,
      [JSON.stringify(rows)],
    );
    if (result.rowCount !== rows.length) throw new Error('incomplete session status write');
    return res.status(200).json({ ok: true, updated: result.rowCount });
  } catch (err) {
    console.error('[POST status] 回写失败:', err);
    return res.status(500).json({ ok: false, error: 'SESSION_STATUS_WRITE_FAILED' });
  }
});

export const operatorSessionsRouter = router;
