/**
 * A11 单组织前置自检 —— fail-closed 启动闸，必须在 listen 之前跑完
 *
 * 要拦的事故：同一个员工在 zenithjoy.tenant_members 里被声明进了两家企业。
 * 这种配置事故本身是静默的——没有报错、没有告警，只有"他建的表进了另一家企业"这个后果。
 * 历史实现用 `ORDER BY created_at LIMIT 1` 挑第一条，等于用一列时间戳的偶然顺序决定
 * 一条经营数据归谁；错了以后没有任何信号，是整条 GP 的命门级误判。
 *
 * 所以这里不"挑一个"，而是**起不来**：把事故摆在部署那一刻，而不是留到跨企业数据互穿之后。
 *
 * 与请求期的关系：本闸挡的是启动那一刻已经存在的坏数据；请求期 workbenchAuthGuard 的
 * 409 MULTI_ORG_MEMBER 挡的是运行中新长出来的坏数据。两道一起才是完整的。
 *
 * 查不动成员表时同样拒绝启动（合同失败语义总原则：一律 fail-closed，
 * 任何"查不动/说不清"的情形都不得降级）。
 */
import type { Pool } from 'pg';

export const SELFCHECK_PASS_LOG = 'A11 single-org selfcheck passed';
export const SELFCHECK_VIOLATION_TAG = 'A11-MULTI-ORG';

export class SingleOrgSelfcheckError extends Error {}

/**
 * 查出所有"被声明进多于一家企业"的成员。返回空数组即通过。
 * 抛错表示查不动（调用方按 fail-closed 处理）。
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

/**
 * 启动闸本体。通过 → 打 SELFCHECK_PASS_LOG；不通过 → 抛 SingleOrgSelfcheckError，
 * 消息里点名 A11-MULTI-ORG 与冲突的 feishu_user_id（只打 id，不打姓名/邮箱）。
 *
 * 只验"服务起来了"是假绿：没实现自检时服务照样起。判据必须是自检自己的输出。
 */
export async function assertSingleOrgMembership(pool: Pool): Promise<void> {
  let offenders: Array<{ feishu_user_id: string; org_count: number }>;
  try {
    offenders = await findMultiOrgMembers(pool);
  } catch (err) {
    throw new SingleOrgSelfcheckError(
      `${SELFCHECK_VIOLATION_TAG} 自检无法执行：tenant_members 查询失败（${(err as Error).message}）` +
        ' —— 查不动就不许起，绝不降级成"大概没问题"'
    );
  }

  if (offenders.length > 0) {
    const detail = offenders.map((o) => `${o.feishu_user_id}(${o.org_count} 家)`).join(', ');
    throw new SingleOrgSelfcheckError(
      `${SELFCHECK_VIOLATION_TAG} 同一员工被声明在多家企业：${detail}` +
        ' —— 拒绝启动，请先在 tenant_members 里消歧（绝不按 created_at 取第一条）'
    );
  }

  console.log(`✅ [single-org] ${SELFCHECK_PASS_LOG}`);
}
