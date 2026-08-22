/**
 * 路③ 结构化工作台路由 —— 挂在 /api/knowledge/db，十七个端点（9 写 + 8 读）
 *
 * 表层（Sprint A）
 *   写：POST /tables、POST /tables/:id/fields、DELETE /tables/:id、POST /trash/:id/restore
 *   读：GET /tables、GET /tables/:id、GET /tables/:id/fields、GET /trash、GET /templates
 * 行层（Sprint B）
 *   写：POST /tables/:id/rows、PATCH /rows/:id、DELETE /rows/:id、POST /rows/:id/restore、
 *       POST /tables/:id/rows/paste
 *   读：GET /tables/:id/rows、GET /tables/:id/rows/trash、GET /tables/:id/export
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
import {
  listRows,
  listRowTrash,
  exportTable,
  createRow,
  patchRow,
  softDeleteRow,
  restoreRow,
  pasteRows,
  RowLimitError,
  RowVersionConflictError,
  isCrossTableFieldError,
} from '../services/workbench-rows.service';
import {
  listViews,
  createView,
  patchView,
  deleteView,
  assignedToMe,
  GroupFieldTypeError,
  LastViewProtectedError,
  isViewFieldNotFoundError,
} from '../services/workbench-views.service';
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

/** 超上限与"值不合法"是两件事：前者要告诉用户当前上限与已有行数，好让他自己删行或分批 */
function rowLimitExceeded(res: Response, err: RowLimitError): void {
  res.status(400).json(workbenchErrorBody('ROW_LIMIT_EXCEEDED', err.message));
}

/**
 * 409 在本路有两个持有者：闸层的 MULTI_ORG_MEMBER 与本端点的 ROW_VERSION_CONFLICT，
 * 所以断言一律查 error.code 而不是裸状态码。
 */
function versionConflict(res: Response, err: RowVersionConflictError): void {
  res.status(409).json(workbenchErrorBody('ROW_VERSION_CONFLICT', err.message));
}

/** 行端点族的错误分派：顺序即语义（404 已在各 handler 里先行判掉） */
function rowError(res: Response, scope: string, err: unknown): void {
  if (err instanceof RowVersionConflictError) return versionConflict(res, err);
  if (err instanceof RowLimitError) return rowLimitExceeded(res, err);
  if (err instanceof WorkbenchValidationError) return badRequest(res, err);
  serverError(res, scope, err);
}

/** GET rows 的筛/排错误分派：跨表 field_id → 404 同形（不泄露存在性）；形状/白名单 → 400 */
function rowsListError(res: Response, scope: string, err: unknown): void {
  if (isCrossTableFieldError(err)) return notFound(res);
  if (err instanceof WorkbenchValidationError) return badRequest(res, err);
  serverError(res, scope, err);
}

/** 分组字段类型不是 single_select（controller concern C2）。 */
function groupFieldTypeInvalid(res: Response): void {
  res
    .status(400)
    .json(workbenchErrorBody('GROUP_FIELD_TYPE_INVALID', '分组列只能选单选字段'));
}

/** 删到最后一个视图：至少保留一个。 */
function lastViewProtected(res: Response): void {
  res
    .status(400)
    .json(workbenchErrorBody('LAST_VIEW_PROTECTED', '至少保留一个视图，删到最后一个被拒'));
}

/** 视图端点族错误分派：跨表 field_id → 404 同形（优先于 400）/ 类型闸 400 / 保底 400 / 形状 400。 */
function viewError(res: Response, scope: string, err: unknown): void {
  if (isViewFieldNotFoundError(err)) return notFound(res);
  if (err instanceof GroupFieldTypeError) return groupFieldTypeInvalid(res);
  if (err instanceof LastViewProtectedError) return lastViewProtected(res);
  if (err instanceof WorkbenchValidationError) return badRequest(res, err);
  serverError(res, scope, err);
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

// ═══════════════════════════════════════════════════════════════════════════
// 行层（Sprint B / S2「数据进得来」）
//
// 组织归属仍然只来自 req.workbenchIdentity —— 行端点挂在同一个 router 之下，
// 顶层的 workbenchAuthGuard 自动覆盖，这里一个请求头都不读。
// ═══════════════════════════════════════════════════════════════════════════

// ── 读：表格视图的行列表（含服务端下发的上限，前端据此硬拦，不自己写 5000）────────
//   本刀加 filter/sort 两个可选查询参数：JSONB 路径查询 + field_id 白名单映射。
//   不传参数时逐字等于 Sprint B 的返回（响应体形状一字不改）。
router.get('/tables/:id/rows', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    const out = await listRows(identity.orgId, identity.memberId, req.params.id, {
      filter: req.query.filter,
      sort: req.query.sort,
    });
    if (!out) return notFound(res);
    ok(res, 200, out);
  } catch (err) {
    rowsListError(res, 'listRows', err);
  }
});

// ── 读：行回收站（restorable_until = deleted_at + 30 天，复用表层的保质期常量）──────
router.get('/tables/:id/rows/trash', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    const rows = await listRowTrash(identity.orgId, identity.memberId, req.params.id);
    if (!rows) return notFound(res);
    ok(res, 200, { rows });
  } catch (err) {
    serverError(res, 'listRowTrash', err);
  }
});

// ── 读：单表 JSON 全量导出（数据主权：拿得走，且零他组织数据）────────────────────
router.get('/tables/:id/export', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    const out = await exportTable(identity.orgId, identity.memberId, req.params.id);
    if (!out) return notFound(res);
    ok(res, 200, out);
  } catch (err) {
    serverError(res, 'exportTable', err);
  }
});

// ── 写：新增空行 ─────────────────────────────────────────────────────────────
router.post('/tables/:id/rows', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    // 请求体连读都不读：body 里的 org_id / tenant_id 一律无效，归属永远是会话解析出来的那个
    const row = await createRow(identity.orgId, identity.memberId, req.params.id);
    if (!row) return notFound(res);
    ok(res, 201, row);
  } catch (err) {
    rowError(res, 'createRow', err);
  }
});

// ── 写：行内改格（增量补丁 + 行级 version 乐观锁）────────────────────────────────
router.patch('/rows/:id', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const row = await patchRow(
      identity.orgId,
      identity.memberId,
      req.params.id,
      body.version,
      body.data
    );
    if (!row) return notFound(res);
    ok(res, 200, row);
  } catch (err) {
    rowError(res, 'patchRow', err);
  }
});

// ── 写：删行（软删，物理行一条不少）──────────────────────────────────────────
router.delete('/rows/:id', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    const out = await softDeleteRow(identity.orgId, identity.memberId, req.params.id);
    if (!out) return notFound(res);
    ok(res, 200, out);
  } catch (err) {
    serverError(res, 'softDeleteRow', err);
  }
});

// ── 写：从行回收站还原（data 逐字回归，version 不变）─────────────────────────────
router.post('/rows/:id/restore', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    const row = await restoreRow(identity.orgId, identity.memberId, req.params.id);
    if (!row) return notFound(res);
    ok(res, 200, row);
  } catch (err) {
    serverError(res, 'restoreRow', err);
  }
});

// ── 写：粘贴批量导入（未匹配列自动建文本字段；超上限整批拒绝）──────────────────────
router.post('/tables/:id/rows/paste', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const out = await pasteRows(
      identity.orgId,
      identity.memberId,
      req.params.id,
      body.header,
      body.rows
    );
    if (!out) return notFound(res);
    ok(res, 201, out);
  } catch (err) {
    rowError(res, 'pasteRows', err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 视图层（Sprint C / S3「视图切得开」）
//
// 视图 = db_view_prefs 的一行（controller C1，零新增 migration）。组织归属仍只来自
// req.workbenchIdentity —— 请求体里的 org_id / member_id / tenant_id 连读都不读。
// ═══════════════════════════════════════════════════════════════════════════

// ── 读：本人在该表的视图列表（纯读，零写入副作用）──────────────────────────────
router.get('/tables/:id/views', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    const out = await listViews(identity.orgId, identity.memberId, req.params.id);
    if (!out) return notFound(res);
    ok(res, 200, out);
  } catch (err) {
    serverError(res, 'listViews', err);
  }
});

// ── 写：建视图 ───────────────────────────────────────────────────────────────
router.post('/tables/:id/views', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const view = await createView(identity.orgId, identity.memberId, req.params.id, body);
    if (!view) return notFound(res);
    ok(res, 201, view);
  } catch (err) {
    viewError(res, 'createView', err);
  }
});

// ── 写：改视图（增量补丁语义）────────────────────────────────────────────────
router.patch('/views/:id', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const view = await patchView(identity.orgId, identity.memberId, req.params.id, body);
    if (!view) return notFound(res);
    ok(res, 200, view);
  } catch (err) {
    viewError(res, 'patchView', err);
  }
});

// ── 写：删视图（只删偏好，至少保留一个）──────────────────────────────────────
router.delete('/views/:id', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    const out = await deleteView(identity.orgId, identity.memberId, req.params.id);
    if (!out) return notFound(res);
    ok(res, 200, out);
  } catch (err) {
    viewError(res, 'deleteView', err);
  }
});

// ── 读：「指派给我」全局视图（人员字段的归集出口）─────────────────────────────
router.get('/assigned-to-me', async (req: Request, res: Response) => {
  const identity = req.workbenchIdentity!;
  try {
    ok(res, 200, await assignedToMe(identity.orgId, identity.memberId));
  } catch (err) {
    serverError(res, 'assignedToMe', err);
  }
});

export default router;
export { router as workbenchRouter };
