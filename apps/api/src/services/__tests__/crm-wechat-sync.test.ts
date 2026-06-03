import { describe, it, expect } from 'vitest';
import {
  fetchWechatContacts,
  matchContactsToCrm,
  type WechatContact,
  type CrmRecord,
} from '../crm-wechat-sync';

describe('crm-wechat-sync — Path 4 Step 2', () => {
  describe('fetchWechatContacts', () => {
    it('返回精确 5 条 mock 联系人', async () => {
      const contacts = await fetchWechatContacts();
      expect(contacts).toHaveLength(5);
      expect(contacts[0]).toHaveProperty('wechat_id');
      expect(contacts[0]).toHaveProperty('nickname');
    });

    it('每条联系人 wechat_id 唯一', async () => {
      const contacts = await fetchWechatContacts();
      const ids = contacts.map((c) => c.wechat_id);
      expect(new Set(ids).size).toBe(5);
    });
  });

  describe('matchContactsToCrm', () => {
    const contacts: WechatContact[] = [
      { wechat_id: 'wx_001', nickname: '张三' },
      { wechat_id: 'wx_002', nickname: '李四' },
    ];

    it('精确匹配 wechat_id → matched', async () => {
      const records: CrmRecord[] = [
        { crm_row_id: 'row1', name: '张三', wechat_id: 'wx_001', platform: 'feishu' },
      ];
      const result = await matchContactsToCrm(contacts, records);
      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].contact.wechat_id).toBe('wx_001');
      expect(result.matched[0].score).toBe(1.0);
    });

    it('昵称模糊匹配 → pending', async () => {
      const records: CrmRecord[] = [
        { crm_row_id: 'row2', name: '李四先生', platform: 'notion' },
      ];
      const result = await matchContactsToCrm(contacts, records);
      expect(result.pending.length + result.unmatched.length).toBeGreaterThan(0);
    });

    it('无匹配 → unmatched', async () => {
      const result = await matchContactsToCrm(contacts, []);
      expect(result.unmatched).toHaveLength(2);
      expect(result.matched).toHaveLength(0);
      expect(result.pending).toHaveLength(0);
    });
  });
});
