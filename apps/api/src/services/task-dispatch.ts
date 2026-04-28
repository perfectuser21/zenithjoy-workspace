import { agentRegistry } from './agent-registry';
import { sendToAgent } from './agent-ws';
import { makeMsg } from '../schemas/agent-protocol';
import { startTask, finishTask, failTask } from './task-db';
import type { Task } from './task-db';
import type { z } from 'zod';
import type { TaskResultPayload } from '../schemas/agent-protocol';

// wsTaskId → DB task.id (in-memory correlation map)
const pendingTasks = new Map<string, string>();

export async function dispatchTask(task: Task): Promise<void> {
  // Map skill to platform capability: 'wechat_draft' → 'wechat'
  const capability = task.skill.split('_')[0];
  const agent = agentRegistry.pickFor(capability);
  if (!agent) {
    await failTask(task.id, `no agent online with capability: ${capability}`);
    return;
  }

  const wsTaskId = `wstask-${task.id}`;
  pendingTasks.set(wsTaskId, task.id);

  const sent = sendToAgent(agent.agentId, makeMsg('publish_request', {
    platform: capability as any,
    content: task.params as any,
  }, wsTaskId));

  if (!sent) {
    pendingTasks.delete(wsTaskId);
    await failTask(task.id, `agent ${agent.agentId} unreachable`);
    return;
  }

  await startTask(task.id, agent.agentId);
}

export async function handleTaskResult(
  wsTaskId: string,
  payload: z.infer<typeof TaskResultPayload>
): Promise<void> {
  const dbTaskId = pendingTasks.get(wsTaskId);
  if (!dbTaskId) return;
  pendingTasks.delete(wsTaskId);

  if (payload.ok) {
    await finishTask(dbTaskId, payload as Record<string, unknown>);
  } else {
    await failTask(dbTaskId, payload.error || 'unknown error');
  }
}
