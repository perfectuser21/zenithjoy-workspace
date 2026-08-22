/**
 * 路② 协同文档路由 —— 挂在 /api/workbench/documents
 *
 * 全部端点走 documentAuthGuard：身份与组织归属只来自服务端会话（复用 better-auth getSession +
 * tenant_members 真查，与路③ workbenchAuthGuard 同口径）。本文件不读任何请求头，请求体里的
 * org_id 一律不看（A1 判据）。
 *
 * 与 workbenchAuthGuard 的唯一差异：**无归属（rows.length===0）翻 404 而非 403**。文档是反枚举
 * 资源——一个被移出企业的成员（member live 校验：tenant_members 行被删）对任何文档都应"不可达且
 * 与不存在同形"（A4：删 member 后其对成员集合文档立即 404）。用 403 会把"你没归属"暴露成一种
 * 可区分状态，与"六处过滤统一 404 同形状"冲突。多归属仍 fail-closed 409（绝不静默取 rows[0]）。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import pool from '../db/connection';
import { auth } from '../auth';
import {
  workbenchErrorBody,
  notFoundBody,
  MULTI_ORG_MESSAGE,
  SESSION_REQUIRED_MESSAGE,
  LEDGER_UNREACHABLE_MESSAGE,
  type WorkbenchIdentity,
} from '../middleware/workbench-auth';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';
import {
  createDocument,
  getDocument,
  patchDocument,
  moveDocument,
  deleteDocument,
  restoreDocument,
  listTree,
  searchDocuments,
  exportMarkdown,
  setVisibility,
  resolveMentionTarget,
  DocumentValidationError,
} from '../workbench/document.service';

const router = Router();

async function resolveSessionMemberId(req: Request): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const id = session?.user?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

async function documentAuthGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const memberId = await resolveSessionMemberId(req);
  if (!memberId) {
    res.status(401).json(workbenchErrorBody('SESSION_REQUIRED', SESSION_REQUIRED_MESSAGE));
    return;
  }
  let rows: Array<{ tenant_id: string }>;
  try {
    const result = await pool.query(
      'SELECT DISTINCT tenant_id::text AS tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id = $1',
      [memberId]
    );
    rows = result.rows as Array<{ tenant_id: string }>;
  } catch (err) {
    console.error('[documents-auth] tenant_members 查询失败:', (err as Error).message);
    res.status(503).json(workbenchErrorBody('LEDGER_UNREACHABLE', LEDGER_UNREACHABLE_MESSAGE));
    return;
  }
  if (rows.length === 0) {
    // member live：被移出企业 → 对任何文档不可达，同不存在形状（反枚举）
    res.status(404).json(notFoundBody());
    return;
  }
  if (rows.length > 1) {
    console.error(`[documents-auth] MULTI-ORG member=${memberId} orgs=${rows.length}`);
    res.status(409).json(workbenchErrorBody('MULTI_ORG_MEMBER', MULTI_ORG_MESSAGE));
    return;
  }
  req.workbenchIdentity = { memberId, orgId: rows[0].tenant_id } as WorkbenchIdentity;
  next();
}

router.use(simpleRateLimit({ windowMs: 60_000, max: 300, keyFn: ipKeyFn }));
router.use(documentAuthGuard);

function ok(res: Response, status: number, data: unknown): void {
  res.status(status).json({ success: true, data });
}
function notFound(res: Response): void {
  res.status(404).json(notFoundBody());
}
function serverError(res: Response, scope: string, err: unknown): void {
  console.error(`[documents] ${scope} 失败:`, (err as Error).message);
  res.status(503).json(workbenchErrorBody('LEDGER_UNREACHABLE', LEDGER_UNREACHABLE_MESSAGE));
}
function badRequest(res: Response, message: string): void {
  res.status(400).json(workbenchErrorBody('VALIDATION_FAILED', message));
}

// ── 读：本组织可见文档树（放在 /:id 之前，避免 tree 被当成 id）──────────────────
router.get('/tree', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  try {
    ok(res, 200, { nodes: await listTree(id.orgId, id.memberId) });
  } catch (err) {
    serverError(res, 'listTree', err);
  }
});

// ── 读：检索 ─────────────────────────────────────────────────────────────────
router.get('/search', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    ok(res, 200, { results: await searchDocuments(id.orgId, id.memberId, q) });
  } catch (err) {
    serverError(res, 'searchDocuments', err);
  }
});

// ── 写：建文档 ───────────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const detail = await createDocument(id.orgId, id.memberId, {
      title: body.title,
      parent_id: body.parent_id,
      content: body.content,
    });
    ok(res, 201, detail);
  } catch (err) {
    if (err instanceof DocumentValidationError) return badRequest(res, err.message);
    serverError(res, 'createDocument', err);
  }
});

// ── 读：单篇 ─────────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  try {
    const detail = await getDocument(id.orgId, id.memberId, req.params.id);
    if (!detail) return notFound(res);
    ok(res, 200, detail);
  } catch (err) {
    serverError(res, 'getDocument', err);
  }
});

// ── 写：自动保存（PATCH content/title）──────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const detail = await patchDocument(id.orgId, id.memberId, req.params.id, {
      content: body.content,
      title: body.title,
    });
    if (!detail) return notFound(res);
    ok(res, 200, detail);
  } catch (err) {
    if (err instanceof DocumentValidationError) return badRequest(res, err.message);
    serverError(res, 'patchDocument', err);
  }
});

// ── 写：移动 ─────────────────────────────────────────────────────────────────
router.post('/:id/move', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parentId = typeof body.parent_id === 'string' ? body.parent_id : null;
  try {
    const detail = await moveDocument(id.orgId, id.memberId, req.params.id, parentId);
    if (!detail) return notFound(res);
    ok(res, 200, detail);
  } catch (err) {
    serverError(res, 'moveDocument', err);
  }
});

// ── 写：软删 ─────────────────────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  try {
    const out = await deleteDocument(id.orgId, id.memberId, req.params.id);
    if (!out) return notFound(res);
    ok(res, 200, out);
  } catch (err) {
    serverError(res, 'deleteDocument', err);
  }
});

// ── 写：还原 ─────────────────────────────────────────────────────────────────
router.post('/:id/restore', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  try {
    const out = await restoreDocument(id.orgId, id.memberId, req.params.id);
    if (!out) return notFound(res);
    ok(res, 200, out);
  } catch (err) {
    serverError(res, 'restoreDocument', err);
  }
});

// ── 读：导出 Markdown ─────────────────────────────────────────────────────────
router.get('/:id/export', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  try {
    const md = await exportMarkdown(id.orgId, id.memberId, req.params.id);
    if (md === null) return notFound(res);
    res.status(200).type('text/markdown').send(md);
  } catch (err) {
    serverError(res, 'exportMarkdown', err);
  }
});

// ── 写：可见性 ───────────────────────────────────────────────────────────────
router.put('/:id/visibility', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const detail = await setVisibility(id.orgId, id.memberId, req.params.id, body.visibility, body.member_ids);
    if (!detail) return notFound(res);
    ok(res, 200, detail);
  } catch (err) {
    serverError(res, 'setVisibility', err);
  }
});

// ── 读：@提及解析 ─────────────────────────────────────────────────────────────
router.post('/:id/mention/resolve', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetId = typeof body.target_id === 'string' ? body.target_id : '';
  try {
    const out = await resolveMentionTarget(id.orgId, id.memberId, targetId);
    if (!out) return notFound(res);
    ok(res, 200, out);
  } catch (err) {
    serverError(res, 'resolveMentionTarget', err);
  }
});

export default router;
export { router as documentsRouter };
