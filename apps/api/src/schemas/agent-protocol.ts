import { z } from 'zod';

const Envelope = {
  v: z.literal(1),
  msgId: z.string().min(1),
  taskId: z.string().optional(),
  ts: z.number().int(),
};

// === Agent → Server ===

export const SkillStatusItem = z.object({
  slug: z.string(),
  status: z.enum(['ready', 'login_expired', 'unavailable', 'unknown']),
  error: z.string().optional(),
});
export type SkillStatusItem = z.infer<typeof SkillStatusItem>;

export const HelloPayload = z.object({
  agentId: z.string(),
  version: z.string(),
  capabilities: z.array(z.string()),
  skills: z.array(SkillStatusItem).optional(),
});

export const HeartbeatPayload = z.object({
  uptime: z.number(),
  busy: z.boolean(),
});

export const TaskProgressPayload = z.object({
  stage: z.string(),
  pct: z.number().min(0).max(100),
});

export const TaskResultPayload = z.object({
  ok: z.boolean(),
  publishId: z.string().optional(),
  mediaId: z.string().optional(),
  error: z.string().optional(),
});

export const AgentMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...Envelope, type: z.literal('hello'), payload: HelloPayload }),
  z.object({ ...Envelope, type: z.literal('heartbeat'), payload: HeartbeatPayload }),
  z.object({ ...Envelope, type: z.literal('task_progress'), payload: TaskProgressPayload }),
  z.object({ ...Envelope, type: z.literal('task_result'), payload: TaskResultPayload }),
]);

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// === Server → Agent ===
export const PublishRequestPayload = z.object({
  platform: z.enum(['wechat']),
  content: z.object({
    title: z.string(),
    body: z.string(),
    digest: z.string().optional(),
    author: z.string().optional(),
  }),
});

export const TaskCancelPayload = z.object({
  reason: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...Envelope, type: z.literal('publish_request'), payload: PublishRequestPayload }),
  z.object({ ...Envelope, type: z.literal('task_cancel'), payload: TaskCancelPayload }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// helper
export function makeMsg<T extends { type: string; payload: unknown }>(
  type: T['type'], payload: T['payload'], taskId?: string
): { v: 1; type: T['type']; msgId: string; taskId?: string; ts: number; payload: T['payload'] } {
  return {
    v: 1, type, msgId: crypto.randomUUID(),
    ...(taskId ? { taskId } : {}),
    ts: Date.now(), payload,
  };
}
