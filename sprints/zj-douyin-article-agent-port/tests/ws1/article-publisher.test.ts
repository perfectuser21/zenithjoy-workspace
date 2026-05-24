// vitest globals: describe, it, expect, vi are injected by vitest (globals: true in config)
// Red state: publish-douyin-article.cjs 尚未创建 — require 抛 MODULE_NOT_FOUND → 4 failures

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
