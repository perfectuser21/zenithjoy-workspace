/** Default API test transport only. No DB, model, auth or product mocks.
 * Node 20 enables keep-alive on globalAgent; supertest(app) often creates a
 * short-lived server per request. Do not reuse sockets across those lifetimes. */
import http from 'node:http';
import https from 'node:https';
for (const agent of [http.globalAgent, https.globalAgent]) {
  Object.assign(agent, { keepAlive: false });
  agent.options.keepAlive = false;
  agent.destroy();
}
