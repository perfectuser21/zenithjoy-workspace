import type { Request, RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth';

export function isAidgeViewerId(id: string, env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): boolean {
  return (env.AIDGE_VIEWER_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean).includes(id);
}

async function sessionUserId(req: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return session?.user?.id ?? null;
}

export function createAidgeViewerGuard(
  resolveSession: (req: Request) => Promise<string | null> = sessionUserId,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): RequestHandler {
  return async (req, res, next) => {
    if (!env.AIDGE_VIEWER_USER_IDS || !req.headers.cookie) return next();
    if (req.path.startsWith('/api/auth/') || req.path === '/api/auth') return next();
    try {
      const id = await resolveSession(req);
      if (!id || !isAidgeViewerId(id, env)) return next();
      if (req.path.startsWith('/api/aidge/') || req.path === '/api/aidge') return next();
      return void res.status(403).json({ error: '此账号仅可使用 Aidge' });
    } catch {
      return void res.status(503).json({ error: '暂时无法验证登录状态，请稍后重试' });
    }
  };
}
