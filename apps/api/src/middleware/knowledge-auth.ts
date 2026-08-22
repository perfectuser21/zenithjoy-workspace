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
 * 判定态（多组织切换第一刀：LIMIT1「静默取最早一条」受控反转为按 active_org 解析；文案两两不同）：
 *   401 SESSION_REQUIRED        无有效会话
 *   403 NO_TENANT               有会话但 tenant_members 无成员行
 *   409 ORG_SELECTION_REQUIRED  归属 ≥2 家但未选当前企业（停下要求先选，绝不静默取最早一条）
 *   403 ORG_FORBIDDEN           active_org 不在成员集合（伪造 / 被移出，当次挡并清 active_org + deny 审计）
 *   503 LEDGER_UNREACHABLE      成员行查询本身失败（不静默降级成"没权限"）
 *   解析成功                     req.knowledgeIdentity = { memberId, orgId }（1 家透明 / ≥2 家取选中）
 */
import type { Request, Response, NextFunction } from 'express';
import {
  resolveSessionContext,
  queryMemberOrgIds,
  resolveActiveOrg,
  setSessionActiveOrg,
  auditOrgEvent,
} from './active-org';

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

export async function knowledgeAuthGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ctx = await resolveSessionContext(req);
  if (!ctx) {
    res.status(401).json(errorBody('SESSION_REQUIRED', SESSION_REQUIRED_MESSAGE));
    return;
  }

  let orgIds: string[];
  try {
    // LIVE 成员集合每请求真查（A7），不加 LIMIT：多组织必须看得见才拦得住，绝不静默取最早一条。
    orgIds = await queryMemberOrgIds(ctx.memberId);
  } catch (err) {
    // 查不动成员表 ≠ 没权限。回 503 让调用方看到"暂时不可达"，
    // 若在这里吞成 403，配置/网络故障会被当成权限问题，排查方向直接跑偏。
    console.error('[knowledge-auth] tenant_members 查询失败:', (err as Error).message);
    res.status(503).json(errorBody('LEDGER_UNREACHABLE', '账本暂时不可达，未写入'));
    return;
  }

  const resolution = resolveActiveOrg(orgIds, ctx.activeOrg);
  if (!resolution.ok) {
    if (resolution.code === 'ORG_FORBIDDEN') {
      if (ctx.sessionToken) await setSessionActiveOrg(ctx.sessionToken, null);
      await auditOrgEvent(
        'resolve_deny',
        ctx.memberId,
        ctx.activeOrg,
        `knowledge active_org=${ctx.activeOrg} 不在成员集合`
      );
    }
    res.status(resolution.status).json(errorBody(resolution.code, resolution.message));
    return;
  }

  req.knowledgeIdentity = { memberId: ctx.memberId, orgId: resolution.orgId };
  next();
}
