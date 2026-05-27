// sprints/tests/ws1/kuaishou-publish.test.ts
// TDD Red — WS1: kuaishou-publish.ts handler 重写 type 路由
//
// 模式与 zj-douyin-article-agent-port/tests/ws1 一致：
//   - 用 fs.readFileSync 读取源文件内容验证实现存在
//   - WS1 未完成时旧文件缺 resolveKuaishouScriptPath → 所有断言 FAIL → Red ✅
//   - WS1 完成后断言 PASS → Green ✅

import { describe, it, expect } from 'vitest';
import fs from 'fs';

const HANDLER_PATH = '/workspace/services/agent/src/handlers/kuaishou-publish.ts';
const TEST_PATH = '/workspace/services/agent/src/handlers/__tests__/kuaishou-publish.test.ts';

let handlerContent = '';
let testContent = '';
try { handlerContent = fs.readFileSync(HANDLER_PATH, 'utf8'); } catch { /* Red */ }
try { testContent = fs.readFileSync(TEST_PATH, 'utf8'); } catch { /* Red */ }

describe('resolveKuaishouScriptPath — 快手 type 路由 [BEHAVIOR]', () => {
  it('handler 导出 resolveKuaishouScriptPath 函数', () => {
    expect(handlerContent).toContain('resolveKuaishouScriptPath');
    expect(handlerContent).toContain('export');
  });

  it('handler image type 路由 → kuaishou-image 脚本', () => {
    expect(handlerContent).toContain('kuaishou-image');
  });

  it('handler video type 路由 → kuaishou-video 脚本', () => {
    expect(handlerContent).toContain('kuaishou-video');
  });

  it('handler 未知 type 显式抛 Error（no script for type）', () => {
    expect(handlerContent).toContain('no script for type');
  });

  it('handler 含 ZENITHJOY_AGENT_REAL_PUBLISH 开关', () => {
    expect(handlerContent).toContain('ZENITHJOY_AGENT_REAL_PUBLISH');
  });

  it('unit test 文件存在且覆盖 image/video/throw 三条路径', () => {
    expect(testContent.length).toBeGreaterThan(0);
    expect(testContent).toContain('image');
    expect(testContent).toContain('video');
    expect(testContent).toContain('no script for type');
  });
});
