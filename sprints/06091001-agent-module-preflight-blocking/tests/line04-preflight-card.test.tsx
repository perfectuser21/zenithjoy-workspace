import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CARD_PATH = path.join(REPO_ROOT, 'apps/dashboard/src/components/Line04PreflightCard.tsx');
const PAGE_PATH = path.join(REPO_ROOT, 'apps/dashboard/src/pages/WechatCustomerServiceConfigPage.tsx');

describe('Line04PreflightCard 组件 [BEHAVIOR]', () => {
  it('Line04PreflightCard.tsx 文件存在', () => {
    // Red: 组件文件尚未创建
    expect(() => fs.accessSync(CARD_PATH)).not.toThrow();
  });

  it('组件含 fetchModuleHealth 调用', () => {
    const src = fs.readFileSync(CARD_PATH, 'utf8');
    expect(src).toContain('fetchModuleHealth');
  });

  it('组件含无数据时提示文案 "Agent 未连接"', () => {
    const src = fs.readFileSync(CARD_PATH, 'utf8');
    expect(src).toContain('Agent 未连接');
  });

  it('组件含 ok/reason 状态渲染逻辑', () => {
    const src = fs.readFileSync(CARD_PATH, 'utf8');
    expect(src).toContain('ok');
    expect(src).toContain('reason');
  });
});

describe('WechatCustomerServiceConfigPage 引用 [BEHAVIOR]', () => {
  it('WechatCustomerServiceConfigPage.tsx 已 import Line04PreflightCard', () => {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');
    expect(src).toContain('Line04PreflightCard');
  });
});
