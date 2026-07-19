/**
 * apps/api/src/index.ts 必须真正调用 startScheduler()——历史教训：这个函数从建库起
 * 就只在自己的单测里被 import，从未接入服务器启动流程，导致日报结算/朋友圈草稿/
 * warmup 养号/DM 派单四个周期任务全部静默不跑。静态检查源码文本，防止未来重构
 * 时又被悄悄移除且没有测试报警。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const INDEX_PATH = path.resolve(__dirname, '../src/index.ts');

describe('index.ts — startScheduler 必须真正接入', () => {
  it('import 了 startScheduler', () => {
    const src = fs.readFileSync(INDEX_PATH, 'utf-8');
    expect(src).toMatch(/import\s*\{[^}]*\bstartScheduler\b[^}]*\}\s*from\s*['"]\.\/services\/scheduler['"]/);
  });

  it('调用了 startScheduler()（不只是 import 没调用）', () => {
    const src = fs.readFileSync(INDEX_PATH, 'utf-8');
    expect(src).toMatch(/\bstartScheduler\s*\(\s*\)/);
  });
});
