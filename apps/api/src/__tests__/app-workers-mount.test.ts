import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
describe('app.ts 挂载 workers 路由，sweeper 由 index.ts 启动', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../app.ts'), 'utf8');
  const indexSrc = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');
  it('注册执行器面与读面路由（执行器面在前）', () => {
    const exec = src.indexOf("app.use('/api/workers', workersExecutorRouter)");
    const read = src.indexOf("app.use('/api/workers', workersReadRouter)");
    expect(exec).toBeGreaterThan(-1); expect(read).toBeGreaterThan(exec);
  });
  it('租约 sweeper 从 index.ts 启动，app.ts 不再内嵌', () => {
    expect(indexSrc).toMatch(/startWorkerLeaseSweeper\(/);
    expect(src).not.toMatch(/startWorkerLeaseSweeper\(/);
  });
});
