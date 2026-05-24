/**
 * Path 2 Sprint B-1 WS4 — lead-writer service
 *
 * 职责：把 Agent 上报的 5 条评论 → 5 次 writeRecord 写客户飞书 Lead 表。
 *
 * 决策 D：复用 Sprint A `feishu-bitable-multitenant.writeRecord`，不重写飞书调用链。
 *   - getValidToken 自动续 token（在 multitenant service 内部完成）
 *   - axios 调飞书 by FEISHU_API_BASE（CI 指 fake-server）
 *
 * 行为：
 *   - 5 条 → 5 次 writeRecord（顺序，不并发，避免触发飞书 rate limit）
 *   - 单条失败 → 重试 1 次（共 2 次尝试）；2 次都失败 → 标记 lead_write_status='failed'
 *   - 评论 0 条 → 早 return + 不调 writeRecord + 返 success（comment_count=0）
 */
import { writeRecord } from './feishu-bitable-multitenant';

export type LeadGrade = '感兴趣' | '精准' | '高意向';

export interface CommentInput {
  commenter_id: string;
  text: string;
  publish_time: string;
  grade?: LeadGrade;
  keyword?: string;
}

export interface WriteLeadsParams {
  tenant_id: string;
  table_id_leads: string;
  video_url: string;
  keyword?: string;
  comments: CommentInput[];
}

export interface WriteLeadsResult {
  written_count: number;
  lead_write_status: 'success' | 'failed';
  error?: string;
}

const MAX_RETRY = 2; // 第一次 + 重试 1 = 2 attempts

async function writeOneWithRetry(
  tenantId: string,
  tableId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      await writeRecord(tenantId, tableId, fields);
      return;
    } catch (err) {
      lastErr = err as Error;
      // 第一次失败不抛 — 进重试
      if (attempt < MAX_RETRY) continue;
    }
  }
  throw lastErr;
}

export async function writeLeadsFromComments(
  params: WriteLeadsParams,
): Promise<WriteLeadsResult> {
  const { tenant_id, table_id_leads, video_url, keyword, comments } = params;

  // 评论 0 早 return — 不调 writeRecord，仍算成功
  if (!Array.isArray(comments) || comments.length === 0) {
    return {
      written_count: 0,
      lead_write_status: 'success',
    };
  }

  const now = new Date().toISOString();
  let writtenCount = 0;
  let firstErr: Error | null = null;

  for (const c of comments) {
    const fields: Record<string, unknown> = {
      '评论者抖音 ID': c.commenter_id || '',
      评论内容: c.text || '',
      '来源视频 URL': video_url,
      抓取时间: c.publish_time || now,
      状态: '已抓取',
      等级: c.grade ?? '',
      关键词: c.keyword ?? keyword ?? '',
    };

    try {
      await writeOneWithRetry(tenant_id, table_id_leads, fields);
      writtenCount++;
    } catch (err) {
      if (!firstErr) firstErr = err as Error;
      // 单条失败继续写下一条 — 但整体标记 failed
    }
  }

  if (firstErr) {
    return {
      written_count: writtenCount,
      lead_write_status: 'failed',
      error: firstErr.message,
    };
  }

  return {
    written_count: writtenCount,
    lead_write_status: 'success',
  };
}
