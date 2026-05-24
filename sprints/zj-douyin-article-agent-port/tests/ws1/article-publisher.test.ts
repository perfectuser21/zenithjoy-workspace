// vitest globals: describe, it, expect, vi are injected by vitest (globals: true in config)
// Red state: publish-douyin-article.cjs 尚未创建 — require 抛 MODULE_NOT_FOUND → 6+ failures
// Round 2: ws4 测试职责并入 ws1（test_is_red 修复）

const ARTICLE_CJS = '/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs';
const DRYRUN_CJS = '/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs';

let articleModule: Record<string, unknown> | undefined;
let dryrunModule: Record<string, unknown> | undefined;

try {
  articleModule = require(ARTICLE_CJS);
} catch {
  // Red: file does not exist yet
}
try {
  dryrunModule = require(DRYRUN_CJS);
} catch {
  // Red: file does not exist yet
}

describe('publish-douyin-article.cjs [BEHAVIOR]', () => {
  it('模块可以 require，不抛 MODULE_NOT_FOUND', () => {
    expect(articleModule).toBeDefined();
  });

  it('DOM.setFileInputFiles — 脚本含 backendNodeId CDP 封面上传调用', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(ARTICLE_CJS, 'utf8');
    expect(src).toMatch(/DOM\.setFileInputFiles/);
    expect(src).toMatch(/backendNodeId/);
  });

  it('cover fail fast — 传入不存在路径时包含 existsSync 检查', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(ARTICLE_CJS, 'utf8');
    expect(src).toMatch(/existsSync|ENOENT|cover.*not found|cover.*exist/);
  });

  it('summary 缺省截取 — 含 content.substring(0, 30) 或 content.slice(0, 30)', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(ARTICLE_CJS, 'utf8');
    expect(src).toMatch(/content\.substring\(0,\s*30\)|content\.slice\(0,\s*30\)/);
  });
});

describe('publish-douyin-article-dryrun.cjs [BEHAVIOR]', () => {
  it('dryrun 模块可以 require', () => {
    expect(dryrunModule).toBeDefined();
  });

  it('dryrun 含 dryRun:true 输出路径', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(DRYRUN_CJS, 'utf8');
    expect(src).toMatch(/"dryRun".*true|dryRun: true/);
  });

  it('dryrun 不含 create_v2 / aweme/create 发布 API', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(DRYRUN_CJS, 'utf8');
    expect(src).not.toMatch(/create_v2|aweme\/create/);
  });

  it('两个脚本均无 button:has-text（XPath 规则）', () => {
    const fs = require('fs');
    const a: string = fs.readFileSync(ARTICLE_CJS, 'utf8');
    const b: string = fs.readFileSync(DRYRUN_CJS, 'utf8');
    expect(a).not.toMatch(/button:has-text/);
    expect(b).not.toMatch(/button:has-text/);
  });
});

// ws4 并入 ws1 — TDD commit-1 产出：测试文件须在 commit-1 写好，commit-2 写 cjs 实现后变绿
// Red: 文件不存在 → 2 failures
const TEST_CJS = '/workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs';

describe('publish-douyin-article.test.cjs 存在性 [BEHAVIOR]（ws4 内化）', () => {
  it('TDD commit-1 产出 — 测试文件存在于 vitest include 路径下', () => {
    const fs = require('fs');
    expect(fs.existsSync(TEST_CJS)).toBe(true);
  });

  it('测试文件含 ≥3 个 it() 块（覆盖 dryrun/fail-fast/summary）', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(TEST_CJS, 'utf8');
    const count = (src.match(/\bit\(/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
