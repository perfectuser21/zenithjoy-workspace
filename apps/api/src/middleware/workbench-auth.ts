/**
 * workbenchAuthGuard — 路③ 结构化工作台的鉴权闸，身份与组织归属**只**来自服务端会话
 *
 * 这是整条 GP 的命门（合同 G0）。路③ 的表里装的是各家企业的经营数据，判据一旦可伪造，
 * 跨企业隔离与表级可见性会同时失效。因此本闸**不读任何请求头**：会话从 better-auth 解析，
 * 组织归属再从 zenithjoy.tenant_members 真查。请求体里的 org_id 一律不看。
 *
 * 与路① knowledgeAuthGuard 的关系：本闸是它的泛化版，三态语义与文案逐字沿用
 * （前端 knowledgeFetch 的解析器两路共用，形状分叉就要改前端）。**只在一处更严**：
 * 归属判定从"按 created_at 取第一条"改成"多组织即 fail-closed"——用一列时间戳的偶然顺序
 * 决定一条经营数据归谁，错了没有任何信号，那是最坏的一种错误形态。
 *
 * A2 静态守卫扫描本文件与路③ 全部路由/service：源码里一旦出现身份头名字面量即报红。
 * 加"没有会话就回落读头"这种兼容代码 = 亲手把命门打开，任何理由都不成立。
 *
 * 判定态（多组织切换第一刀：受控反转 rows>1 的第四态，其余护栏一行不改；文案两两不同，前端据此分文案）：
 *   401 SESSION_REQUIRED        无有效会话
 *   403 NO_TENANT               有会话但成员表无归属行
 *   409 ORG_SELECTION_REQUIRED  归属 ≥2 家但未选当前企业（停下要求先选，绝不静默挑一个）
 *   403 ORG_FORBIDDEN           active_org 不在成员集合（伪造 / 会话有效期内被移出，当次挡并清 active_org + deny 审计）
 *   503 LEDGER_UNREACHABLE      成员行查询本身失败（不静默降级成"没权限"）
 *   解析成功                     req.workbenchIdentity = { memberId, orgId }（1 家透明 / ≥2 家取选中）
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
export const LEDGER_UNREACHABLE_MESSAGE = '账本暂时不可达，未写入';

export interface WorkbenchIdentity {
  /** better-auth user.id —— 飞书登录通道下即该员工的 open_id */
  memberId: string;
  /** 该成员在 tenant_members 里的组织归属。建表/读表一律用它，绝不取自请求体。 */
  orgId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    workbenchIdentity?: WorkbenchIdentity;
  }
}

export function workbenchErrorBody(code: string, message: string): Record<string, unknown> {
  return { success: false, data: null, error: { code, message }, timestamp: new Date().toISOString() };
}

/**
 * 反枚举专用的 404 体：**不带 timestamp**。
 *
 * 合同 Invariant ③ 要求「跨组织不可达与不存在逐字节同形 404」——若带上当前时刻，
 * 两次响应的字节就不同了，攻击者拿两个 id 各打一次、比对响应即可分辨哪个 id 真实存在，
 * 反枚举当场失效（这正是 DoD A8 用 md5 全等来钉的那一条）。其余错误码照常带 timestamp。
 */
export function notFoundBody(): Record<string, unknown> {
  return { success: false, data: null, error: { code: 'NOT_FOUND', message: '表不存在或无权访问' } };
}

export async function workbenchAuthGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ctx = await resolveSessionContext(req);
  if (!ctx) {
    res.status(401).json(workbenchErrorBody('SESSION_REQUIRED', SESSION_REQUIRED_MESSAGE));
    return;
  }

  let orgIds: string[];
  try {
    // LIVE 成员集合每请求真查（A7），不加 LIMIT：多组织必须看得见才拦得住。
    orgIds = await queryMemberOrgIds(ctx.memberId);
  } catch (err) {
    // 查不动成员表 ≠ 没权限。吞成 403 会把网络/配置故障当成权限问题，排查方向直接跑偏。
    console.error('[workbench-auth] tenant_members 查询失败:', (err as Error).message);
    res.status(503).json(workbenchErrorBody('LEDGER_UNREACHABLE', LEDGER_UNREACHABLE_MESSAGE));
    return;
  }

  const resolution = resolveActiveOrg(orgIds, ctx.activeOrg);
  if (!resolution.ok) {
    if (resolution.code === 'ORG_FORBIDDEN') {
      // A7：active_org 已不在成员集合（伪造 / 被移出）→ 当次挡并清 active_org；A11：deny 审计。
      if (ctx.sessionToken) await setSessionActiveOrg(ctx.sessionToken, null);
      await auditOrgEvent(
        'resolve_deny',
        ctx.memberId,
        ctx.activeOrg,
        `workbench active_org=${ctx.activeOrg} 不在成员集合`
      );
    }
    res.status(resolution.status).json(workbenchErrorBody(resolution.code, resolution.message));
    return;
  }

  req.workbenchIdentity = { memberId: ctx.memberId, orgId: resolution.orgId };
  next();
}
