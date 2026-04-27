// services/agent/src/handlers/wechat-publish.ts
export async function handleWechatPublish(
  taskId: string,
  content: { title: string; body: string },
  emit: (msg: any) => void,
  makeMsg: (type: string, payload: any, taskId?: string) => any,
): Promise<void> {
  emit(makeMsg('task_progress', { stage: 'starting', pct: 10 }, taskId));
  await new Promise(r => setTimeout(r, 500));
  emit(makeMsg('task_progress', { stage: 'mock_publishing', pct: 50 }, taskId));
  await new Promise(r => setTimeout(r, 500));
  // v0.1 mock: 不真发，只回成功
  emit(makeMsg('task_result', { ok: true, mediaId: 'mock-media-' + Date.now() }, taskId));
}
