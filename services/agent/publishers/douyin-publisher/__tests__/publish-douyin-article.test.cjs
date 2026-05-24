// vitest globals: describe, it, expect are injected (globals: true in vitest config)
// Red: publish-douyin-article.cjs 尚未创建 → require 抛 MODULE_NOT_FOUND → 所有 it() 失败

const fs = require('fs');
const path = require('path');

// 顶层 require 不加 try/catch — RED 时 node 直跑此文件必然输出 Cannot find module
require('../publish-douyin-article.cjs');
require('../publish-douyin-article-dryrun.cjs');

const ARTICLE_CJS = path.resolve(__dirname, '../publish-douyin-article.cjs');
const DRYRUN_CJS = path.resolve(__dirname, '../publish-douyin-article-dryrun.cjs');

describe('publish-douyin-article.cjs [BEHAVIOR] — CDP 文章发布', () => {
  it('DOM.setFileInputFiles + backendNodeId — 封面上传走 CDP（非旧式 SCP）', () => {
    const src = fs.readFileSync(ARTICLE_CJS, 'utf8');
    expect(src).toMatch(/DOM\.setFileInputFiles/);
    expect(src).toMatch(/backendNodeId/);
  });

  it('cover fail fast — 含 existsSync 检查，cover 不存在时提前退出', () => {
    const src = fs.readFileSync(ARTICLE_CJS, 'utf8');
    expect(src).toMatch(/existsSync|ENOENT/);
  });

  it('summary 缺省截取 — 含 content.substring(0, 30)', () => {
    const src = fs.readFileSync(ARTICLE_CJS, 'utf8');
    expect(src).toMatch(/content\.substring\(0,\s*30\)|content\.slice\(0,\s*30\)/);
  });

  it('无 button:has-text（XPath 规则）', () => {
    const src = fs.readFileSync(ARTICLE_CJS, 'utf8');
    expect(src).not.toMatch(/button:has-text/);
  });

  it('error path — ok:false 输出路径存在', () => {
    const src = fs.readFileSync(ARTICLE_CJS, 'utf8');
    expect(src).toMatch(/ok.*false|"ok":.*false/);
  });
});

describe('publish-douyin-article-dryrun.cjs [BEHAVIOR]', () => {
  it('dryrun 输出含 dryRun:true', () => {
    const src = fs.readFileSync(DRYRUN_CJS, 'utf8');
    expect(src).toMatch(/"dryRun".*true|dryRun: true/);
  });

  it('dryrun 不含 create_v2 / aweme/create 发布 API', () => {
    const src = fs.readFileSync(DRYRUN_CJS, 'utf8');
    expect(src).not.toMatch(/create_v2|aweme\/create/);
  });

  it('dryrun 无 button:has-text（XPath 规则）', () => {
    const src = fs.readFileSync(DRYRUN_CJS, 'utf8');
    expect(src).not.toMatch(/button:has-text/);
  });
});
