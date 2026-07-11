/**
 * skill_drafts 状态机
 *
 * 原状态（sprints/07091721）：idle → chatting → generating → done | error
 * 长跑改造（sprints/07101942）：chatting → running → done | error | needs_input
 *                                                    needs_input → running（answer）
 *
 * 新状态枚举：chatting | running | needs_input | done | error
 * 旧状态 idle/generating 保留兼容，不对外暴露新逻辑。
 */
export type SkillDraftStatus =
  | 'idle'
  | 'chatting'
  | 'generating' // legacy alias（保留兼容旧数据）
  | 'running'
  | 'needs_input'
  | 'done'
  | 'error';

const TRANSITIONS: Record<SkillDraftStatus, Partial<Record<string, SkillDraftStatus>>> = {
  idle: { SEND_MESSAGE: 'chatting', CREATE: 'chatting' },
  chatting: { GENERATE: 'running', SEND_MESSAGE: 'chatting' },
  generating: { DONE: 'done', ERROR: 'error' }, // legacy
  running: { DONE: 'done', ERROR: 'error', NEEDS_INPUT: 'needs_input' },
  needs_input: { ANSWER: 'running', ERROR: 'error' },
  done: {},
  error: { SEND_MESSAGE: 'chatting', GENERATE: 'running' },
};

/**
 * 合法状态集合：这些状态允许 GENERATE 触发（chatting 和 error 可以重试）
 */
export const GENERATE_ALLOWED: Set<SkillDraftStatus> = new Set(['chatting', 'error']);

/**
 * 互斥状态集合：这些状态下 GENERATE 被拒绝（409）
 */
export const GENERATE_BLOCKED: Set<SkillDraftStatus> = new Set(['running', 'needs_input', 'done']);

export function transition(current: SkillDraftStatus, action: string): SkillDraftStatus {
  return (TRANSITIONS[current]?.[action] as SkillDraftStatus) ?? current;
}
