import { Router } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth';
import { PacingConfigController } from '../controllers/pacing-config.controller';
import { TopicsController } from '../controllers/topics.controller';
import { ipKeyFn, simpleRateLimit } from '../middleware/simple-rate-limit';
import { isStaffWhitelisted } from '../staff-directory';

const router = Router();
const topics = new TopicsController();
const pacing = new PacingConfigController();

function error(code: string, message: string) {
  return { success: false, data: null, error: { code, message } };
}

function isOriginForHost(origin: string, host: string | undefined): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.host === host?.toLowerCase();
  } catch {
    return false;
  }
}

router.use(simpleRateLimit({ windowMs: 60_000, max: 240, keyFn: ipKeyFn }));

router.use(async (req, res, next) => {
  const origin = req.get('origin');
  const readOnly = req.method === 'GET' || req.method === 'HEAD';
  if (origin ? !isOriginForHost(origin, req.get('host')) : !readOnly) {
    res.status(403).json(error('FORBIDDEN_ORIGIN', '请从当前站点操作'));
    return;
  }

  let session;
  try {
    session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  } catch {
    res.status(503).json(error('SESSION_UNAVAILABLE', '暂时无法验证登录状态，请稍后重试'));
    return;
  }
  const user = session?.user;
  if (!user?.id) {
    res.status(401).json(error('SESSION_REQUIRED', '请先登录'));
    return;
  }
  // These tables are the primary company's shared publishing workspace and have no tenant key.
  if (!isStaffWhitelisted(process.env, user.id, user.emailVerified ? user.email : '')) {
    res.status(403).json(error('STAFF_REQUIRED', '需要内容工厂员工账号权限'));
    return;
  }

  res.set('Cache-Control', 'private, no-store');
  next();
});

router.get('/pacing/config', pacing.get);
router.patch('/pacing/config', pacing.patch);
router.get('/', topics.list);
router.get('/:id', topics.getOne);
router.post('/', topics.create);
router.patch('/:id', topics.patch);
router.delete('/:id', topics.remove);

export default router;
