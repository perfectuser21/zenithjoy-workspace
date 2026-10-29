import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth';
import { parseFlatDirectory } from '../staff-directory';
import { configuredCanvasGateway, createCanvasGateway } from './creative-canvas-gateway';

const config = configuredCanvasGateway();
function build() {
  try {
    return createCanvasGateway({ ...config, authenticate: async req => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session?.user?.id) return null;
      const staff = parseFlatDirectory(process.env);
      if (!staff.has(session.user.id) && !staff.has(session.user.email.toLowerCase())) return null;
      return session.user.id;
    } });
  } catch {
    console.error('[creative-canvas] instance map is invalid or shared; disabled');
    return createCanvasGateway({ ...config, instances: {}, authenticate: async () => null });
  }
}
export const creativeCanvasGateway = build();
