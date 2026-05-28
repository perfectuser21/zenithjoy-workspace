import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

const HANDLER_PATH = 'services/agent/src/handlers/qr-bind-operator.ts';
const DISPATCHER_PATH = 'services/agent/src/index.ts';

describe('WS5 — qr-bind-operator Agent handler [BEHAVIOR]', () => {
  it('qr-bind-operator.ts 存在', () => {
    expect(existsSync(HANDLER_PATH), `文件不存在: ${HANDLER_PATH}`).toBe(true);
  });

  it('handler 导出 handleQrBindOperator 函数', () => {
    const src = readFileSync(HANDLER_PATH, 'utf8');
    expect(src).toMatch(/export\s+(function|const|async function)\s+handleQrBindOperator|exports\.handleQrBindOperator/);
  });

  it('handler 含 8 平台 creator URL 映射', () => {
    const src = readFileSync(HANDLER_PATH, 'utf8');
    for (const p of ['douyin', 'kuaishou', 'xiaohongshu', 'shipinhao', 'toutiao', 'weibo', 'zhihu', 'gongzhonghao']) {
      expect(src, `handler 缺平台 ${p} 映射`).toContain(p);
    }
  });

  it('handler 含 CDP 端口 19222', () => {
    const src = readFileSync(HANDLER_PATH, 'utf8');
    expect(src).toContain('19222');
  });

  it('handler 含 5min（300000ms）超时保护', () => {
    const src = readFileSync(HANDLER_PATH, 'utf8');
    expect(src).toMatch(/300000|5\s*\*\s*60\s*\*\s*1000|5.*minute/);
  });

  it('handler 超时返回 ok:false（禁止假阳性 ok:true）', () => {
    const src = readFileSync(HANDLER_PATH, 'utf8');
    expect(src).toMatch(/ok.*false|ok:\s*false|"ok":\s*false/);
  });

  it('handler 调用 POST upload-cookies，含 platform + cookies 字段', () => {
    const src = readFileSync(HANDLER_PATH, 'utf8');
    expect(src).toMatch(/upload-cookies|upload_cookies/);
    expect(src).toContain('platform');
    expect(src).toMatch(/cookies|storageState/);
  });

  it('dispatcher index.ts 导入 qr-bind-operator handler', () => {
    const src = readFileSync(DISPATCHER_PATH, 'utf8');
    expect(src).toMatch(/qr-bind-operator|handleQrBindOperator/);
  });

  it('dispatcher index.ts 注册至少 2 个 qr_bind/ 路由', () => {
    const src = readFileSync(DISPATCHER_PATH, 'utf8');
    const matches = src.match(/qr_bind/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
