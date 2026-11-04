import { createServer, type RequestListener, type Server } from 'node:http';
import { once } from 'node:events';

/** One real IPv4 server per suite: avoids port churn/stale keep-alive sockets
 * when supertest(app) otherwise listens and closes a temporary server per request. */
export async function listenLoopback(app: RequestListener): Promise<Server> {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}
export async function closeLoopback(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closed;
}
