/**
 * Path 4 Step 2: CRM 微信联系人同步服务
 *
 * 功能：
 * 1. 从 wechat_rpa 获取联系人列表（E2E 中 mock）
 * 2. AI 按微信号/昵称模糊匹配 CRM 表记录
 * 3. 持久化 crm_wechat_mapping
 */

export interface WechatContact {
  wechat_id: string;
  nickname: string;
}

export interface CrmRecord {
  crm_row_id: string;
  name: string;
  wechat_id?: string;
  platform: 'feishu' | 'notion';
}

export interface MatchResult {
  matched: Array<{ contact: WechatContact; crm_record: CrmRecord; score: number }>;
  pending: Array<{ contact: WechatContact; crm_candidates: CrmRecord[] }>;
  unmatched: WechatContact[];
}

// Mock 5 条微信联系人（xian-rog 无真微信客户端，E2E 全走 mock）
export async function fetchWechatContacts(_tenantId: string): Promise<WechatContact[]> {
  return [
    { wechat_id: 'wx_001', nickname: '张三' },
    { wechat_id: 'wx_002', nickname: '李四' },
    { wechat_id: 'wx_003', nickname: '王五' },
    { wechat_id: 'wx_004', nickname: '赵六' },
    { wechat_id: 'wx_005', nickname: '陈七' },
  ];
}

export async function matchContactsToCrm(
  contacts: WechatContact[],
  crmRecords: CrmRecord[]
): Promise<MatchResult> {
  const matched: MatchResult['matched'] = [];
  const pending: MatchResult['pending'] = [];
  const unmatched: WechatContact[] = [];

  for (const contact of contacts) {
    // 精确匹配 wechat_id
    const exactMatch = crmRecords.find(
      (r) => r.wechat_id === contact.wechat_id
    );

    if (exactMatch) {
      matched.push({ contact, crm_record: exactMatch, score: 1.0 });
      continue;
    }

    // 昵称模糊匹配
    const fuzzyMatches = crmRecords.filter(
      (r) => r.name.includes(contact.nickname) || contact.nickname.includes(r.name)
    );

    if (fuzzyMatches.length > 0) {
      pending.push({ contact, crm_candidates: fuzzyMatches });
    } else {
      unmatched.push(contact);
    }
  }

  return { matched, pending, unmatched };
}

export async function saveMappingsToDB(
  _tenantId: string,
  _platform: 'feishu' | 'notion',
  mappings: Array<{ wechat_contact_id: string; crm_row_id: string }>
): Promise<void> {
  // 写入 crm_wechat_mapping 表（thin 阶段 log only，迁移文件已定义 schema）
  for (const m of mappings) {
    console.log(`[crm-wechat-sync] 写入映射: wechat_contact_id=${m.wechat_contact_id} crm_row_id=${m.crm_row_id}`);
  }
}
