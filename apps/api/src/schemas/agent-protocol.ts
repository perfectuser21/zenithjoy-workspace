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
  agentUuid: z.string().uuid().optional(), // H-2 Bug 9: 新 Agent 复用 register 时已创的 row UUID
  hostname: z.string().optional(),         // 身份统一：让中台按 (tenant_id, hostname) 去重，不再裂行
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

// OpenClaw 信号桥·件2：设备指令回执（件1 CommandProtocol.buildResult 上行）。
// 注意关联键不在顶层——设备端 sendResult 的信封 msgId 是新生成的，原请求 id 在
// payload.inReplyTo（WsClient.kt sendResult / Explore 实证）。payload 宽松 passthrough，
// 设备端加字段不拒（向前兼容）。
export const CmdResultPayload = z.object({
  inReplyTo: z.string().optional(),
  ok: z.boolean().optional(),
  errorCode: z.string().optional(),
  foregroundPkg: z.string().nullable().optional(),
  data: z.record(z.unknown()).optional(),
}).passthrough();
export type CmdResultPayload = z.infer<typeof CmdResultPayload>;

export const AgentMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...Envelope, type: z.literal('hello'), payload: HelloPayload }),
  z.object({ ...Envelope, type: z.literal('heartbeat'), payload: HeartbeatPayload }),
  z.object({ ...Envelope, type: z.literal('task_progress'), payload: TaskProgressPayload }),
  z.object({ ...Envelope, type: z.literal('task_result'), payload: TaskResultPayload }),
  z.object({ ...Envelope, type: z.literal('cmd_result'), payload: CmdResultPayload }),
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
  // H-1 ws3: server 派 task 时填 agent_id (UUID = agents.id) — agent 端验"派给我"
  // optional 兼容老 v1.0 server 不发此字段
  agent_id: z.string().uuid().optional(),
});

export const TaskCancelPayload = z.object({
  reason: z.string(),
});

// OpenClaw 信号桥·件2：指令下行。args 与 action 平铺在 payload 里（设备端
// CommandProtocol.parse 直接读 payload["action"] / payload["x"] 等），宽松 passthrough。
export const CmdPayload = z.object({ action: z.string() }).passthrough();
export type CmdPayload = z.infer<typeof CmdPayload>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...Envelope, type: z.literal('publish_request'), payload: PublishRequestPayload }),
  z.object({ ...Envelope, type: z.literal('task_cancel'), payload: TaskCancelPayload }),
  z.object({ ...Envelope, type: z.literal('cmd'), payload: CmdPayload }),
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
