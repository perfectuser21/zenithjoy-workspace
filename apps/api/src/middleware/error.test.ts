import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ApiError, errorHandler } from './error';

function appThrowing(error: Error) {
  const app = express();
  app.get('/failure', () => { throw error; });
  app.use(errorHandler);
  return app;
}
afterEach(() => vi.restoreAllMocks());
describe('Express错误中间件真实路由契约', () => {
  it('四参签名能被Express识别并返回业务错误与结构化details', async () => {
    const response = await request(appThrowing(new ApiError('INPUT_REQUIRED', '缺字段', 422, { field: 'parent_id' }))).get('/failure');
    expect(response.status).toBe(422);
    expect(response.type).toBe('application/json');
    expect(response.body.error).toEqual({ code: 'INPUT_REQUIRED', message: '缺字段', details: { field: 'parent_id' } });
  });
  it('数据库唯一冲突通过HTTP返回409，避免调用方把冲突当成功', async () => {
    const error = Object.assign(new Error('duplicate'), { code: '23505', detail: 'parent already bound' });
    const response = await request(appThrowing(error)).get('/failure');
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });
  it('非开发环境未知错误返回通用500，响应不暴露内部错误文本', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(appThrowing(new Error('private diagnostic detail'))).get('/failure');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('private diagnostic detail');
  });
});
