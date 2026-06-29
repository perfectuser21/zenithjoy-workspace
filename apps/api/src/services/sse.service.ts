import type { Request, Response } from 'express';

const connections = new Map<string, Set<Response>>();

function send(res: Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function unsubscribe(taskId: string, res: Response): void {
  const subs = connections.get(taskId);
  if (!subs) return;
  subs.delete(res);
  if (subs.size === 0) connections.delete(taskId);
}

export const sseService = {
  subscribe(taskId: string, req: Request, res: Response, initialData: object): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    send(res, initialData);

    if (!connections.has(taskId)) connections.set(taskId, new Set());
    connections.get(taskId)!.add(res);

    req.on('close', () => unsubscribe(taskId, res));
  },

  emit(taskId: string, data: object): void {
    const subs = connections.get(taskId);
    if (!subs) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of subs) {
      try { res.write(payload); } catch { /* client disconnected */ }
    }
  },

  close(taskId: string, finalData?: object): void {
    const subs = connections.get(taskId);
    if (!subs) return;
    for (const res of subs) {
      try {
        if (finalData) send(res, finalData);
        res.end();
      } catch { /* client disconnected */ }
    }
    connections.delete(taskId);
  },
};
