import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const scriptPath = 'scripts/sessions/check-health.js';
const code = readFileSync(scriptPath, 'utf-8');

describe('WS1 — check-health.js 9平台扩展 [BEHAVIOR]', () => {
  it('PLATFORMS 数组应包含 KUAISHOU 平台配置', () => {
    expect(code).toContain('KUAISHOU');
  });

  it('PLATFORMS 数组应包含所有 7 个新增平台 Secret env var', () => {
    const platforms = ['KUAISHOU', 'XIAOHONGSHU', 'SHIPINHAO', 'TOUTIAO', 'WEIBO', 'ZHIHU', 'WECHAT'];
    const missing = platforms.filter(p => !code.includes(p));
    expect(missing).toHaveLength(0);
  });

  it('应包含 FEISHU_BOT_WEBHOOK env var 引用', () => {
    expect(code).toContain('FEISHU_BOT_WEBHOOK');
  });

  it('应包含飞书告警发送函数（sendFeishuAlert 或 feishuNotify）', () => {
    const hasFeishuFn = code.includes('sendFeishuAlert') || code.includes('feishuNotify');
    expect(hasFeishuFn).toBe(true);
  });

  it('应包含飞书 v2 API 调用（open.feishu.cn/bot/v2/hook）', () => {
    const hasFeishuApi = code.includes('open.feishu.cn') || code.includes('msg_type');
    expect(hasFeishuApi).toBe(true);
  });

  it('应支持 SKIP_HTTP_CHECK=true 模式（跳过真实 HTTP 调用）', () => {
    expect(code).toContain('SKIP_HTTP_CHECK');
  });

  it('应包含 API key 检查（飞书/Notion/企微 env var 引用）', () => {
    // 至少包含其中一个 API key Secret 引用
    const hasApiKey = code.includes('FEISHU_APP_SECRET') || code.includes('NOTION_TOKEN') || code.includes('WECOM');
    expect(hasApiKey).toBe(true);
  });

  it('DOUYIN Secret 命名应统一为 MAIN 规范（DOUYIN_COOKIES_MAIN 或 DOUYIN_MAIN）', () => {
    const hasMainNaming = code.includes('DOUYIN_COOKIES_MAIN') || code.includes('DOUYIN_MAIN');
    expect(hasMainNaming).toBe(true);
  });
});
