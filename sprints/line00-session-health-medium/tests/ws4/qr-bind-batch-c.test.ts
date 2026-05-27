import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('WS4 — qr-bind-gongzhonghao + agent index 注册 [BEHAVIOR]', () => {
  it('qr-bind-gongzhonghao.ts 文件存在', () => {
    expect(fs.existsSync('services/agent/src/handlers/qr-bind-gongzhonghao.ts')).toBe(true);
  });

  it('qr-bind-gongzhonghao.ts loginUrl 含 mp.weixin.qq.com', () => {
    const content = fs.readFileSync('services/agent/src/handlers/qr-bind-gongzhonghao.ts', 'utf8');
    expect(content).toContain('mp.weixin.qq.com');
  });

  it('qr-bind-gongzhonghao.ts platform 含 "gongzhonghao"', () => {
    const content = fs.readFileSync('services/agent/src/handlers/qr-bind-gongzhonghao.ts', 'utf8');
    expect(content).toContain('gongzhonghao');
  });

  it('agent index.ts 含对 7 个新 handler 的引用', () => {
    const content = fs.readFileSync('services/agent/src/index.ts', 'utf8');
    const platforms = ['kuaishou', 'xiaohongshu', 'shipinhao', 'toutiao', 'weibo', 'zhihu', 'gongzhonghao'];
    for (const p of platforms) {
      expect(content, `index.ts 缺少 ${p}`).toContain(p);
    }
  });

  it('agent index.ts import qr-bind-kuaishou（新 handler 已 import）', () => {
    const content = fs.readFileSync('services/agent/src/index.ts', 'utf8');
    expect(content).toContain('qr-bind-kuaishou');
  });
});
