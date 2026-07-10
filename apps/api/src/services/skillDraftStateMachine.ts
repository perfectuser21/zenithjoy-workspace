/**
 * skill_drafts 状态机
 * 状态：idle → chatting → generating → done | error
 */
export type SkillDraftStatus = 'idle' | 'chatting' | 'generating' | 'done' | 'error';

const TRANSITIONS: Record<SkillDraftStatus, Partial<Record<string, SkillDraftStatus>>> = {
  idle: { SEND_MESSAGE: 'chatting', CREATE: 'chatting' },
  chatting: { GENERATE: 'generating', SEND_MESSAGE: 'chatting' },
  generating: { DONE: 'done', ERROR: 'error' },
  done: {},
  error: { SEND_MESSAGE: 'chatting' },
};

export function transition(current: SkillDraftStatus, action: string): SkillDraftStatus {
  return (TRANSITIONS[current]?.[action] as SkillDraftStatus) ?? current;
}
