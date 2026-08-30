import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
describe('app.ts 挂载 workers 路由与 sweeper', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../app.ts'), 'utf8');
  it('注册执行器面与读面路由（执行器面在前）', () => {
    const exec = src.indexOf("app.use('/api/workers', workersExecutorRouter)");
    const read = src.indexOf("app.use('/api/workers', workersReadRouter)");
    expect(exec).toBeGreaterThan(-1); expect(read).toBeGreaterThan(exec);
  });
  it('启动租约 sweeper（非 test 环境）', () => { expect(src).toMatch(/startWorkerLeaseSweeper\(/); });
});
