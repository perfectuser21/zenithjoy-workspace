import { describe, it, expect } from 'vitest';
import { transition } from '../skillDraftStateMachine';

describe('skillDraftStateMachine — transition', () => {
  it('idle → chatting（CREATE/SEND_MESSAGE）', () => {
    expect(transition('idle', 'CREATE')).toBe('chatting');
    expect(transition('idle', 'SEND_MESSAGE')).toBe('chatting');
  });

  it('chatting → running（GENERATE，长跑改造后），chatting 收到 SEND_MESSAGE 保持 chatting', () => {
    expect(transition('chatting', 'GENERATE')).toBe('running');
    expect(transition('chatting', 'SEND_MESSAGE')).toBe('chatting');
  });

  it('generating → done（DONE）/ error（ERROR）（legacy alias，兼容旧数据）', () => {
    expect(transition('generating', 'DONE')).toBe('done');
    expect(transition('generating', 'ERROR')).toBe('error');
  });

  it('running → done（DONE）/ error（ERROR）/ needs_input（NEEDS_INPUT）', () => {
    expect(transition('running', 'DONE')).toBe('done');
    expect(transition('running', 'ERROR')).toBe('error');
    expect(transition('running', 'NEEDS_INPUT')).toBe('needs_input');
  });

  it('needs_input → running（ANSWER）/ error（ERROR）', () => {
    expect(transition('needs_input', 'ANSWER')).toBe('running');
    expect(transition('needs_input', 'ERROR')).toBe('error');
  });

  it('done 是终态，任何 action 都不再转移', () => {
    expect(transition('done', 'SEND_MESSAGE')).toBe('done');
    expect(transition('done', 'GENERATE')).toBe('done');
  });

  it('error → chatting（SEND_MESSAGE，允许用户重新发起对话）', () => {
    expect(transition('error', 'SEND_MESSAGE')).toBe('chatting');
  });

  it('未知 action 不改变当前状态', () => {
    expect(transition('chatting', 'UNKNOWN_ACTION')).toBe('chatting');
  });
});
