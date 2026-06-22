/**
 * Path 4 Line04 — 出站任务 agent_id「身份对齐」回归测试（真 Postgres）。
 *
 * 【真机验出来的 bug】
 *   中台入队出站任务（关键人上下线播报 / 失败告警）时，wechat_publish_task.agent_id
 *   存的是 agent 的 UUID（agents.id，PUT /cs/auto-agent 的 agent_id 是 z.string().uuid()）。
 *   但客户机上 listen_chat.py 用的 --agent-id 在 register 失败/老 config 时会回退成
 *   env 标识（agent-env-xxx，= agents.agent_id text 列），拿它去 GET /cs/outbound?agent_id=
 *   拉 → 两套身份对不上 → 出站任务永远拉不到 → 关键人收不到播报。
 *
 * 【对齐方案（服务端兜底映射，不新造第三套 id）】
 *   outbound 拉取端把传入的 agent_id 规范化为 UUID：
 *     - 传入已是 UUID → 直接用（覆盖 register 成功传 UUID 的情况）
 *     - 传入是 env-id（agents.agent_id text 列）→ SELECT id FROM agents WHERE agent_id=$1
 *       反查出 UUID 再过滤（覆盖回退传 env-id 的情况）
 *   这样 enqueue（UUID）和 poll（UUID 或 env-id）始终落到同一 agent 身份。
 *
 * 验：
 *   1) 用 UUID 入队 → 用同一 agent 的 env-id 拉 GET /cs/outbound 能拉到（proven-to-fire：
 *      未修前 env-id ≠ UUID → PG 22P02 / 拉不到，本断言红；修后绿）
 *   2) 用 UUID 入队 → 用 UUID 拉也能拉到（不回退身份不破）
 *   3) 用「别的 agent」的 env-id 拉 → 拉不到（身份隔离不被打穿）
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { wechatRouter } from '../../../src/routes/wechat';
import { testPool, createTestTenant } from '../helpers';
import { enqueueKeyContactBroadcast } from '../../../src/services/wechat/cs-outbound';

const app = express();
app.use(express.json());
app.use('/api/wechat', wechatRouter);

// 被测 agent：UUID = agents.id（入队身份）；ENV_ID = agents.agent_id text 列（客户机回退身份）
const AGENT_UUID = randomUUID();
const ENV_ID = `agent-env-${Date.now().toString(36)}`;
// 另一个 agent：用于「身份隔离」断言（它的 env-id 不能拉到本 agent 的任务）
const OTHER_UUID = randomUUID();
const OTHER_ENV_ID = `agent-env-other-${Date.now().toString(36)}`;
const KEY_CONTACT = '关键人身份对齐测试号';

let tenantId = '';

async function cleanup() {
  await testPool.query(`DELETE FROM zenithjoy.wechat_publish_task WHERE agent_id IN ($1, $2)`, [
    AGENT_UUID,
    OTHER_UUID,
  ]);
}

beforeAll(async () => {
  const t = await createTestTenant();
  tenantId = t.id;
  // 在 agents 表种两行：UUID(id) ↔ env-id(agent_id text 列) 映射，供服务端 env-id→UUID 反查
  await testPool.query(
    `INSERT INTO zenithjoy.agents (id, tenant_id, agent_id, status)
     VALUES ($1, $2, $3, 'online'), ($4, $2, $5, 'online')
     ON CONFLICT (id) DO NOTHING`,
    [AGENT_UUID, tenantId, ENV_ID, OTHER_UUID, OTHER_ENV_ID],
  );
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await testPool.query(`DELETE FROM zenithjoy.agents WHERE id IN ($1, $2)`, [AGENT_UUID, OTHER_UUID]);
  await testPool.query(`DELETE FROM zenithjoy.tenants WHERE id = $1`, [tenantId]);
});

beforeEach(async () => {
  await cleanup();
});

/** 入队一条出站任务（用 UUID，镜像 PUT /cs/auto-agent 写 wechat_publish_task.agent_id=UUID）。 */
async function enqueueWithUuid(): Promise<string> {
  const r = await enqueueKeyContactBroadcast({
    prevOn: false,
    nextOn: true,
    keyContact: KEY_CONTACT,
    agentId: AGENT_UUID,
  });
  expect(r.action).toBe('online');
  expect(r.task_id).toBeTruthy();
  return r.task_id as string;
}

describe('Line04 出站任务 agent_id 身份对齐 [REGRESSION]', () => {
  it('① 用 UUID 入队 → 用同一 agent 的 env-id 拉 GET /cs/outbound 能拉到（修关键人播报拉不到）', async () => {
    await enqueueWithUuid();

    const list = await request(app).get(
      `/api/wechat/cs/outbound?agent_id=${encodeURIComponent(ENV_ID)}`,
    );
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.tasks)).toBe(true);
    expect(list.body.tasks.length).toBe(1);
    expect(list.body.tasks[0].target).toBe(KEY_CONTACT);
  });

  it('② 用 UUID 入队 → 用 UUID 拉也能拉到（不回退身份照样可用）', async () => {
    await enqueueWithUuid();

    const list = await request(app).get(
      `/api/wechat/cs/outbound?agent_id=${encodeURIComponent(AGENT_UUID)}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.tasks.length).toBe(1);
    expect(list.body.tasks[0].target).toBe(KEY_CONTACT);
  });

  it('③ 别的 agent 的 env-id 拉 → 拉不到（身份隔离不被打穿）', async () => {
    await enqueueWithUuid();

    const list = await request(app).get(
      `/api/wechat/cs/outbound?agent_id=${encodeURIComponent(OTHER_ENV_ID)}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.tasks.length).toBe(0);
  });

  it('④ 未知 env-id（agents 表无映射）拉 → 拉不到、不 500', async () => {
    await enqueueWithUuid();

    const list = await request(app).get(
      `/api/wechat/cs/outbound?agent_id=${encodeURIComponent('agent-env-nonexistent-xyz')}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.tasks.length).toBe(0);
  });
});
