/**
 * draftGuard 全局草稿哨兵单元测试。切企业前据它判断是否有未提交草稿、要不要拦截。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { markDraftDirty, hasUnsavedDraft, clearAllDrafts } from './draftGuard';

beforeEach(() => clearAllDrafts());

describe('draftGuard', () => {
  it('初始无草稿', () => {
    expect(hasUnsavedDraft()).toBe(false);
  });

  it('markDraftDirty(true) 后有草稿；(false) 后抹掉', () => {
    markDraftDirty('grid', true);
    expect(hasUnsavedDraft()).toBe(true);
    markDraftDirty('grid', false);
    expect(hasUnsavedDraft()).toBe(false);
  });

  it('多来源各自登记，互不覆盖', () => {
    markDraftDirty('grid', true);
    markDraftDirty('other', true);
    markDraftDirty('grid', false);
    // other 仍脏
    expect(hasUnsavedDraft()).toBe(true);
    markDraftDirty('other', false);
    expect(hasUnsavedDraft()).toBe(false);
  });

  it('clearAllDrafts 一次清空全部（用户放弃草稿后整页重拉前调用）', () => {
    markDraftDirty('a', true);
    markDraftDirty('b', true);
    clearAllDrafts();
    expect(hasUnsavedDraft()).toBe(false);
  });
});
