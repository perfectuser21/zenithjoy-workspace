import { afterAll, afterEach, expect, it, vi } from 'vitest';
vi.mock('axios', () => ({ default: { post: vi.fn() } }));
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import pool from '../../../src/db/connection';
import { pushClipOutput } from '../../../src/services/clip-output.service';
afterAll(() => pool.end());
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('real clip output refreshes only the bound user token, persists it and uses that token for export', async () => {
  const a = `clip-user-${randomUUID()}`, b = `clip-user-${randomUUID()}`;
  await pool.query(`INSERT INTO zenithjoy.user_clip_settings(user_id,feishu_user_token,feishu_refresh_token,feishu_token_expires_at)
    VALUES($1,'expired-fixture-token','owned-refresh',now()-interval '1 minute'),($2,'other-user-token','other-refresh',now()+interval '1 day')`, [a, b]);
  const clip = (await pool.query(`INSERT INTO zenithjoy.clips(user_id,url,platform,title,output_type,output_url)
    VALUES($1,'https://www.douyin.com/video/fixture','douyin','fixture','feishu','https://fixture.feishu.cn/base/app-fixture?table=table-fixture') RETURNING *`, [a])).rows[0];
  vi.stubEnv('FEISHU_APP_ID', 'fixture'); vi.stubEnv('FEISHU_APP_SECRET', 'fixture');
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toBe('https://open.feishu.cn/open-apis/authen/v1/refresh_access_token');
    expect(JSON.parse(String(options.body)).refresh_token).toBe('owned-refresh');
    return { json: async () => ({ code: 0, data: { access_token: 'new-owned-token', refresh_token: 'new-owned-refresh', open_id: a, name: 'fixture', expires_in: 7200 } }) };
  }));
  vi.mocked(axios.post).mockResolvedValue({ data: { code: 0 } });
  expect(await pushClipOutput(clip)).toEqual({ success: true });
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/apps/app-fixture/tables/table-fixture/records'), expect.anything(), { headers: { Authorization: 'Bearer new-owned-token' } });
  const tokens = await pool.query('SELECT user_id,feishu_user_token,feishu_refresh_token FROM zenithjoy.user_clip_settings WHERE user_id=ANY($1::text[]) ORDER BY user_id', [[a, b]]);
  expect(tokens.rows.find(row => row.user_id === a)).toMatchObject({ feishu_user_token: 'new-owned-token', feishu_refresh_token: 'new-owned-refresh' });
  expect(tokens.rows.find(row => row.user_id === b)).toMatchObject({ feishu_user_token: 'other-user-token', feishu_refresh_token: 'other-refresh' });
  expect(await pushClipOutput({ ...clip, user_id: 'unbound-user' })).toEqual({ success: false, error: 'no_binding' });
  expect(await pushClipOutput({ ...clip, output_url: null })).toEqual({ success: false, error: 'no_output_configured' });
});
