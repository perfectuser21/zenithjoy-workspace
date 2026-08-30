import { describe, it, expect } from 'vitest';
import { normMachine, ONLINE_WINDOW_SQL } from '../agent-machines-normalize';
describe('normMachine', () => {
  it('last_seen 在 3 分钟内 → online，offline_minutes=null', () => {
    const m = normMachine({ id: 'a', last_seen: new Date(Date.now() - 60_000).toISOString() });
    expect(m.status).toBe('online'); expect(m.offline_minutes).toBeNull();
  });
  it('last_seen 超 3 分钟 → offline，offline_minutes 取整', () => {
    const m = normMachine({ id: 'a', last_seen: new Date(Date.now() - 10 * 60_000).toISOString() });
    expect(m.status).toBe('offline'); expect(m.offline_minutes).toBe(10);
  });
  it('row.status 为字符串时直接采用；session_count 转 number；owner_type 缺省 customer', () => {
    const m = normMachine({ id: 'a', status: 'online', session_count: '3' });
    expect(m.status).toBe('online'); expect(m.session_count).toBe(3); expect(m.owner_type).toBe('customer');
  });
  it('导出在线判据 SQL 片段', () => { expect(ONLINE_WINDOW_SQL).toContain("INTERVAL '3 minutes'"); });
});
