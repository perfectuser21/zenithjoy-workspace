// sprints/tests/ws2/kuaishou-image-dryrun.test.ts
// TDD Red — WS2: publish-kuaishou-image-dryrun.cjs 三模式升级
//
// 旧文件不含 addCookies / KUAISHOU_COOKIES / kuaishou-image- → Red ✅
// WS2 完成后断言 PASS → Green ✅

import { describe, it, expect } from 'vitest';
import fs from 'fs';

const SCRIPT_PATH = '/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs';

let content = '';
try { content = fs.readFileSync(SCRIPT_PATH, 'utf8'); } catch { /* Red */ }

describe('publish-kuaishou-image-dryrun.cjs 三模式升级 [BEHAVIOR]', () => {
  it('含 KUAISHOU_COOKIES env 读取', () => {
    expect(content).toContain('KUAISHOU_COOKIES');
  });

  it('含 addCookies cookie 注入调用（Playwright API）', () => {
    expect(content).toContain('addCookies');
  });

  it('CDP 端口为 19223', () => {
    expect(content).toContain('19223');
  });

  it('不含抖音端口 19222（端口隔离）', () => {
    expect(content).not.toContain('19222');
  });

  it('截图命名含 kuaishou-image- 前缀', () => {
    expect(content).toContain('kuaishou-image-');
  });
});
