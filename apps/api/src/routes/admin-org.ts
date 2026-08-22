/**
 * 管理员组织供给 —— 多组织切换第一刀（J8：本刀多组织成员行限定 admin/手动供给）
 *
 * POST /api/admin/org/grant { feishu_user_id, org_id } —— 给某员工补一条 tenant_members 归属行。
 *
 * 为什么单独成一个 admin 路由、不挂在 /api/knowledge/db 之下：admin 供给走 super-admin 鉴权
 * （身份头白名单 / 内部 token），而 super-admin 中间件必然出现身份头字面量；若挂进路③ 前缀会被
 * A2/A10 静态守卫扫到而报红。org 供给是「管理员显式动作」，不属于「员工会话态 org 解析」那一层，
 * 分开挂载既符合职责、也不污染路③ 命门守卫的扫描域。
 *
 * 一般员工经 feishu-login 自动多行供给不在本刀（J8/P2-6）：本端点只覆盖 admin/手动补行
 * （含 Gate 0 给主理人补第二条归属行）。
 */
import { Router, type Request, type Response } from 'express';
import pool from '../db/connection';
import { superAdminGuard } from '../middleware/super-admin';

export const adminOrgRouter = Router();

adminOrgRouter.use(superAdminGuard);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /grant —— 幂等补一条成员行（ON CONFLICT DO NOTHING）。
 * org_id 必须是 zenithjoy.tenants 里真实存在的 uuid，否则 400（不给不存在的企业塞人）。
 */
adminOrgRouter.post('/grant', async (req: Request, res: Response): Promise<void> => {
  const memberId = typeof req.body?.feishu_user_id === 'string' ? req.body.feishu_user_id.trim() : '';
  const orgId = typeof req.body?.org_id === 'string' ? req.body.org_id.trim() : '';
  const role = typeof req.body?.role === 'string' && req.body.role.trim() ? req.body.role.trim() : 'member';

  if (!memberId || !orgId || !UUID_RE.test(orgId)) {
    res.status(400).json({
      success: false,
      data: null,
      error: { code: 'VALIDATION_FAILED', message: '缺少 feishu_user_id 或 org_id 非法' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    const t = await pool.query('SELECT 1 FROM zenithjoy.tenants WHERE id = $1::uuid', [orgId]);
    if (t.rows.length === 0) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: 'ORG_NOT_FOUND', message: '目标企业不存在' },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    await pool.query(
      `INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
       VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING`,
      [orgId, memberId, role]
    );
    res.json({
      success: true,
      data: { feishu_user_id: memberId, org_id: orgId, role },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin-org] 供给失败:', (err as Error).message);
    res.status(503).json({
      success: false,
      data: null,
      error: { code: 'LEDGER_UNREACHABLE', message: '账本暂时不可达' },
      timestamp: new Date().toISOString(),
    });
  }
});
