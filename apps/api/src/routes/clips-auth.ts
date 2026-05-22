import { Router, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth';
import { buildFeishuOAuthUrl, exchangeFeishuCode, parseFeishuState } from '../services/clips-auth.service';
import { upsertFeishuBinding } from '../services/clips.service';

const router = Router();
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://autopilot.zenjoymedia.media';

router.get('/feishu', async (req: Request, res: Response) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session?.user) return res.status(401).json({ error: 'unauthorized' });

  try {
    const oauthUrl = buildFeishuOAuthUrl(session.user.id);
    return res.redirect(oauthUrl);
  } catch (e: unknown) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get('/feishu/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as { code: string; state: string };

  if (!code || !state) {
    return res.redirect(`${DASHBOARD_URL}/clips?tab=settings&error=invalid_callback`);
  }

  const parsed = parseFeishuState(state);
  if (!parsed) {
    return res.redirect(`${DASHBOARD_URL}/clips?tab=settings&error=invalid_state`);
  }

  try {
    const tokenResult = await exchangeFeishuCode(code);
    await upsertFeishuBinding(parsed.userId, tokenResult);
    return res.redirect(`${DASHBOARD_URL}/clips?tab=settings&feishu=bound`);
  } catch (e: unknown) {
    console.error('[clips-auth] feishu callback error:', e instanceof Error ? e.message : String(e));
    return res.redirect(`${DASHBOARD_URL}/clips?tab=settings&error=feishu_failed`);
  }
});

export default router;
