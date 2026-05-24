// vitest globals injected
// Red state: publish-douyin-article.test.cjs 尚未创建 → 1 failure

const TEST_CJS = '/workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs';

describe('publish-douyin-article.test.cjs 测试套件 [BEHAVIOR]', () => {
  it('测试文件存在于 vitest include 路径下', () => {
    const fs = require('fs');
    // Red: 文件尚未创建
    expect(fs.existsSync(TEST_CJS)).toBe(true);
  });

  it('测试文件含 ≥3 个 it() 块', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(TEST_CJS, 'utf8');
    const count = (src.match(/\bit\(/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('测试文件 require publish-douyin-article.cjs（不是 image/video）', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(TEST_CJS, 'utf8');
    expect(src).toMatch(/publish-douyin-article/);
    expect(src).not.toMatch(/publish-douyin-image|publish-douyin-video/);
  });

  it('测试文件覆盖 dryRun 场景', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(TEST_CJS, 'utf8');
    expect(src).toMatch(/dryRun/);
  });

  it('测试文件覆盖 cover fail fast 场景', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(TEST_CJS, 'utf8');
    expect(src).toMatch(/cover|existsSync|fail fast|ENOENT/i);
  });
});
