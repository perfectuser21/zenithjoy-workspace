/**
 * Path 4 Line04 — 关键人「上下线播报 + 失败告警」真机主动发送接线（集成测试，真 Postgres）。
 *
 * C1 尾巴：开关 OFF→ON / ON→OFF 跳变 + 发送失败/掉线 → 入「待发给关键人」出站任务
 * （zenithjoy.wechat_publish_task，task_type=private_chat, target_friend_alias=关键人,
 *  approval_source=system, status=approved=待真机发），agent 拉取后真机 UIA 发送回写
 *  auto_sent/send_failed。真机 UIA 发送是接缝（xian-rog 真验），本测试验「中台侧任务入库 + 去重」。
 *
 * 验：
 *   1) PUT /api/wechat/cs/auto-agent 把 OFF→ON → 入 1 条 target=关键人的上线出站任务（approved/system）
 *   2) 再 ON→OFF → 入 1 条下线出站任务
 *   3) 关键人未配（key_contact_wechat='') → 不入任务、不报错（开关仍保存成功）
 *   4) 发送失败入告警出站任务，且同 (关键人,原因) 时间窗内去重（只入一条）
 *   5) GET /api/wechat/cs/outbound?agent_id= 列出待发任务；POST 回执 → status 翻 auto_sent
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { wechatConfigRouter } from '../../../src/routes/wechat-config';
import { wechatRouter } from '../../../src/routes/wechat';
import { testPool } from '../helpers';
import { enqueueFailureAlert } from '../../../src/services/wechat/cs-outbound';
import { saveAutoAgentConfig } from '../../../src/services/wechat/cs-config-store';

const app = express();
app.use(express.json());
app.use('/api/wechat', wechatConfigRouter);
app.use('/api/wechat', wechatRouter);

const ADMIN = process.env.ADMIN_FEISHU_OPENIDS?.split(',')[0]?.trim() || 'ou_admin_integration_001';
const INTERNAL_TOKEN = process.env.ZENITHJOY_INTERNAL_TOKEN || 'integration-test-token';
const asAdmin = (r: request.Test) =>
  r.set('X-Feishu-User-Id', ADMIN).set('X-Internal-Token', INTERNAL_TOKEN);

const AGENT_ID = '3755783c-33fd-483c-bc28-10be65c4872a';
const KEY_CONTACT = '关键人测试号';

async function cleanup() {
  await testPool.query(
    `DELETE FROM zenithjoy.wechat_publish_task WHERE agent_id = $1`,
    [AGENT_ID],
  );
  await testPool.query(`DELETE FROM zenithjoy.wechat_cs_config WHERE key = 'auto_agent'`);
}

async function countOutbound(): Promise<number> {
  const { rows } = await testPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM zenithjoy.wechat_publish_task
      WHERE agent_id = $1 AND task_type = 'private_chat' AND approval_source = 'system'`,
    [AGENT_ID],
  );
  return Number(rows[0].n);
}

beforeAll(async () => {
  // 从关 + 空关键人起步
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  // 起步：开关 OFF + 关键人已配（供播报）
  await saveAutoAgentConfig({
    auto_agent_enabled: false,
    business_hours_start: '00:00',
    business_hours_end: '24:00',
    key_contact_wechat: KEY_CONTACT,
    daily_limit: 0,
  });
});

describe('Line04 关键人播报 + 失败告警 出站任务接线 [BEHAVIOR]', () => {
  it('① OFF→ON 跳变 → 入一条 target=关键人的上线出站任务（approved/system）', async () => {
    const res = await asAdmin(
      request(app)
        .put('/api/wechat/cs/auto-agent')
        .send({ auto_agent_enabled: true, agent_id: AGENT_ID }),
    );
    expect(res.status).toBe(200);

    const { rows } = await testPool.query(
      `SELECT target_friend_alias, content, status, approval_source
         FROM zenithjoy.wechat_publish_task
        WHERE agent_id = $1 AND task_type = 'private_chat' AND approval_source = 'system'`,
      [AGENT_ID],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].target_friend_alias).toBe(KEY_CONTACT);
    expect(rows[0].status).toBe('approved'); // approved=待真机发
    expect(rows[0].approval_source).toBe('system');
    expect(String(rows[0].content)).toMatch(/上线|🟢/);
  });

  it('② ON→OFF 跳变 → 入一条下线出站任务', async () => {
    // 先 ON
    await saveAutoAgentConfig({ auto_agent_enabled: true });
    await testPool.query(`DELETE FROM zenithjoy.wechat_publish_task WHERE agent_id = $1`, [AGENT_ID]);
    // 再 OFF
    const res = await asAdmin(
      request(app)
        .put('/api/wechat/cs/auto-agent')
        .send({ auto_agent_enabled: false, agent_id: AGENT_ID }),
    );
    expect(res.status).toBe(200);

    const { rows } = await testPool.query(
      `SELECT content FROM zenithjoy.wechat_publish_task
        WHERE agent_id = $1 AND task_type = 'private_chat' AND approval_source = 'system'`,
      [AGENT_ID],
    );
    expect(rows.length).toBe(1);
    expect(String(rows[0].content)).toMatch(/下线|🔴/);
  });

  it('③ 关键人未配 → 不入任务、不报错（开关仍保存成功）', async () => {
    await saveAutoAgentConfig({ key_contact_wechat: '' });
    const res = await asAdmin(
      request(app)
        .put('/api/wechat/cs/auto-agent')
        .send({ auto_agent_enabled: true, agent_id: AGENT_ID }),
    );
    expect(res.status).toBe(200);
    expect(await countOutbound()).toBe(0);
  });

  it('④ 发送失败入告警出站任务 + 同 (关键人,原因) 去重（只一条）', async () => {
    const a = await enqueueFailureAlert({
      reason: 'send_failed',
      keyContact: KEY_CONTACT,
      agentId: AGENT_ID,
    });
    expect(a.task_id).toBeTruthy();
    // 同原因再来一次 → 去重，不再入
    const b = await enqueueFailureAlert({
      reason: 'send_failed',
      keyContact: KEY_CONTACT,
      agentId: AGENT_ID,
    });
    expect(b.task_id).toBeFalsy();

    expect(await countOutbound()).toBe(1);
    const { rows } = await testPool.query(
      `SELECT content FROM zenithjoy.wechat_publish_task WHERE agent_id = $1 AND approval_source='system'`,
      [AGENT_ID],
    );
    expect(String(rows[0].content)).toMatch(/异常|告警|⚠️/);
  });

  it('⑤ GET 出站待发 → POST 回执 → status 翻 auto_sent', async () => {
    // 入一条上线任务
    await saveAutoAgentConfig({ auto_agent_enabled: false, key_contact_wechat: KEY_CONTACT });
    await asAdmin(
      request(app).put('/api/wechat/cs/auto-agent').send({ auto_agent_enabled: true, agent_id: AGENT_ID }),
    );

    const list = await request(app).get(`/api/wechat/cs/outbound?agent_id=${AGENT_ID}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.tasks)).toBe(true);
    expect(list.body.tasks.length).toBe(1);
    const taskId = list.body.tasks[0].task_id;
    expect(list.body.tasks[0].target).toBe(KEY_CONTACT);

    const receipt = await request(app)
      .post(`/api/wechat/cs/outbound/${taskId}/receipt`)
      .send({ ok: true });
    expect(receipt.status).toBe(200);

    const { rows } = await testPool.query(
      `SELECT status FROM zenithjoy.wechat_publish_task WHERE id = $1`,
      [taskId],
    );
    expect(rows[0].status).toBe('auto_sent');

    // 回执后不再出现在待发列表
    const list2 = await request(app).get(`/api/wechat/cs/outbound?agent_id=${AGENT_ID}`);
    expect(list2.body.tasks.length).toBe(0);
  });
});
