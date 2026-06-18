import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { fakeLlmRouter } from './_smoke-fake-llm';

// 配套 unit（lint-test-pairing）— fake-LLM 替身行为：mode 切换 + ok 返关键词 / fail 返 401。
// 端到端扩词降级由 contract-dod.md [BEHAVIOR] Step1 作 evaluator oracle。
function app() {
  const a = express();
  a.use(express.json());
  a.use(fakeLlmRouter);
  return a;
}

describe('fake-LLM 替身', () => {
  it('mode=ok：/chat/completions 返非空关键词内容', async () => {
    const a = app();
    await request(a).post('/__test/llm-mode').send({ mode: 'ok' }).expect(200);
    const res = await request(a).post('/chat/completions').send({ messages: [] }).expect(200);
    const content: string = res.body.choices[0].message.content;
    expect(content.split('\n').filter(Boolean).length).toBe(3);
  });

  it('mode=fail：/chat/completions 返 401（触发上游降级）', async () => {
    const a = app();
    await request(a).post('/__test/llm-mode').send({ mode: 'fail' }).expect(200);
    await request(a).post('/chat/completions').send({ messages: [] }).expect(401);
  });

  it('非法 mode → 400', async () => {
    await request(app()).post('/__test/llm-mode').send({ mode: 'bogus' }).expect(400);
  });
});
