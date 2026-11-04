import { afterAll, afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
import axios from 'axios';
import app from '../../../src/app';
import pool from '../../../src/db/connection';
afterAll(() => pool.end());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('HTTP collect/report persists provider grades and the no-key fallback with exact lead/comment linkage', async () => {
  const tenant = randomUUID(), agent = `grading-agent-${randomUUID()}`;
  await pool.query("INSERT INTO zenithjoy.tenants(id,name,license_key,plan) VALUES($1,'grading',$2,'free')", [tenant, `grading-${tenant}`]);
  await pool.query("INSERT INTO zenithjoy.agents(tenant_id,agent_id,status) VALUES($1,$2,'online')", [tenant, agent]);
  await pool.query("INSERT INTO zenithjoy.acquisition_config(tenant_id,target_profile_desc) VALUES($1,'装修行业目标客户')", [tenant]);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external fetch forbidden in grading fixture'); }));
  const provider = vi.mocked(axios.post);
  provider.mockResolvedValue({ data: { choices: [{ message: { content: '1. 精准' } }] } });
  for (const [name, key, grade, eligible] of [['graded', 'isolated-provider-fixture', '精准', true], ['fallback', '', null, false]] as const) {
    const task = randomUUID(), video = `video-${randomUUID()}`;
    await pool.query("INSERT INTO zenithjoy.acquisition_collect_tasks(id,tenant_id,keywords,status,agent_id) VALUES($1,$2,'[\"装修\"]','running',$3)", [task, tenant, agent]);
    await pool.query('INSERT INTO zenithjoy.acquisition_collect_videos(video_id,task_id,tenant_id,title) VALUES($1,$2,$3,$4)', [video, task, tenant, '装修预算']);
    vi.stubEnv('TOAPIS_API_KEY', key); vi.stubEnv('OPENROUTER_API_KEY', key); provider.mockClear();
    const response = await request(app).post('/api/acquisition/collect/report').set('x-agent-id', agent)
      .send({ task_id: task, video_id: video, commenters: [{ nickname: name, comment_text: '预算十万求推荐', douyin_id: `${name}-${tenant}` }], terminal: false }).timeout({ deadline: 5000 });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const rows = await pool.query(`SELECT l.nickname,l.outreach_eligible,c.grade,c.video_id FROM zenithjoy.acquisition_leads l
      JOIN zenithjoy.acquisition_lead_comments c ON c.lead_id=l.id WHERE l.tenant_id=$1 AND l.nickname=$2`, [tenant, name]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ nickname: name, grade, outreach_eligible: eligible, video_id: video });
    if (key) expect(provider).toHaveBeenCalledTimes(1); else expect(provider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  }
});
