/**
 * A12 active_org 维度前置自检 —— fail-closed 启动闸，必须在 listen 之前跑完
 *
 * 【多组织切换第一刀·受控反转】历史上这道闸是「单组织自检」：查到多组织成员就拒绝启动
 * （用一列时间戳偶然顺序决定经营数据归谁是命门级误判）。第一刀把「多组织」从非法反转为合法，
 * 于是这道闸的语义随之反转：
 *
 *   - 多组织成员合法存在（主理人双企业等）本身**不再**是拒绝启动的理由；
 *   - 但多组织合法的前提是「服务端会话态 active_org 维度支撑已部署」——即 better-auth session
 *     表上有 activeOrg 列（20260823 migration）。若库里已有多组织成员行、却还没部署这一维度支撑
 *     （典型：migration 没跑到这台库），apps/api 起来后两闸会退化成「≥2 家无从选企业」，
 *     多组织成员一个数据都读不到——把事故摆在部署那一刻，而不是留到用户登录才发现全站不可用。
 *
 * 双向：维度齐备 + 多组织行 → 正常启动；维度缺失 + 多组织行 → 拒绝启动（A12 双向变异）。
 *
 * **查不动成员表时放行并打告警**（J9 保留 fail-open）：合同只要求「维度缺失时拒绝启动」，
 * 没要求「查不动也退出」；查不动时请求期两闸每次重查会正确返 503，判定并没被绕过；反过来把
 * 「查不动」也当违规会打断既有 release 自包含冒烟（standalone 起进程身边根本没有库）。
 */
import type { Pool } from 'pg';

export const SELFCHECK_PASS_LOG = 'A12 active-org dimension selfcheck passed';
export const SELFCHECK_VIOLATION_TAG = 'A12-DIMENSION-MISSING';
/** 自检没跑成（查不动库）时的日志标签 —— 与违规标签分开，免得排查时把两件事看成一件 */
export const SELFCHECK_UNAVAILABLE_TAG = 'A12-SELFCHECK-UNAVAILABLE';

export class ActiveOrgDimensionError extends Error {}

export interface DimensionCheckOptions {
  /** better-auth session 表所在 schema（默认 public） */
  sessionSchema?: string;
  /** better-auth session 表名（默认 session）——测试用来指向无 activeOrg 列的表验证拒绝启动 */
  sessionTable?: string;
}

/**
 * 查出所有"被声明进多于一家企业"的成员。返回空数组即无多组织成员。
 * 抛错表示查不动（调用方按 J9 fail-open 处理）。
 */
export async function findMultiOrgMembers(
  pool: Pool
): Promise<Array<{ feishu_user_id: string; org_count: number }>> {
  const { rows } = await pool.query(
    `SELECT feishu_user_id, count(DISTINCT tenant_id)::int AS org_count
       FROM zenithjoy.tenant_members
      WHERE feishu_user_id IS NOT NULL AND feishu_user_id <> ''
      GROUP BY feishu_user_id
     HAVING count(DISTINCT tenant_id) > 1
      ORDER BY feishu_user_id`
  );
  return rows as Array<{ feishu_user_id: string; org_count: number }>;
}

/** session 表是否已有 active_org 维度支撑（activeOrg 列）。这是「维度齐备」的可机检信号。 */
export async function hasActiveOrgColumn(
  pool: Pool,
  opts: DimensionCheckOptions = {}
): Promise<boolean> {
  const schema = opts.sessionSchema ?? 'public';
  const table = opts.sessionTable ?? 'session';
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = 'activeOrg'`,
    [schema, table]
  );
  return rows.length > 0;
}

/**
 * 启动闸本体。多组织合法 + 维度齐备 → 打 SELFCHECK_PASS_LOG；多组织存在但维度缺失 →
 * 抛 ActiveOrgDimensionError（消息点名 A12-DIMENSION-MISSING 与冲突的 feishu_user_id，只打 id）。
 *
 * 只验"服务起来了"是假绿：没实现自检时服务照样起。判据必须是自检自己的输出。
 */
export async function assertActiveOrgDimensionReady(
  pool: Pool,
  opts: DimensionCheckOptions = {}
): Promise<void> {
  let multiOrg: Array<{ feishu_user_id: string; org_count: number }>;
  try {
    multiOrg = await findMultiOrgMembers(pool);
  } catch (err) {
    // 查不动 ≠ 违规（J9）。不打 SELFCHECK_PASS_LOG，免得看起来像通过了。
    console.warn(
      `⚠️  [active-org] ${SELFCHECK_UNAVAILABLE_TAG} 自检未能执行：tenant_members 查询失败` +
        `（${(err as Error).message}）—— 放行启动，多组织解析仍由请求期两闸兜底（403/409/503）`
    );
    return;
  }

  if (multiOrg.length === 0) {
    // 没有多组织成员 → 维度是否部署无关紧要，直接通过。
    console.log(`✅ [active-org] ${SELFCHECK_PASS_LOG}（无多组织成员）`);
    return;
  }

  const dimensionReady = await hasActiveOrgColumn(pool, opts);
  if (!dimensionReady) {
    const detail = multiOrg.map((o) => `${o.feishu_user_id}(${o.org_count} 家)`).join(', ');
    throw new ActiveOrgDimensionError(
      `${SELFCHECK_VIOLATION_TAG} 库里已有多组织成员（${detail}），但 session.activeOrg 维度支撑缺失` +
        ' —— 拒绝启动，请先跑 20260823 org_context migration 部署 active_org 会话字段'
    );
  }

  console.log(`✅ [active-org] ${SELFCHECK_PASS_LOG}（${multiOrg.length} 名多组织成员，维度齐备）`);
}
