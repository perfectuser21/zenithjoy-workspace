/**
 * 全宽独立页面（不渲染 sidebar/header）路由判定
 *
 * Bug/需求：用户反馈"我们做的报告页是全屏的，现在挤在侧边栏旁边显示很别扭"——
 * /staff/skill-eval（Skill 评测上传 + 报告展示）之前跟普通业务页一样套着侧边栏
 * 布局，报告 iframe 被压缩在窄内容区里。改成跟 content-factory 输出页同款的
 * 全宽独立页面模式。
 */
import { describe, it, expect } from 'vitest';
import { isFullBleedPath } from '../full-bleed-routes';

describe('isFullBleedPath', () => {
  it('[BEHAVIOR] /staff/skill-eval 判定为全宽独立页面（不渲染侧边栏）', () => {
    expect(isFullBleedPath('/staff/skill-eval')).toBe(true);
  });

  it('/content-factory/:id/output 仍判定为全宽独立页面（既有行为不回归）', () => {
    expect(isFullBleedPath('/content-factory/abc123/output')).toBe(true);
    expect(isFullBleedPath('/content-factory/abc123/output/')).toBe(true);
  });

  it('普通业务页不是全宽独立页面', () => {
    expect(isFullBleedPath('/dashboard')).toBe(false);
    expect(isFullBleedPath('/staff')).toBe(false);
    expect(isFullBleedPath('/admin/customers')).toBe(false);
  });
});
