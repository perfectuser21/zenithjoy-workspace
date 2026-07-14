/**
 * Path 2 Sprint B-1 WS4 — lead-writer service
 *
 * 决策 D：复用 Sprint A `feishu-bitable-multitenant.writeRecord`，不重写飞书调用链。
 *   - getValidToken 自动续 token（在 multitenant service 内部完成）
 *   - axios 调飞书 by FEISHU_API_BASE（CI 指 fake-server）
 *
 * writeLeadsFromComments（原「5 条评论 → 5 次 writeRecord 写 Lead 表」）已删除（决策19e6480c，
 *   2026-07-14）——生产里没人调用，只有测试文件引用，属死代码。当前仅保留 writeDmOutreachStatus
 *   （DM 触达状态回写飞书 Lead 表，活代码）及其共用的重试逻辑。
 */
import { writeRecord } from './feishu-bitable-multitenant';

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

// ── Path 2 抖音私信主动触达 — 触达状态回写 Lead 表 ──
//
// 一次触达 = 写一条记录（触达状态 / 触达主页 URL / 触达时间 / 触达小号 / 失败原因）。
// 映射与 agent handler douyin-dm-outreach.mapDmStatusToFeishu 保持一致（刻意不跨包 import，
//   避免把 services/agent 拉进 apps/api 构建边界）：sent→已私信 / limited→未送达-仅互关 / failed→失败。
// limited 绝不写「已私信」（禁止假 sent）。

export type DmStatus = 'sent' | 'limited' | 'failed';

const DM_STATUS_TO_FEISHU: Record<DmStatus, string> = {
  sent: '已私信',
  limited: '未送达-仅互关',
  failed: '失败',
};

export interface WriteDmOutreachParams {
  tenant_id: string;
  table_id_leads: string;
  profile_url: string;
  account_label: string;
  dm_status: DmStatus;
  error_code?: string | null;
  reached_at?: string;
}

export interface WriteDmOutreachResult {
  lead_write_status: 'success' | 'failed';
  error?: string;
}

export async function writeDmOutreachStatus(
  params: WriteDmOutreachParams,
): Promise<WriteDmOutreachResult> {
  const { tenant_id, table_id_leads, profile_url, account_label, dm_status, error_code } = params;
  const now = params.reached_at || new Date().toISOString();

  const fields: Record<string, unknown> = {
    触达状态: DM_STATUS_TO_FEISHU[dm_status] ?? '失败',
    '触达主页 URL': profile_url,
    触达时间: now,
    触达小号: account_label,
    失败原因: dm_status === 'failed' ? error_code || '' : '',
  };

  try {
    await writeOneWithRetry(tenant_id, table_id_leads, fields);
    return { lead_write_status: 'success' };
  } catch (err) {
    return { lead_write_status: 'failed', error: (err as Error).message };
  }
}
