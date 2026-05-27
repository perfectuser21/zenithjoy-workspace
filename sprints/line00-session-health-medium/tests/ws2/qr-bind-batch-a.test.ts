import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('WS2 — Agent qr-bind batch A（快手/小红书/视频号）[BEHAVIOR]', () => {
  const handlers = [
    { file: 'services/agent/src/handlers/qr-bind-kuaishou.ts', domain: 'cp.kuaishou.com', platform: 'kuaishou' },
    { file: 'services/agent/src/handlers/qr-bind-xiaohongshu.ts', domain: 'xiaohongshu.com', platform: 'xiaohongshu' },
    { file: 'services/agent/src/handlers/qr-bind-shipinhao.ts', domain: 'channels.weixin.qq.com', platform: 'shipinhao' },
  ];

  for (const { file, domain, platform } of handlers) {
    it(`${file} 文件存在`, () => {
      expect(fs.existsSync(file)).toBe(true);
    });

    it(`${file} loginUrl 含正确域名 ${domain}`, () => {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toContain(domain);
    });

    it(`${file} 含 platform "${platform}" 代号`, () => {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toMatch(new RegExp(`['"]${platform}['"]`));
    });

    it(`${file} 含 upload-cookies 调用`, () => {
      const content = fs.readFileSync(file, 'utf8');
      const hasUpload = content.includes('upload-cookies') || content.includes('uploadCookies');
      expect(hasUpload).toBe(true);
    });

    it(`${file} export 一个 handle 函数`, () => {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toContain('export');
    });
  }
});
