/**
 * knowledgeAuthGuard — 知识中枢端点的鉴权闸，身份**只**来自服务端会话
 *
 * 与 staffGuard 的根本区别：staffGuard 的判据是前端自填的明文身份头，改一个头就能换一个人；
 * 知识中枢承载跨企业的经验正文，判据一旦可伪造，跨企业隔离与授权分级会同时失效。
 * 因此本闸**不读任何请求头**——身份从 better-auth 会话解析（与 tenant-context.ts 同一先例），
 * 组织归属再从 zenithjoy.tenant_members 真查。
 *
 * A27 静态守卫扫描本文件与 routes/knowledge.ts：源码里一旦出现身份头名字面量即报红。
 * 这是唯一能防住实现期回退的机械闸——人会忘记补负向测试，但源码里出现那两个名字会直接报红。
 * 加"回落读头"这种兼容代码 = 亲手把命门打开，任何理由都不成立。
 *
 * 判定三态（文案两两不同，前端据此区分「重新登录」和「找管理员」）：
 *   401 SESSION_REQUIRED  无有效会话
 *   403 NO_TENANT         有会话但 tenant_members 无成员行
 *   503 LEDGER_UNREACHABLE 成员行查询本身失败（不静默降级成"没权限"）
 */
import type { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import pool from '../db/connection';
import { auth } from '../auth';

export const SESSION_REQUIRED_MESSAGE = '登录已失效，请重新登录';
export const NO_TENANT_MESSAGE = '没有权限';

export interface KnowledgeIdentity {
  /** better-auth user.id —— 飞书登录通道下即该员工的 open_id（见 routes/staff.ts 会话签发） */
  memberId: string;
  /** 该成员在 tenant_members 里的组织归属，录入与读端一律用它，绝不取自请求体 */
  orgId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    knowledgeIdentity?: KnowledgeIdentity;
  }
}

function errorBody(code: string, message: string) {
  return { success: false, data: null, error: { code, message }, timestamp: new Date().toISOString() };
}

/** 会话 → memberId。cookie 缺失/失效/解析异常一律当没登录，绝不回落到其它来源。 */
async function resolveSessionMemberId(req: Request): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const id = session?.user?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export async function knowledgeAuthGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const memberId = await resolveSessionMemberId(req);
  if (!memberId) {
    res.status(401).json(errorBody('SESSION_REQUIRED', SESSION_REQUIRED_MESSAGE));
    return;
  }

  let rows: Array<{ tenant_id: string }>;
  try {
    const result = await pool.query(
      'SELECT tenant_id::text AS tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id = $1 ORDER BY created_at LIMIT 1',
      [memberId]
    );
    rows = result.rows as Array<{ tenant_id: string }>;
  } catch (err) {
    // 查不动成员表 ≠ 没权限。回 503 让调用方看到"暂时不可达"，
    // 若在这里吞成 403，配置/网络故障会被当成权限问题，排查方向直接跑偏。
    console.error('[knowledge-auth] tenant_members 查询失败:', (err as Error).message);
    res.status(503).json(errorBody('LEDGER_UNREACHABLE', '账本暂时不可达，未写入'));
    return;
  }

  if (rows.length === 0) {
    res.status(403).json(errorBody('NO_TENANT', NO_TENANT_MESSAGE));
    return;
  }

  req.knowledgeIdentity = { memberId, orgId: rows[0].tenant_id };
  next();
}
