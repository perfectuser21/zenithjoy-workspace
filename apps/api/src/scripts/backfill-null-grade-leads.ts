/**
 * backfill-null-grade-leads.ts — 一次性历史数据修复脚本，不进 CI 常驻。
 *
 * 背景：PR #1416（2026-07-19）修复了 Gemini 全角标点解析失败的 bug，但修复前产生的
 * acquisition_lead_comments.grade=null 历史数据没有回补机制。直接无脑补有风险：
 * acquisition_config 没有历史时间戳/版本表，没法准确判断"某条历史评论被判定时画像
 * 是不是空的"——若不加保护，会把当时确实没画像（本该是 null）的记录也补出假意向。
 *
 * 安全边界：只处理 commented_at 晚于该租户 acquisition_config.updated_at 的记录
 * （用 updated_at 而非 created_at 作为"画像最早可能非空"的保守下界——租户常见的
 * 建库顺序是先 PUT /config 建行填其他运营参数（burner_count/dm_per_hour 等），
 * 此时画像仍是空的，之后才通过 PATCH /config 真正填入 target_profile_desc，
 * 后者只会推进 updated_at、不改 created_at。若仍用 created_at 做下界，会把
 * "config 行已存在但画像其实还空着"这段窗口内的评论误判为可安全 backfill，
 * 反而伪造出当时并不存在的意向信号。用 updated_at 只会让下界更靠后、纳入更少，
 * 是严格更保守的方向，符合"宁可漏判不可误判"原则）。已知局限：若租户曾经清空
 * 画像又重新填写，updated_at 只能反映"最后一次触碰 config"的时间，无法区分
 * 中间的清空期——但这仍是保守方向（可能漏纳入，不会误纳入），不是危险方向。
 * 因此本脚本产出结果不自动联动 outreach_eligible/派发，跑完打印候选名单，
 * 必须人工复核后再手动触发 /api/acquisition/rescore-lead 或改库。
 *
 * 已知局限（评分上下文缺失）：本脚本调用 gradeComments 时 title/transcript 固定传 null，
 * 因为 acquisition_lead_comments 没有廉价可关联到具体视频的字段（video_id 可空，
 * 且 acquisition_collect_videos 主键是复合的 (task_id, video_id)，评论行上没有）。
 * 也就是说 backfill 出的 grade 是在没有视频标题/转写上下文的情况下算出来的，
 * 信号强度弱于生产实时判定路径（/collect/report 会带上视频标题+转写）——
 * 人工复核候选名单时需要把这点考虑进去。
 *
 * 用法：
 *   npx ts-node src/scripts/backfill-null-grade-leads.ts --dry-run   # 只打印不写库
 *   npx ts-node src/scripts/backfill-null-grade-leads.ts             # 写 grade，不动 outreach_eligible
 */
import pool from '../db/connection';
import { gradeComments } from '../services/comment-grading';

export interface CandidateRow {
  commentId: string;
  leadId: string;
  tenantId: string;
  commentText: string | null;
  commentedAt: Date;
  /** 安全下界时间戳——由 main() 用 acquisition_config.updated_at 填充，
   *  字段名沿用 configCreatedAt 是为了不动既有单测构造的对象形状，
   *  语义是"该租户 config 行最近一次被写入的时间"，不特指 created_at 列。 */
  configCreatedAt: Date | null;
}

export interface BackfillCandidate {
  commentId: string;
  leadId: string;
  tenantId: string;
  commentText: string | null;
}

export function selectBackfillCandidates(rows: CandidateRow[]): BackfillCandidate[] {
  return rows
    .filter((r) => r.configCreatedAt !== null && r.commentedAt.getTime() > r.configCreatedAt.getTime())
    .map((r) => ({
      commentId: r.commentId,
      leadId: r.leadId,
      tenantId: r.tenantId,
      commentText: r.commentText,
    }));
}

interface RawRow {
  comment_id: string;
  lead_id: string;
  tenant_id: string;
  comment_text: string | null;
  commented_at: string;
  config_updated_at: string | null;
  target_profile_desc: string | null;
}

async function main() {
  const dryRun = process.argv.some((arg) => arg === '--dry-run' || arg.startsWith('--dry-run='));

  console.log(dryRun
    ? '模式: DRY RUN（只打印候选，不写库）'
    : '模式: 真实写库（将实际更新 acquisition_lead_comments.grade）');

  const { rows } = await pool.query<RawRow>(`
    SELECT c.id AS comment_id, c.lead_id, l.tenant_id, c.comment_text, c.commented_at,
           cfg.updated_at AS config_updated_at, cfg.target_profile_desc
      FROM zenithjoy.acquisition_lead_comments c
      JOIN zenithjoy.acquisition_leads l ON l.id = c.lead_id
      LEFT JOIN zenithjoy.acquisition_config cfg ON cfg.tenant_id = l.tenant_id::text
     WHERE c.grade IS NULL
  `);

  const profileByTenant = new Map<string, string>();
  for (const row of rows) {
    if (row.target_profile_desc) profileByTenant.set(row.tenant_id, row.target_profile_desc);
  }

  const candidates = selectBackfillCandidates(
    rows.map((r) => ({
      commentId: r.comment_id,
      leadId: r.lead_id,
      tenantId: r.tenant_id,
      commentText: r.comment_text,
      commentedAt: new Date(r.commented_at),
      configCreatedAt: r.config_updated_at ? new Date(r.config_updated_at) : null,
    }))
  );

  console.log(`候选 ${candidates.length} 条（画像已配置之后产生、grade 仍为 null 的历史评论）`);

  for (const c of candidates) {
    const profileDesc = profileByTenant.get(c.tenantId) ?? '';
    const [grade] = await gradeComments(profileDesc, null, null, [{ commentText: c.commentText }]);
    if (!dryRun && grade) {
      await pool.query(`UPDATE zenithjoy.acquisition_lead_comments SET grade = $1 WHERE id = $2`, [grade, c.commentId]);
    }
    console.log(`lead=${c.leadId} comment=${c.commentId} → grade=${grade ?? 'null'}${dryRun ? '（dry-run，未写库）' : ''}`);
  }

  console.log('backfill 完成。注意：acquisition_leads.outreach_eligible 未自动更新——人工复核候选名单后，'
    + '对确认要放行的 lead 手动调用 POST /api/acquisition/rescore-lead 或直接改库，不要批量自动派发。');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
