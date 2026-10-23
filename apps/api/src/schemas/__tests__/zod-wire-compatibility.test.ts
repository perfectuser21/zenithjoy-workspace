import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWorkSchema, createPublishLogSchema, updatePublishLogSchema } from '../../models/schemas';
import { HelloPayload, PublishRequestPayload, CmdResultPayload } from '../agent-protocol';
import { validate } from '../../middleware/validate';
import { errorHandler } from '../../middleware/error';

describe('Zod迁移保留既有API与设备输入合同', () => {
  it('任意字符串字典键和值类型保持原语义', () => {
    const payload = {
      title: 'test', content_type: 'text',
      platform_links: { arbitrary_platform: 'https://example.test' },
      custom_fields: { arbitrary: { nested: [1, false, null] } },
    };
    expect(createWorkSchema.parse(payload)).toEqual(payload);
    expect(createWorkSchema.safeParse({ ...payload, platform_links: { arbitrary_platform: 1 } }).success).toBe(false);
    const response = { arbitrary: { nested: [1, false, null] } };
    expect(createPublishLogSchema.parse({ platform: 'douyin', response }).response).toEqual(response);
    expect(updatePublishLogSchema.parse({ response }).response).toEqual(response);
    expect(CmdResultPayload.parse({ data: response }).data).toEqual(response);
  });

  it('三个既有UUID字段继续接受宽UUID-like且拒绝畸形值', () => {
    const schemas = [
      (id: string) => createPublishLogSchema.safeParse({ platform: 'douyin', work_id: id }),
      (id: string) => HelloPayload.safeParse({ agentId: 'agent', version: '1', capabilities: [], agentUuid: id }),
      (id: string) => PublishRequestPayload.safeParse({ platform: 'wechat', content: { title: 'title', body: 'body' }, agent_id: id }),
    ];
    for (const schema of schemas) {
      for (const id of ['11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', '123e4567-e89b-42d3-a456-426614174000']) {
        expect(schema(id).success).toBe(true);
      }
      expect(schema('not-a-uuid').success).toBe(false);
      expect(schema('11111111-1111-1111-1111-11111111111Z').success).toBe(false);
    }
  });

  it('普通对象继续剥离未知字段而设备回执保留扩展字段', () => {
    expect(createWorkSchema.parse({ title: 'test', content_type: 'text', extra: true })).not.toHaveProperty('extra');
    expect(HelloPayload.parse({ agentId: 'agent', version: '1', capabilities: [], extra: true })).not.toHaveProperty('extra');
    expect(CmdResultPayload.parse({ ok: true, extension: { added: true } })).toHaveProperty('extension', { added: true });
  });

  it('真实HTTP校验错误仍返回400及结构化details', async () => {
    const app = express();
    app.use(express.json());
    app.post('/work', validate(createWorkSchema), (req, res) => { res.json(req.body); });
    app.use(errorHandler);
    const response = await request(app).post('/work').send({ title: 42, content_type: 'text' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Invalid request data' });
    expect(response.body.error.details).toEqual([
      expect.objectContaining({ code: 'invalid_type', path: ['title'], message: expect.any(String) }),
    ]);
    const valid = await request(app).post('/work').send({ title: 'test', content_type: 'text', platform_links: { any: 'link' } });
    expect(valid.status).toBe(200);
    expect(valid.body.platform_links).toEqual({ any: 'link' });
  });
});
