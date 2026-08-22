/**
 * 员工目录 — 分组 env 声明 + A30 启动一致性自检
 *
 * 员工目录用三组 env 显式声明「谁是员工」和「他属于哪家企业」：
 *   STAFF_EMAILS / STAFF_FEISHU_OPENIDS            扁平白名单（staffGuard 沿用的历史口径，不动）
 *   STAFF_EMAILS__<ORG> / STAFF_FEISHU_OPENIDS__<ORG>  按企业分组的显式声明
 *   STAFF_ORG_MAP = "ORGA:<uuid>,ORGB:<uuid>"      企业 key → zenithjoy.tenants.id
 *
 * 归属**只能**来自分组声明，绝不按邮箱域名后缀或任何模糊匹配推断；一个员工没有分组声明
 * 就是没有归属，登录直接 403 NO_ORG_ASSIGNMENT，不给默认组织兜底。
 *
 * A30 四项一致性自检在进程启动时跑，任一项不成立 → 进程非 0 退出（fail-closed）。
 * 之所以要 fail-closed 而不是"跑起来再说"：归属声明写错的两种后果都是静默的——
 * 员工被判进错误企业就能看到另一家的经验，被声明在两家则归属不唯一、跨企业隔离断言
 * 反而更容易变绿。配置错误必须在启动期就把服务拦住，而不是等泄漏发生。
 */

/** 只依赖 query 方法，pg.Client 与 pg.Pool 都满足 */
export interface StaffDirectoryQueryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type StaffDirectoryEnv = Record<string, string | undefined>;

export interface StaffDirectoryCheckResult {
  ok: boolean;
  violations: string[];
}

export interface StaffOrgAssignment {
  orgKey: string;
  tenantId: string;
}

/**
 * A30 检查项名，启动日志逐项打印，变异时用于定位违规项。
 *
 * 【多组织切换第一刀·Gate 0 四处同刀】A30-2「归属唯一」已退役：一个员工归属 ≥2 家企业
 * 从非法反转为合法，同一身份出现在多个分组不再是违规。剩三项（扁平↔主企业等价 / 分组并集覆盖
 * 扁平 / STAFF_ORG_MAP uuid 真实存在）仍生效，它们与「多组织合法」不冲突。
 */
export const A30_CHECKS = ['A30-1a', 'A30-1b', 'A30-3'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normEmail(s: string): string {
  return s.trim().toLowerCase();
}

/** 扁平白名单（emails 小写化后与 openids 合成一个身份集合） */
export function parseFlatDirectory(env: StaffDirectoryEnv): Set<string> {
  const out = new Set<string>();
  for (const e of splitList(env.STAFF_EMAILS)) out.add(normEmail(e));
  for (const o of splitList(env.STAFF_FEISHU_OPENIDS)) out.add(o);
  return out;
}

/**
 * 分组声明：ORG key（大写）→ 该组的身份集合（emails 小写 + openids）。
 * 只认 `STAFF_EMAILS__<ORG>` / `STAFF_FEISHU_OPENIDS__<ORG>` 两个前缀。
 */
export function parseOrgGroups(env: StaffDirectoryEnv): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  const add = (org: string, member: string) => {
    const key = org.toUpperCase();
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key)!.add(member);
  };
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string') continue;
    const emailMatch = /^STAFF_EMAILS__(.+)$/.exec(k);
    if (emailMatch) {
      for (const e of splitList(v)) add(emailMatch[1], normEmail(e));
      continue;
    }
    const openIdMatch = /^STAFF_FEISHU_OPENIDS__(.+)$/.exec(k);
    if (openIdMatch) {
      for (const o of splitList(v)) add(openIdMatch[1], o);
    }
  }
  return groups;
}

/** STAFF_ORG_MAP = "ORGA:<uuid>,ORGB:<uuid>" → Map<ORG(大写), uuid> */
export function parseOrgMap(env: StaffDirectoryEnv): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of splitList(env.STAFF_ORG_MAP)) {
    const idx = pair.indexOf(':');
    if (idx <= 0) continue;
    const org = pair.slice(0, idx).trim().toUpperCase();
    const uuid = pair.slice(idx + 1).trim();
    if (org && uuid) map.set(org, uuid);
  }
  return map;
}

/**
 * 「企业A」= 扁平白名单对应的那一家。扁平名单是 staffGuard 的历史单企业口径，
 * 因此它必须与且只与主企业那一组逐字相等（A30-1a）。
 * 主企业取 STAFF_PRIMARY_ORG，缺省取 STAFF_ORG_MAP 的第一个 key。
 */
export function resolvePrimaryOrg(env: StaffDirectoryEnv): string | null {
  const explicit = env.STAFF_PRIMARY_ORG?.trim();
  if (explicit) return explicit.toUpperCase();
  const first = parseOrgMap(env).keys().next();
  if (!first.done) return first.value;
  const firstGroup = parseOrgGroups(env).keys().next();
  return firstGroup.done ? null : firstGroup.value;
}

/**
 * 员工目录到底配没配。
 *
 * 存量部署只有扁平白名单（STAFF_EMAILS / STAFF_FEISHU_OPENIDS），一个分组声明都没有。
 * 对它们，「知识中枢」这个功能根本没开：A30 不该报红（否则 apps/api 直接起不来，
 * 整个 Staff Hub 连同既有 16 个端点一起躺下），登录也不该要求归属声明
 * （否则全体员工登不进去）。
 *
 * 这不是"默认组织兜底"——没配目录时谁都拿不到 org，知识端点一律没有会话可用，
 * 依然是 fail-closed；只有真的声明了目录，四项自检和归属要求才全部生效。
 */
export function isDirectoryConfigured(env: StaffDirectoryEnv): boolean {
  return parseOrgGroups(env).size > 0 || parseOrgMap(env).size > 0;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * A30 员工目录一致性自检（四项）。
 *
 *   A30-1a  扁平名单 == 主企业那一组（分组里多一个不在扁平里的人 → 红）
 *   A30-1b  分组并集 ⊇ 扁平名单（扁平里多一个不在任何分组里的人 → 红）
 *   A30-3   STAFF_ORG_MAP 里每个 uuid 在 zenithjoy.tenants 中真实存在
 *
 *   （A30-2 归属唯一已退役：多组织切换第一刀反转「一人多企业」为合法，同一身份出现在多个分组不再报红）
 *
 * violations 里放的是检查项名本身，调用方直接打进启动日志即可定位。
 */
export async function checkStaffDirectory(
  env: StaffDirectoryEnv,
  db: StaffDirectoryQueryable
): Promise<StaffDirectoryCheckResult> {
  const violations: string[] = [];

  // 没声明任何分组/映射 = 知识中枢未启用，四项无从谈起（见 isDirectoryConfigured）
  if (!isDirectoryConfigured(env)) return { ok: true, violations };

  const flat = parseFlatDirectory(env);
  const groups = parseOrgGroups(env);
  const orgMap = parseOrgMap(env);
  const primaryOrg = resolvePrimaryOrg(env);

  // A30-1a：扁平名单必须与主企业那一组逐字相等
  const primaryGroup = primaryOrg ? (groups.get(primaryOrg) ?? new Set<string>()) : new Set<string>();
  if (!sameSet(flat, primaryGroup)) violations.push('A30-1a');

  // A30-1b：分组并集必须覆盖扁平名单（扁平里有人没被任何企业声明 → 归属未知）
  const union = new Set<string>();
  for (const members of groups.values()) for (const m of members) union.add(m);
  for (const id of flat) {
    if (!union.has(id)) {
      violations.push('A30-1b');
      break;
    }
  }

  // A30-2 归属唯一已退役（多组织切换第一刀）：同一身份出现在多个分组 = 合法的多组织归属，不再报红。

  // A30-3：STAFF_ORG_MAP 的 uuid 必须在 tenants 中真实存在（真查 PG，不查格式了事）
  const uuids = [...orgMap.values()];
  const malformed = uuids.filter((u) => !UUID_RE.test(u));
  const wellFormed = uuids.filter((u) => UUID_RE.test(u));
  let missing: string[] = [];
  if (wellFormed.length > 0) {
    const res = await db.query('SELECT id::text AS id FROM zenithjoy.tenants WHERE id = ANY($1::uuid[])', [
      wellFormed,
    ]);
    const found = new Set(res.rows.map((r) => String(r.id)));
    missing = wellFormed.filter((u) => !found.has(u));
  }
  if (malformed.length > 0 || missing.length > 0) violations.push('A30-3');

  return { ok: violations.length === 0, violations };
}

/**
 * 该员工被声明在哪家企业。只看分组声明 + STAFF_ORG_MAP，两者缺一即无归属。
 * 返回 null = 无归属声明，调用方必须 403 NO_ORG_ASSIGNMENT，禁止默认组织兜底。
 */
export function resolveStaffOrg(
  env: StaffDirectoryEnv,
  openId: string,
  email: string
): StaffOrgAssignment | null {
  const groups = parseOrgGroups(env);
  const orgMap = parseOrgMap(env);
  const id = openId.trim();
  const mail = normEmail(email ?? '');

  for (const [org, members] of groups) {
    const hit = (id !== '' && members.has(id)) || (mail !== '' && members.has(mail));
    if (!hit) continue;
    const tenantId = orgMap.get(org);
    if (!tenantId || !UUID_RE.test(tenantId)) return null;
    return { orgKey: org, tenantId };
  }
  return null;
}

/** 扁平白名单命中判定 —— 与 staffGuard 同口径 */
export function isStaffWhitelisted(env: StaffDirectoryEnv, openId: string, email: string): boolean {
  const flat = parseFlatDirectory(env);
  const mail = normEmail(email ?? '');
  return (openId.trim() !== '' && flat.has(openId.trim())) || (mail !== '' && flat.has(mail));
}

/**
 * 这个人在员工目录里被声明过吗（扁平名单 **或** 任一企业分组）。
 *
 * 登录判「是不是员工」必须用这个而不是扁平名单：A30-1a 要求扁平名单恰好等于主企业那一组，
 * 于是非主企业的员工按定义永远不在扁平名单里——只看扁平名单的话，企业B 的人一个都登不进来。
 * 扁平名单是 staffGuard 保护既有 16 个端点的历史口径，不是员工全集。
 */
export function isStaffDeclared(env: StaffDirectoryEnv, openId: string, email: string): boolean {
  if (isStaffWhitelisted(env, openId, email)) return true;
  const id = openId.trim();
  const mail = normEmail(email ?? '');
  for (const members of parseOrgGroups(env).values()) {
    if ((id !== '' && members.has(id)) || (mail !== '' && members.has(mail))) return true;
  }
  return false;
}

/**
 * 启动期自检：逐项打印检查结果，任一项不成立即 throw。
 * 日志格式被 smoke / E2E 的断言依赖（"A30 staff-directory selfcheck passed" + 四个检查项名），
 * 改文案前先看 .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh。
 */
export async function assertStaffDirectoryOnStartup(
  env: StaffDirectoryEnv,
  db: StaffDirectoryQueryable
): Promise<void> {
  if (!isDirectoryConfigured(env)) {
    console.log('A30 staff-directory selfcheck skipped —— 员工目录未配置，知识中枢未启用');
    return;
  }

  const { ok, violations } = await checkStaffDirectory(env, db);
  for (const check of A30_CHECKS) {
    const bad = violations.includes(check);
    const line = `[staff-directory] ${check} ${bad ? 'VIOLATED' : 'ok'}`;
    if (bad) console.error(line);
    else console.log(line);
  }
  if (!ok) {
    throw new Error(`A30 staff-directory selfcheck failed: ${violations.join(',')}`);
  }
  console.log('A30 staff-directory selfcheck passed');
}
