// sprints/tests/ws3/kuaishou-video-dryrun.test.ts
// TDD Red — WS3: publish-kuaishou-video-dryrun.cjs 新建
//
// 文件不存在 → readFileSync 抛 ENOENT → content 为空 → 所有断言 FAIL → Red ✅
// WS3 完成后文件存在且断言 PASS → Green ✅

import { describe, it, expect } from 'vitest';
import fs from 'fs';

const SCRIPT_PATH = '/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs';

let content = '';
try { content = fs.readFileSync(SCRIPT_PATH, 'utf8'); } catch { /* Red: file not exist */ }

describe('publish-kuaishou-video-dryrun.cjs 新建 [BEHAVIOR]', () => {
  it('文件存在（readFileSync 不抛 → content 非空）', () => {
    expect(content.length).toBeGreaterThan(0);
  });

  it('含视频发布 URL article/publish/video', () => {
    expect(content).toContain('article/publish/video');
  });

  it('含 /rest/cp/works/ API 拦截逻辑', () => {
    expect(content).toContain('/rest/cp/works/');
  });

  it('含 KUAISHOU_COOKIES env 读取', () => {
    expect(content).toContain('KUAISHOU_COOKIES');
  });

  it('含 addCookies cookie 注入（三模式首选）', () => {
    expect(content).toContain('addCookies');
  });

  it('CDP 端口为 19223，不含抖音端口 19222', () => {
    expect(content).toContain('19223');
    expect(content).not.toContain('19222');
  });

  it('截图命名含 kuaishou-video- 前缀', () => {
    expect(content).toContain('kuaishou-video-');
  });
});
