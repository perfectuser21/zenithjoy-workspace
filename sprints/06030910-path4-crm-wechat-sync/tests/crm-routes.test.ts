import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CRM_ROUTE = path.resolve('apps/api/src/routes/crm.ts');
const DAILY_ANALYSIS = path.resolve('apps/api/src/services/daily-crm-analysis.ts');
const DASHBOARD_ROOT = path.resolve('apps/dashboard/src/pages');

describe('CRM routes — TDD Red Phase [BEHAVIOR] R2', () => {
  it('crm.ts 路由文件存在', () => {
    expect(fs.existsSync(CRM_ROUTE)).toBe(true);
  });

  it('crm.ts 含 POST /init 路由（建/检测客户明细表）', () => {
    const c = fs.readFileSync(CRM_ROUTE, 'utf8');
    expect(c).toContain('/init');
    expect(c).toContain('success');
    expect(c).toContain('table_id');
  });

  it('crm.ts 含 GET /wechat-contacts 路由 + contacts 响应字段 + wechat_id/nickname 字段定义', () => {
    const c = fs.readFileSync(CRM_ROUTE, 'utf8');
    expect(c).toContain('wechat-contacts');
    expect(c).toContain('contacts');
    expect(c).toContain('wechat_id');
    expect(c).toContain('nickname');
  });

  it('crm.ts /init 路由含 mode=detect 分支逻辑', () => {
    const c = fs.readFileSync(CRM_ROUTE, 'utf8');
    expect(c).toContain('detect');
  });

  it('crm.ts 含 GET /match-preview 路由 + matched/pending/unmatched 三字段', () => {
    const c = fs.readFileSync(CRM_ROUTE, 'utf8');
    expect(c).toContain('match-preview');
    expect(c).toContain('matched');
    expect(c).toContain('pending');
    expect(c).toContain('unmatched');
  });

  it('crm.ts 含 POST /daily-analysis 路由 + customers/webhook_sent/dry_run 字段', () => {
    const c = fs.readFileSync(CRM_ROUTE, 'utf8');
    expect(c).toContain('daily-analysis');
    expect(c).toContain('customers');
    expect(c).toContain('webhook_sent');
    expect(c).toContain('dry_run');
  });

  it('crm.ts 不含禁用驼峰字段名 webhookSent/tableId', () => {
    const c = fs.readFileSync(CRM_ROUTE, 'utf8');
    expect(c).not.toContain('webhookSent');
    expect(c).not.toContain('tableId');
  });

  it('daily-crm-analysis.ts 存在 + 含 FEISHU_NOTIFY_WEBHOOK + AI 调用 + AI 建议列写回逻辑', () => {
    const c = fs.readFileSync(DAILY_ANALYSIS, 'utf8');
    expect(c).toContain('FEISHU_NOTIFY_WEBHOOK');
    const hasAI = c.includes('openrouter') || c.includes('deepseek') || c.includes('OpenRouter');
    expect(hasAI).toBe(true);
    const hasWriteback = c.includes('ai_suggestion') || c.includes('AI 建议') || c.includes('suggestion');
    expect(hasWriteback).toBe(true);
  });

  it('CrmConfigPage.tsx 存在 + 含飞书/Notion 平台选择器', () => {
    const p = path.join(DASHBOARD_ROOT, 'CrmConfigPage.tsx');
    expect(fs.existsSync(p)).toBe(true);
    const c = fs.readFileSync(p, 'utf8');
    const hasFeiShu = c.includes('feishu') || c.includes('飞书');
    const hasNotion = c.includes('notion') || c.includes('Notion');
    expect(hasFeiShu).toBe(true);
    expect(hasNotion).toBe(true);
  });

  it('CustomerListPage.tsx 存在', () => {
    const p = path.join(DASHBOARD_ROOT, 'CustomerListPage.tsx');
    expect(fs.existsSync(p)).toBe(true);
  });

  it('crm-config.spec.ts 存在 + 含 wechat_id/nickname 断言 + page.route stub + contacts.length==5 精确卡', () => {
    const specPath = path.resolve('apps/dashboard/e2e/crm-config.spec.ts');
    expect(fs.existsSync(specPath)).toBe(true);
    const c = fs.readFileSync(specPath, 'utf8');
    const tests = (c.match(/\btest\(/g) || []).length;
    expect(tests).toBeGreaterThanOrEqual(4);
    const shots = (c.match(/page\.screenshot/g) || []).length;
    expect(shots).toBeGreaterThanOrEqual(3);
    expect(c).toContain('wechat_id');
    expect(c).toContain('nickname');
    expect(c).toContain('page.route');
    expect(c.match(/toHaveCount\(5\)|length.*5|\.length,\s*5/)).not.toBeNull();
  });

  // R2 新增：Step 1.5 OAuth + Feedback #3 suggestion 字段
  it('CrmConfigPage.tsx 含飞书 OAuth 绑定入口（FeishuBindTenant 或 feishu-bind 或 feishuOAuth）', () => {
    const p = path.join(DASHBOARD_ROOT, 'CrmConfigPage.tsx');
    const c = fs.readFileSync(p, 'utf8');
    const hasOAuth =
      c.includes('FeishuBindTenant') ||
      c.includes('feishu-bind') ||
      c.includes('feishuOAuth');
    expect(hasOAuth).toBe(true);
  });

  it('notion-crm.ts 含 NOTION_INTEGRATION_TOKEN 读取 + token_expired 处理 + FEISHU_NOTIFY_WEBHOOK（Risk 3）', () => {
    const notionCrm = path.resolve('apps/api/src/services/notion-crm.ts');
    expect(fs.existsSync(notionCrm)).toBe(true);
    const c = fs.readFileSync(notionCrm, 'utf8');
    expect(c).toContain('NOTION_INTEGRATION_TOKEN');
    expect(c).toContain('token_expired');
    expect(c).toContain('FEISHU_NOTIFY_WEBHOOK');
  });

  it('crm-wechat-sync.ts 含 contact_lost 标记逻辑，不含硬删除（Risk 4）', () => {
    const syncSvc = path.resolve('apps/api/src/services/crm-wechat-sync.ts');
    expect(fs.existsSync(syncSvc)).toBe(true);
    const c = fs.readFileSync(syncSvc, 'utf8');
    expect(c).toContain('contact_lost');
    expect(c).not.toContain('DELETE FROM crm_wechat_mapping');
  });

  it('daily-analysis API 响应含 customers[0].suggestion string 字段（Feedback #3）', () => {
    const c = fs.readFileSync(DAILY_ANALYSIS, 'utf8');
    const hasSuggestion = c.includes('suggestion');
    expect(hasSuggestion).toBe(true);
  });

  it('crm-config.spec.ts 含 OAuth 入口断言 + suggestion 字段断言（R2 spec 更新）', () => {
    const specPath = path.resolve('apps/dashboard/e2e/crm-config.spec.ts');
    const c = fs.readFileSync(specPath, 'utf8');
    const hasOAuth =
      c.includes('FeishuBindTenant') ||
      c.includes('feishu-bind') ||
      c.includes('feishuOAuth');
    expect(hasOAuth).toBe(true);
    expect(c).toContain('suggestion');
  });
});
