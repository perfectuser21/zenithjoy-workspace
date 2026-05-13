/**
 * P4 WS1 — wechat-rpa handler: spawn Python dryrun + receipt 解析.
 *
 * commit-1 RED (handler throws not impl); commit-2 GREEN.
 */
import { describe, it, expect } from 'vitest';
import { handleWechatRpa } from '../wechat-rpa';
import path from 'path';

describe('P4 WS1 — wechat-rpa handler [BEHAVIOR]', () => {
  it('dryrun qr_bind spawn 子进程 exit 0 + receipt 含 wechat_id', async () => {
    const stubPath = path.resolve(__dirname, '../../../../../scripts/wechat_rpa_dryrun.py');
    const result = await handleWechatRpa({
      type: 'wechat_qr_bind',
      payload: { dryrun: true, agent_id: 'test-agent-001' },
      pythonStub: stubPath,
    });
    expect(result.ok).toBe(true);
    expect(result.receipt).toBeDefined();
    expect(String(result.receipt?.wechat_id)).toMatch(/^mock_wx_/);
  });
});
