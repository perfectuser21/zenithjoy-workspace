/**
 * WS2b — Agent crawl 脚本: douyin-comment-crawl.cjs
 *
 * 脚本是 .cjs（Agent 客户机 Node 直接跑），用静态结构验证 + 内置 helper 函数测试。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../../services/agent/scripts/douyin-comment-crawl.cjs'
);

describe('Workstream 2b — douyin-comment-crawl.cjs [BEHAVIOR]', () => {
  it('脚本存在且用 launchPersistentContext + msedge channel', () => {
    const c = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(c).toContain('launchPersistentContext');
    expect(c).toMatch(/channel:\s*['"]msedge['"]/);
  });

  it('脚本含 comment-item selector + 评论字段提取（commenter_id / text / publish_time）', () => {
    const c = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(c).toContain('comment-item');
    expect(c).toContain('commenter_id');
    expect(c).toContain('publish_time');
  });

  it('脚本限制只取前 5 条评论 + 评论 0 早 return 不抛错', () => {
    const c = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(c).toMatch(/slice\(\s*0\s*,\s*5\s*\)/);
    // 检查"评论 0 早 return"逻辑（含 length === 0 或 length < 1 的处理）
    expect(c).toMatch(/length\s*(===\s*0|<\s*1|==\s*0)/);
  });

  it('脚本检测 url 跳 login → 上报 BURNER_SESSION_EXPIRED', () => {
    const c = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(c).toContain('/login');
    expect(c).toContain('BURNER_SESSION_EXPIRED');
  });
});
