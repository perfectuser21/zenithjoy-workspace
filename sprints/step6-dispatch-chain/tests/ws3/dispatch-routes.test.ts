/**
 * WS3 RED tests — works.ts publish route + walking-skeleton.ts task-ack route
 *
 * 当前两个路由文件不含新端点，测试**必须 RED**。
 * 真 HTTP 行为靠 contract-dod-ws3.md BEHAVIOR manual:bash 验。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_DIR = join(__dirname, '..', '..', '..', '..', 'apps', 'api', 'src', 'routes');
const WORKS_ROUTE = join(ROUTES_DIR, 'works.ts');
const WS_ROUTE = join(ROUTES_DIR, 'walking-skeleton.ts');

describe('WS3 — routes dispatch-chain endpoints [BEHAVIOR]', () => {
  it('works.ts 应含 POST /:id/publish 路由注册（router.post 调用）', () => {
    const src = readFileSync(WORKS_ROUTE, 'utf8');
    expect(src).toMatch(/router\.post\(['"]\/:id\/publish/);
  });

  it('works.ts 应导入并使用 dispatchPublishTask', () => {
    const src = readFileSync(WORKS_ROUTE, 'utf8');
    expect(src).toContain('dispatchPublishTask');
  });

  it('walking-skeleton.ts 应含 task-ack 路由注册', () => {
    const src = readFileSync(WS_ROUTE, 'utf8');
    expect(src).toContain('task-ack');
  });

  it('walking-skeleton.ts 应导入并使用 ackPublishTask', () => {
    const src = readFileSync(WS_ROUTE, 'utf8');
    expect(src).toContain('ackPublishTask');
  });
});
