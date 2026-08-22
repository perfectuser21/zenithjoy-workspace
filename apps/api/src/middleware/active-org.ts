/**
 * active-org —— 多组织切换的服务端会话态解析核心（命门①② 共用）
 *
 * 这是「组织与权限底座」的震中：一旦「当前选中企业」这一跳可伪造或错判，一个企业员工
 * 就能读写另一企业的真实经营数据——不可逆的跨企业数据泄露。因此本模块的所有解析：
 *   - 组织归属**只**来自服务端会话态 active_org（better-auth session 附加字段，J7），
 *     **绝不**取自请求头 / 请求体（引入 X-Org-Id 类维度当场触 A2/A10 静态守卫报红）；
 *   - 成员集合**每请求**对 LIVE 的 tenant_members 真查（A7），禁登录时一次性快照；
 *   - active_org 缺失（≥2 家未选）或伪造（∉ 成员集合）一律 fail-closed 拦下，绝不静默取一个、绝不默认。
 *
 * 单企业账号透明解析、忽略 active_org（A8 零回归——绝不给现网单企业用户强加选择步骤）。
 *
 * knowledge-auth（路①）与 workbench-auth（路③）两闸共用本模块，四态语义与文案逐字统一，
 * 前端 knowledgeFetch 解析器两路共用，形状分叉就要改前端。
 */
import type { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { Pool } from 'pg';
import pool from '../db/connection';
import { auth } from '../auth';

export interface SessionContext {
  /** better-auth user.id —— 飞书登录通道下即该员工的 open_id */
  memberId: string;
  /** 会话里选中的当前企业；未选 / 无效清空后为 null */
  activeOrg: string | null;
  /** 原始 session token，用于切换 / 清空 active_org（切换端点与 A7 清空用） */
  sessionToken: string | null;
}

/** 会话 → {memberId, activeOrg, token}。cookie 缺失/失效/解析异常一律当没登录，绝不回落到其它来源。 */
export async function resolveSessionContext(req: Request): Promise<SessionContext | null> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const id = session?.user?.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const s = (session as { session?: { activeOrg?: unknown; token?: unknown } })?.session ?? {};
    const activeOrg = typeof s.activeOrg === 'string' && s.activeOrg.length > 0 ? s.activeOrg : null;
    const sessionToken = typeof s.token === 'string' && s.token.length > 0 ? s.token : null;
    return { memberId: id, activeOrg, sessionToken };
  } catch {
    return null;
  }
}

export type OrgBlockCode = 'NO_TENANT' | 'ORG_SELECTION_REQUIRED' | 'ORG_FORBIDDEN';

export type OrgResolution =
  | { ok: true; orgId: string }
  | { ok: false; status: number; code: OrgBlockCode; message: string };

export const ORG_MESSAGES: Record<OrgBlockCode, string> = {
  NO_TENANT: '没有权限',
  ORG_SELECTION_REQUIRED: '请先选择当前企业',
  ORG_FORBIDDEN: '当前企业不可用，请重新选择',
};

/**
 * 纯函数：给定 LIVE 成员归属集合 + 会话 active_org → 解析唯一 orgId 或给出拦截态。
 *
 *   0 家                          → 403 NO_TENANT
 *   active_org 已设 且 ∈ 集合      → 解析为 active_org
 *   active_org 已设 但 ∉ 集合      → 403 ORG_FORBIDDEN（伪造 / 成员从选中企业被移出，须清 active_org + deny 审计）
 *   active_org 未设(null) 且 1 家   → 透明解析（A8 零回归——单企业账号不弹选择器）
 *   active_org 未设(null) 且 ≥2 家  → 409 ORG_SELECTION_REQUIRED（停下要求先选，绝不自动挑）
 *
 * 注意 active_org 有效性**先于**"单企业透明"判：dave 归属 {A,B}、active_org=A，A 归属行被删后
 * 集合缩成 {B}——此时 active_org=A ∉ {B}，必须 ORG_FORBIDDEN 当次挡并清（A7），
 * 绝不能因"现在只剩一家"就透明落到 B（那等于成员被移出当前企业却无感地换了家）。
 */
export function resolveActiveOrg(memberOrgIds: string[], activeOrg: string | null): OrgResolution {
  const set = new Set(memberOrgIds);
  if (set.size === 0) {
    return { ok: false, status: 403, code: 'NO_TENANT', message: ORG_MESSAGES.NO_TENANT };
  }
  if (activeOrg !== null) {
    if (set.has(activeOrg)) {
      return { ok: true, orgId: activeOrg };
    }
    return { ok: false, status: 403, code: 'ORG_FORBIDDEN', message: ORG_MESSAGES.ORG_FORBIDDEN };
  }
  // active_org 未设
  if (set.size === 1) {
    return { ok: true, orgId: [...set][0] };
  }
  return {
    ok: false,
    status: 409,
    code: 'ORG_SELECTION_REQUIRED',
    message: ORG_MESSAGES.ORG_SELECTION_REQUIRED,
  };
}

/**
 * LIVE 成员归属集合真查（DISTINCT，**不加 LIMIT**——多组织必须看得见才拦得住，
 * 取第一条等于把配置事故变成静默的跨企业事故）。每请求都调，实现 A7 的实时重校。
 */
export async function queryMemberOrgIds(memberId: string, db: Pool = pool): Promise<string[]> {
  const { rows } = await db.query<{ tenant_id: string }>(
    'SELECT DISTINCT tenant_id::text AS tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id = $1',
    [memberId]
  );
  return rows.map((r) => r.tenant_id);
}

/**
 * 会话 active_org 写入（切换 / 清空）。绝不信请求体：调用方（switch-org 端点）已校验
 * orgId ∈ 该成员成员集合；A7 清空传 null。session 表在 public schema（better-auth 默认）。
 */
export async function setSessionActiveOrg(
  token: string,
  orgId: string | null,
  db: Pool = pool
): Promise<void> {
  await db.query('UPDATE public.session SET "activeOrg" = $1, "updatedAt" = now() WHERE token = $2', [
    orgId,
    token,
  ]);
}

/**
 * org 审计（A11 中间件自动副作用）：切换 / 越权 deny 各落一条，作为不可抵赖的取证链。
 * 审计写失败只打红日志、绝不反过来打断主链路（否则审计表故障=全站拒绝服务）。
 */
export async function auditOrgEvent(
  event: 'switch' | 'resolve_deny',
  memberId: string,
  orgId: string | null,
  detail: string,
  db: Pool = pool
): Promise<void> {
  try {
    await db.query(
      'INSERT INTO zenithjoy.org_audit (member_id, event, org_id, detail) VALUES ($1, $2, $3, $4)',
      [memberId, event, orgId, detail]
    );
  } catch (err) {
    console.error('[org-audit] 审计写入失败:', (err as Error).message);
  }
}
