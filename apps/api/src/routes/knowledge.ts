/**
 * 知识中枢 路① 第一刀 — 经验录入 + 「最近沉淀」读端 + 投影表只读读端
 *
 * 三个端点全部挂 knowledgeAuthGuard：身份只来自服务端会话，本文件不读任何请求头
 * （A27 静态守卫扫描本文件，出现身份头名字面量即报红）。
 *
 *   POST /api/staff/knowledge/entries     录入一条经验 → 落 Cecelia 账本 public.learnings
 *   GET  /api/staff/knowledge/recent      「最近沉淀」，只返回本组织条目，读实时源不读投影表
 *   GET  /api/staff/knowledge/projection  zenithjoy 侧只读投影，**没有**写端点（SSOT 单向）
 *
 * 归属载体（判定点 J-B）：账本 public.learnings 属 cecelia repo，实测无 org_id / author_member_id
 * 真列，本刀用既有 metadata jsonb 承载，与正文同行原子写入。这是**过渡形状**——cecelia Sprint A
 * 落真列后须迁移并退役。之所以不另建一张映射表：归属与正文一旦分家就会不同步，
 * 而归属漏写的后果是跨企业泄漏，因此写入路径宁可"无 org 即拒写"也不写 null 归属。
 *
 * 落库通道（判定点 J-A）：Brain 的 POST /api/brain/learnings 实测 404（无写端点），
 * 故直连 PG 写账本本体。"zenithjoy API 与 cecelia 账本同库"是环境假设，不能默认成立——
 * 每次写入前跑一次账本身份 preflight 真证明它，不过就 503 拒写。假设在生产不成立时
 * 会显性失败，而不是静默写进一张同名空表让问答链路永远查不到。
 */
import { Router, type Request, type Response } from 'express';
import pool from '../db/connection';
import { knowledgeAuthGuard } from '../middleware/knowledge-auth';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';

const router = Router();

const LEDGER_UNREACHABLE_MESSAGE = '账本暂时不可达，未写入';
const NO_ORG_CONTEXT_MESSAGE = '缺少组织上下文，已拒绝写入';
const RECENT_LIMIT = 50;

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
}

/**
 * 账本身份 preflight：证明我们即将写的 public.learnings 就是 Cecelia 账本本体，
 * 而不是一张恰好同名的表。列形状对不上即认定不可达。
 */
async function ledgerPreflight(): Promise<boolean> {
  try {
    const res = await pool.query(
      `SELECT count(*)::int AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'learnings'
          AND column_name IN ('id', 'title', 'metadata', 'created_at')`
    );
    return Number(res.rows[0]?.c ?? 0) === 4;
  } catch (err) {
    console.error('[knowledge] 账本 preflight 失败:', (err as Error).message);
    return false;
  }
}

/** evidence_url 只放行 http/https —— javascript: 之类的伪协议直接 400，不入库 */
function isAllowedEvidenceUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function readTrimmed(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// 限流排在鉴权闸**之前**：鉴权闸本身就要查一次 tenant_members，放在后面的话
// 未登录的洪水依然能把库打穿。按来源 IP 计数（此时还没有身份可用）。
// 300/分钟对真人操作和 E2E 轮询都绰绰有余，只挡机器级刷量。
router.use(simpleRateLimit({ windowMs: 60_000, max: 300, keyFn: ipKeyFn }));
router.use(knowledgeAuthGuard);

// ─── 录入一条经验 ────────────────────────────────────────────────────────────
router.post('/entries', async (req: Request, res: Response): Promise<void> => {
  const identity = req.knowledgeIdentity;
  if (!identity?.orgId) {
    fail(res, 403, 'NO_ORG_CONTEXT', NO_ORG_CONTEXT_MESSAGE);
    return;
  }

  const triggerCondition = readTrimmed(req.body?.trigger_condition);
  const conclusion = readTrimmed(req.body?.conclusion);
  const evidenceUrl = readTrimmed(req.body?.evidence_url);

  if (!triggerCondition || !conclusion || !evidenceUrl) {
    fail(res, 400, 'INVALID_INPUT', '触发条件、结论、证据链接都必须填写');
    return;
  }
  if (!isAllowedEvidenceUrl(evidenceUrl)) {
    fail(res, 400, 'INVALID_EVIDENCE_URL', '证据链接必须是 http/https 地址');
    return;
  }

  // 请求体里的 org_id / author_member_id 等归属字段一律忽略（不报错，不给探测信号），
  // 归属只认会话解析出来的那一个。
  const metadata = {
    source: 'knowledge-hub',
    org_id: identity.orgId,
    author_member_id: identity.memberId,
    trigger_condition: triggerCondition,
    conclusion,
    evidence_url: evidenceUrl,
  };

  if (!(await ledgerPreflight())) {
    fail(res, 503, 'LEDGER_UNREACHABLE', LEDGER_UNREACHABLE_MESSAGE);
    return;
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO public.learnings (title, category, content, metadata, author, made_by)
       VALUES ($1, 'knowledge_hub', $2, $3::jsonb, 'staff-hub', 'user')
       RETURNING id::text AS id, created_at`,
      [conclusion.slice(0, 255), `${triggerCondition}\n\n${conclusion}`, JSON.stringify(metadata)]
    );
    const row = inserted.rows[0] as { id: string; created_at: Date };
    res.status(201).json({
      success: true,
      data: {
        entry_id: row.id,
        org_id: identity.orgId,
        created_at: new Date(row.created_at).toISOString(),
      },
    });
  } catch (err) {
    const pgErr = err as { code?: string; message?: string };
    if (pgErr.code === '23505') {
      fail(res, 409, 'DUPLICATE_ENTRY', '该条经验已存在');
      return;
    }
    console.error('[knowledge] 录入写账本失败:', pgErr.message);
    fail(res, 503, 'LEDGER_UNREACHABLE', LEDGER_UNREACHABLE_MESSAGE);
  }
});

// ─── 「最近沉淀」：读实时源，只显本组织 ───────────────────────────────────────
router.get('/recent', async (req: Request, res: Response): Promise<void> => {
  const identity = req.knowledgeIdentity;
  if (!identity?.orgId) {
    fail(res, 403, 'NO_ORG_CONTEXT', NO_ORG_CONTEXT_MESSAGE);
    return;
  }

  try {
    // 组织过滤放在 SQL 里，不在 JS 层过滤 —— 少一层"忘了过滤"的机会
    const result = await pool.query(
      `SELECT id::text                             AS entry_id,
              metadata->>'trigger_condition'       AS trigger_condition,
              metadata->>'conclusion'              AS conclusion,
              metadata->>'evidence_url'            AS evidence_url,
              metadata->>'author_member_id'        AS author_member_id,
              metadata->>'org_id'                  AS org_id,
              created_at
         FROM public.learnings
        WHERE metadata->>'org_id' = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [identity.orgId, RECENT_LIMIT]
    );
    const items = result.rows.map((r) => ({
      entry_id: String(r.entry_id),
      trigger_condition: r.trigger_condition ?? '',
      conclusion: r.conclusion ?? '',
      evidence_url: r.evidence_url ?? '',
      author_member_id: r.author_member_id ?? '',
      org_id: String(r.org_id),
      created_at: new Date(r.created_at as string).toISOString(),
    }));
    res.json({ success: true, data: { items, count: items.length } });
  } catch (err) {
    // 账本读不到时绝不回空列表 —— 空列表会被用户读成"库里还没有"，
    // 于是一次静默故障看起来和"确实没沉淀过"一模一样。
    console.error('[knowledge] 最近沉淀读账本失败:', (err as Error).message);
    fail(res, 503, 'LEDGER_UNREACHABLE', LEDGER_UNREACHABLE_MESSAGE);
  }
});

// ─── 投影表只读读端（SSOT 单向：本仓只读，写入权在 cecelia 账本侧）─────────────
router.get('/projection', async (req: Request, res: Response): Promise<void> => {
  const identity = req.knowledgeIdentity;
  if (!identity?.orgId) {
    fail(res, 403, 'NO_ORG_CONTEXT', NO_ORG_CONTEXT_MESSAGE);
    return;
  }

  try {
    const result = await pool.query(
      `SELECT entry_id::text AS entry_id, org_id::text AS org_id, title, evidence_url, created_at
         FROM zenithjoy.knowledge_entries_projection
        WHERE org_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT $2`,
      [identity.orgId, RECENT_LIMIT]
    );
    const items = result.rows.map((r) => ({
      entry_id: String(r.entry_id),
      org_id: String(r.org_id),
      title: r.title ?? '',
      evidence_url: r.evidence_url ?? '',
      created_at: new Date(r.created_at as string).toISOString(),
    }));
    res.json({ success: true, data: { items, count: items.length } });
  } catch (err) {
    console.error('[knowledge] 投影表读取失败:', (err as Error).message);
    fail(res, 503, 'LEDGER_UNREACHABLE', LEDGER_UNREACHABLE_MESSAGE);
  }
});

// 兜底：知识面未匹配到的路径/方法就地终结，不许落到后面的 staffGuard 去 ——
// 否则 POST /projection 会被身份头闸接管、回一个与"没有这个端点"完全不同的 403，
// 让"投影表有没有写端点"这个问题被鉴权噪音盖住。
router.all('*', (_req: Request, res: Response): void => {
  fail(res, 405, 'METHOD_NOT_ALLOWED', '知识中枢没有这个端点');
});

export default router;
export { router as knowledgeRouter };
