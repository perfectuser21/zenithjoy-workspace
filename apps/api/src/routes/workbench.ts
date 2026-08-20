/**
 * 路③ 结构化工作台路由 —— 挂在 /api/knowledge/db，九个端点（4 写 + 5 读）
 *
 * 写：POST /tables、POST /tables/:id/fields、DELETE /tables/:id、POST /trash/:id/restore
 * 读：GET /tables、GET /tables/:id、GET /tables/:id/fields、GET /trash、GET /templates
 *
 * 全部端点挂 workbenchAuthGuard —— 身份与组织归属只来自服务端会话。本文件**不读任何
 * 请求头**，请求体里出现的 org_id / tenant_id 一律不看（A1 的判据就是这条）。
 *
 * 为什么不挂在 /api/staff 下：那个前缀被身份头闸接管，路③ 端点一旦落进去，
 * 「身份只来自会话」当场作废，且既有 16 端点的计数会变成 17 让路① smoke 报红。
 *
 * 反枚举：跨组织 id、他人的私有表、压根不存在的 id，三者一律 404 且响应体逐字节相同
 * （notFoundBody 是个常量，连 timestamp 都不带——带上就能靠比对字节分辨 id 是否真实存在）。
 */
import { Router, type Request, type Response } from 'express';
import { workbenchAuthGuard, workbenchErrorBody, notFoundBody } from '../middleware/workbench-auth';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';
import {
  createTable,
  listTables,
  getTable,
  listFields,
  addFields,
  softDeleteTable,
  listTrash,
  restoreTable,
  WorkbenchValidationError,
} from '../services/workbench.service';
import { WORKBENCH_TEMPLATES } from '../knowledge/workbench-templates';

const router = Router();

// 限流在鉴权**之前**：未鉴权的洪水不应该有机会一路打到会话解析和成员表查询上。
// 300/分钟 对真人操作绰绰有余（建一张表也就几次请求），对脚本化枚举则是道坎。
router.use(simpleRateLimit({ windowMs: 60_000, max: 300, keyFn: ipKeyFn }));
router.use(workbenchAuthGuard);

function ok(res: Response, status: number, data: unknown): void {
  res.status(status).json({ success: true, data });
}

function notFound(res: Response): void {
  res.status(404).json(notFoundBody());
}

/** 未预期的异常一律 503：查不动库不是"没权限"，也不是"参数错" */
function serverError(res: Response, scope: string, err: unknown): void {
  // INV-5 日志脱敏：只打 scope 与错误信息，绝不打表名/字段名/单元格正文
  console.error(`[workbench] ${scope} 失败:`, (err as Error).message);
  res.status(503).json(workbenchErrorBody('LEDGER_UNREACHABLE', '账本暂时不可达，未写入'));
}

function badRequest(res: Response, err: WorkbenchValidationError): void {
  res.status(400).json(workbenchErrorBody('VALIDATION_FAILED', err.message));
}

// ── 读：开箱模板 ─────────────────────────────────────────────────────────────
router.get('/templates', (_req: Request, res: Response) => {
  ok(res, 200, {
    templates: WORKBENCH_TEMPLATES.map((t) => ({
      template_key: t.template_key,
      name: t.name,
      fields: t.fields.map((f) => ({
        name: f.name,
        field_type: f.field_type,
        options: [...f.options],
        display_order: f.display_order,
      })),
    })),
  });
});

// ── 读：本组织可见表列表 ─────────────────────────────────────────────────────
router.get('/tables', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  try {
    ok(res, 200, { tables: await listTables(id.orgId, id.memberId) });
  } catch (err) {
    serverError(res, 'listTables', err);
  }
});

// ── 写：建表 ─────────────────────────────────────────────────────────────────
router.post('/tables', async (req: Request, res: Response) => {
  const id = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    // 注意这里只取 name / visibility / fields / template_key ——
    // body.org_id 与 body.tenant_id 连读都不读，归属永远是 id.orgId。
    const detail = await createTable({
      orgId: id.orgId,
      memberId: id.memberId,
      name: typeof body.name === 'string' ? body.name : '',
      visibility: typeof body.visibility === 'string' ? body.visibility : 'org',
      fields: body.fields,
      templateKey: typeof body.template_key === 'string' ? body.template_key : undefined,
    });
    ok(res, 201, detail);
  } catch (err) {
    if (err instanceof WorkbenchValidationError) return badRequest(res, err);
    serverError(res, 'createTable', err);
  }
});

// ── 读：表详情（含全部字段定义） ──────────────────────────────────────────────
router.get('/tables/:id', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    const detail = await getTable(identity.orgId, identity.memberId, req.params.id);
    if (!detail) return notFound(res);
    ok(res, 200, detail);
  } catch (err) {
    serverError(res, 'getTable', err);
  }
});

// ── 读：字段定义 ─────────────────────────────────────────────────────────────
router.get('/tables/:id/fields', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    const fields = await listFields(identity.orgId, identity.memberId, req.params.id);
    if (!fields) return notFound(res);
    ok(res, 200, { fields });
  } catch (err) {
    serverError(res, 'listFields', err);
  }
});

// ── 写：加字段 ───────────────────────────────────────────────────────────────
router.post('/tables/:id/fields', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const fields = await addFields(identity.orgId, identity.memberId, req.params.id, body.fields);
    if (!fields) return notFound(res);
    ok(res, 201, { fields });
  } catch (err) {
    if (err instanceof WorkbenchValidationError) return badRequest(res, err);
    serverError(res, 'addFields', err);
  }
});

// ── 写：软删（二次确认表名） ─────────────────────────────────────────────────
router.delete('/tables/:id', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const outcome = await softDeleteTable(
      identity.orgId,
      identity.memberId,
      req.params.id,
      body.confirm_name
    );
    if (outcome.kind === 'not_found') return notFound(res);
    if (outcome.kind === 'confirm_mismatch') {
      res
        .status(400)
        .json(workbenchErrorBody('CONFIRM_MISMATCH', '输入的表名与要删除的表不一致，未执行删除'));
      return;
    }
    ok(res, 200, { table_id: outcome.tableId, deleted_at: outcome.deletedAt });
  } catch (err) {
    serverError(res, 'softDeleteTable', err);
  }
});

// ── 读：回收站 ───────────────────────────────────────────────────────────────
router.get('/trash', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    ok(res, 200, { tables: await listTrash(identity.orgId, identity.memberId) });
  } catch (err) {
    serverError(res, 'listTrash', err);
  }
});

// ── 写：还原 ─────────────────────────────────────────────────────────────────
router.post('/trash/:id/restore', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    const restored = await restoreTable(identity.orgId, identity.memberId, req.params.id);
    if (!restored) return notFound(res);
    ok(res, 200, restored);
  } catch (err) {
    serverError(res, 'restoreTable', err);
  }
});

export default router;
export { router as workbenchRouter };
