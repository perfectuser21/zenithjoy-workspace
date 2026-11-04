import http from 'node:http';
import http2 from 'node:http2';
import type supertest from 'supertest';

/** Transport lifetime only: actual supertest still creates every request/agent,
 * serializes bodies, retains cookies and makes real TCP requests. */
export function createSupertestTransport(actual: typeof supertest) {
  const apps = new WeakMap<Function, Map<boolean, http.Server | http2.Http2Server>>();
  const servers = new Set<http.Server | http2.Http2Server>();
  const sessions = new Set<http2.ServerHttp2Session>();
  function target(app: any, options: any = {}) {
    if (typeof app !== 'function') return app;
    const useHttp2 = Boolean(options.http2);
    let protocols = apps.get(app);
    if (!protocols) { protocols = new Map(); apps.set(app, protocols); }
    let server = protocols.get(useHttp2);
    if (!server) {
      server = useHttp2 ? http2.createServer(app) : http.createServer(app);
      if (useHttp2) server.on('session', session => {
        sessions.add(session);
        session.once('close', () => sessions.delete(session));
      });
      // Same public synchronous listen(0) operation supertest itself uses.
      // Binding before passing it to supertest prevents per-request auto-close.
      server.listen(0);
      protocols.set(useHttp2, server);
      servers.add(server);
    }
    return server;
  }
  const request = Object.assign(function(app: any, options: any = {}) {
    return actual(target(app, options), options);
  }, actual) as typeof supertest;
  request.agent = function(app: any, options: any = {}) {
    return actual.agent(target(app, options), options);
  } as typeof actual.agent;
  request.agent.prototype = actual.agent.prototype;

  async function close() {
    const closing = [...servers]; servers.clear();
    for (const session of sessions) session.destroy();
    sessions.clear();
    await Promise.all(closing.map(server => new Promise<void>((resolve, reject) => {
      if (!server.listening) { resolve(); return; }
      server.close(error => error ? reject(error) : resolve());
      if ('closeAllConnections' in server) server.closeAllConnections();
    })));
  }
  return { request, close, servers };
}
