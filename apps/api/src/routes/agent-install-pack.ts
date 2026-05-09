// Sprint 2.1e — install pack manifest + download endpoints
import { Router, type Request, type Response } from 'express';
import { readInstallPackManifest } from '../services/install-pack-manifest';

export const agentInstallPackRouter = Router();

agentInstallPackRouter.get('/manifest', (_req: Request, res: Response) => {
  const m = readInstallPackManifest();
  if (!m) {
    return res.status(503).json({
      ok: false,
      code: 'INSTALL_PACK_NOT_BUILT',
      message: 'install pack not built yet — wait for next CI run',
    });
  }
  return res.status(200).json(m);
});

agentInstallPackRouter.get('/download', (_req: Request, res: Response) => {
  const m = readInstallPackManifest();
  if (!m) {
    return res.status(503).json({
      ok: false,
      code: 'INSTALL_PACK_NOT_BUILT',
    });
  }
  return res.redirect(302, m.download_url);
});
