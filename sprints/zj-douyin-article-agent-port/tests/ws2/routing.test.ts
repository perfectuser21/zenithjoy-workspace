// vitest globals injected
// Red state: 'article' 尚未加入 SUPPORTED_DOUYIN_TYPES → resolveDouyinScriptPath({type:'article'}) 仍 throw

const HANDLER_SRC = '/workspace/services/agent/src/handlers/douyin-publish.ts';

describe('douyin-publish.ts article 路由 [BEHAVIOR]', () => {
  it('SUPPORTED_DOUYIN_TYPES 源码包含字面字符串 article', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(HANDLER_SRC, 'utf8');
    // Red: 当前 SUPPORTED_DOUYIN_TYPES 不含 article
    const setBlock = src.match(/SUPPORTED_DOUYIN_TYPES[^;]+/s)?.[0] ?? '';
    expect(setBlock).toContain("'article'");
  });

  it('暂未实现注释不再阻断 article（article 不在 throw 错误消息中）', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(HANDLER_SRC, 'utf8');
    // 旧代码 throw 含 "article 暂未实现"
    const throwMsg = src.match(/throw.*article[^\n]*/)?.[0] ?? '';
    expect(throwMsg).toBe('');
  });

  it('publish-douyin-article 脚本路径字符串出现在 handler 中', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(HANDLER_SRC, 'utf8');
    expect(src).toMatch(/publish-douyin-article/);
  });

  it('publish-douyin-article-dryrun 脚本路径字符串出现在 handler 中', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(HANDLER_SRC, 'utf8');
    expect(src).toMatch(/publish-douyin-article-dryrun/);
  });
});
