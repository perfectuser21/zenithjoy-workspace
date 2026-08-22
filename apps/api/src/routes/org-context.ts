/**
 * 组织上下文路由 —— 多组织切换第一刀（挂在 /api/knowledge/org，身份只来自服务端会话）
 *
 * 两个 session-only 端点（org 归属只来自 better-auth 会话 + tenant_members 真查，绝不读请求头/体）：
 *   GET  /api/knowledge/org         列出本人全部归属企业 + 当前 active_org + 是否需先选
 *   POST /api/knowledge/org/switch  切换当前企业（校验目标 ∈ 成员集合，原子写会话 active_org）
 *
 * 为什么单独挂 /api/knowledge/org 而不挂进 /api/knowledge/db：路③ workbenchRouter 在
 * /api/knowledge/db 上有一道 blanket `router.use(workbenchAuthGuard)`，会对该前缀下**任意**子路径
 * 先跑一遍 —— 员工归属 ≥2 家未选时它 409 ORG_SELECTION_REQUIRED 把「看企业列表」「选企业」本身也挡死，
 * 员工就永远选不出来。分开挂载让这两个端点在未选态下可用，且不动路③ 的 A2 扫描域推导
 * （workbench 仍是唯一 /api/knowledge/db 挂载点，闭包不被挤出）。
 *
 * A10：本文件只读会话、绝不出现 X-Org-Id / req.body.org_id 类身份头/体维度
 * （org-context-switch-smoke.sh --a10-only 显式把本文件纳入扫描域守卫）。
 */
import { Router, type Request, type Response } from 'express';
import pool from '../db/connection';
import {
  resolveSessionContext,
  queryMemberOrgIds,
  setSessionActiveOrg,
  auditOrgEvent,
} from '../middleware/active-org';

export const orgContextRouter = Router();

function envelope(data: unknown) {
  return { success: true, data, timestamp: new Date().toISOString() };
}
function errorBody(code: string, message: string) {
  return { success: false, data: null, error: { code, message }, timestamp: new Date().toISOString() };
}

interface OrgRow {
  org_id: string;
  name: string;
  role: string;
}

/** 本人全部归属企业（带企业名 + 角色），DISTINCT，不加 LIMIT。 */
async function listMemberOrgs(memberId: string): Promise<OrgRow[]> {
  const { rows } = await pool.query<OrgRow>(
    `SELECT DISTINCT tm.tenant_id::text AS org_id, t.name AS name, tm.role AS role
       FROM zenithjoy.tenant_members tm
       JOIN zenithjoy.tenants t ON t.id = tm.tenant_id
      WHERE tm.feishu_user_id = $1
      ORDER BY t.name`,
    [memberId]
  );
  return rows;
}

/**
 * GET /orgs —— 列出本人归属企业 + 当前 active_org + 是否需先选。
 * 归属 0 家 → 403 NO_TENANT；≥1 家 → 200。单企业透明（active_org_id 直接=那一家）。
 */
orgContextRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const ctx = await resolveSessionContext(req);
  if (!ctx) {
    res.status(401).json(errorBody('SESSION_REQUIRED', '登录已失效，请重新登录'));
    return;
  }

  let orgs: OrgRow[];
  try {
    orgs = await listMemberOrgs(ctx.memberId);
  } catch (err) {
    console.error('[org-context] tenant_members 查询失败:', (err as Error).message);
    res.status(503).json(errorBody('LEDGER_UNREACHABLE', '账本暂时不可达'));
    return;
  }

  if (orgs.length === 0) {
    res.status(403).json(errorBody('NO_TENANT', '没有权限'));
    return;
  }

  const orgIds = orgs.map((o) => o.org_id);
  // 单企业透明：当前企业直接=那一家（前端不弹选择器，A8 零回归）。
  // 多企业：active_org 必须 ∈ 集合才算"已选"，否则 null（含伪造/被移出的清空态）。
  let activeOrgId: string | null;
  let needsSelection: boolean;
  if (orgIds.length === 1) {
    activeOrgId = orgIds[0];
    needsSelection = false;
  } else {
    activeOrgId = ctx.activeOrg && orgIds.includes(ctx.activeOrg) ? ctx.activeOrg : null;
    needsSelection = activeOrgId === null;
  }

  res.json(envelope({ orgs, active_org_id: activeOrgId, needs_selection: needsSelection }));
});

/**
 * POST /switch-org { org_id } —— 切换当前企业。
 * 目标 ∈ 成员集合 → 原子写会话 active_org（旧企业数据下一请求即不可见）+ switch 审计；
 * 目标 ∉ 集合（伪造）→ 403 ORG_FORBIDDEN + deny 审计，绝不切换。
 */
orgContextRouter.post('/switch', async (req: Request, res: Response): Promise<void> => {
  const ctx = await resolveSessionContext(req);
  if (!ctx) {
    res.status(401).json(errorBody('SESSION_REQUIRED', '登录已失效，请重新登录'));
    return;
  }
  if (!ctx.sessionToken) {
    res.status(401).json(errorBody('SESSION_REQUIRED', '会话异常，请重新登录'));
    return;
  }

  const target = typeof req.body?.org_id === 'string' ? req.body.org_id.trim() : '';
  if (!target) {
    res.status(400).json(errorBody('VALIDATION_FAILED', '缺少 org_id'));
    return;
  }

  let orgIds: string[];
  try {
    orgIds = await queryMemberOrgIds(ctx.memberId);
  } catch (err) {
    console.error('[org-context] tenant_members 查询失败:', (err as Error).message);
    res.status(503).json(errorBody('LEDGER_UNREACHABLE', '账本暂时不可达'));
    return;
  }

  if (!orgIds.includes(target)) {
    // 越权：切到不归属的企业 → 拒绝不默认 + deny 审计（A11 取证链）。
    await auditOrgEvent('resolve_deny', ctx.memberId, target, `switch-org 目标 ${target} 不在成员集合`);
    res.status(403).json(errorBody('ORG_FORBIDDEN', '当前企业不可用，请重新选择'));
    return;
  }

  try {
    await setSessionActiveOrg(ctx.sessionToken, target);
  } catch (err) {
    console.error('[org-context] 写 active_org 失败:', (err as Error).message);
    res.status(503).json(errorBody('SWITCH_FAILED', '切换失败，仍在原企业'));
    return;
  }
  await auditOrgEvent('switch', ctx.memberId, target, `switch-org 切换到 ${target}`);
  res.json(envelope({ active_org_id: target }));
});
