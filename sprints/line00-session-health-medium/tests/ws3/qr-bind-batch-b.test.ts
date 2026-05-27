import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('WS3 — Agent qr-bind batch B（头条/微博/知乎）[BEHAVIOR]', () => {
  const handlers = [
    { file: 'services/agent/src/handlers/qr-bind-toutiao.ts', domain: 'mp.toutiao.com', platform: 'toutiao' },
    { file: 'services/agent/src/handlers/qr-bind-weibo.ts', domain: 'weibo.com', platform: 'weibo' },
    { file: 'services/agent/src/handlers/qr-bind-zhihu.ts', domain: 'zhihu.com', platform: 'zhihu' },
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
  }
});
