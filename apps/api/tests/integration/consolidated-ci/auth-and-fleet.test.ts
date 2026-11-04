import { afterAll, afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../../../src/auth';
import app from '../../../src/app';
import pool from '../../../src/db/connection';
afterEach(() => vi.restoreAllMocks());
afterAll(() => pool.end());

it('real registration, sign-in, session and password-reset use a private database and cookie jar', async () => {
  // Production's current mail adapter writes to the local logger. Capture its
  // output here so reset/session tokens never appear in the test transcript.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const identity = { email: `contract-${randomUUID()}@example.test`, password: 'IsolatedContract123!', name: 'Fixture customer' };
  // app.ts deliberately omits the auth handler under VITEST. Mount the same
  // real production handler before the application's JSON parser here.
  const liveApp = express();
  liveApp.all('/api/auth/*', toNodeHandler(auth));
  liveApp.use(app);
  const customer = request.agent(liveApp);
  const signedUp = await customer.post('/api/auth/sign-up/email').send(identity);
  expect(signedUp.status).toBe(200);
  expect(signedUp.body.user.email).toBe(identity.email);
  expect(signedUp.headers['set-cookie']).toBeDefined();
  const membership = await pool.query('SELECT tenant_id,role FROM zenithjoy.tenant_members WHERE feishu_user_id=$1', [signedUp.body.user.id]);
  expect(membership.rows).toHaveLength(1);
  expect(membership.rows[0].role).toBe('owner');
  const me = await customer.get('/api/account/me');
  expect(me.status).toBe(200); expect(me.body.license.tier).toBe('free');
  const loggedIn = await customer.post('/api/auth/sign-in/email').send({ email: identity.email, password: identity.password });
  expect(loggedIn.status).toBe(200);
  const session = await customer.get('/api/auth/get-session');
  expect(session.status).toBe(200); expect(session.body.user.id).toBe(signedUp.body.user.id);
  const outsider = await request(liveApp).get('/api/auth/get-session');
  expect(outsider.body).toBeNull();
  const reset = await customer.post('/api/auth/request-password-reset').send({ email: identity.email, redirectTo: 'http://localhost:5173/reset-password' });
  expect(reset.status).toBe(200); expect(reset.body.status).toBe(true);
});

it('fleet list has nonempty exact owner/os rows and owner filtering never leaks another tenant', async () => {
  const tenants = [randomUUID(), randomUUID()];
  for (const [index, tenant] of tenants.entries()) {
    await pool.query("INSERT INTO zenithjoy.tenants(id,name,license_key,plan) VALUES($1,$2,$3,'free')", [tenant, `fleet-${index}`, `fleet-${tenant}`]);
    await pool.query("INSERT INTO zenithjoy.tenant_members(tenant_id,feishu_user_id,role) VALUES($1,$2,'owner')", [tenant, `fleet-member-${index}`]);
  }
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, owner, os, tenant] of [[0, 'internal_fleet', 'android', tenants[0]], [1, 'customer', 'win32', tenants[0]], [2, 'customer', 'android', tenants[1]]] as const) {
    await pool.query("INSERT INTO zenithjoy.agents(id,tenant_id,agent_id,hostname,os_type,owner_type,status) VALUES($1,$2,$3,$4,$5,$6,'online')", [ids[index], tenant, `fleet-${ids[index]}`, `host-${index}`, os, owner]);
  }
  expect((await request(app).get('/api/agent/machines')).status).toBe(401);
  const get = (path: string, member = 0) => request(app).get(path).set('x-feishu-user-id', `fleet-member-${member}`);
  const all = await get('/api/agent/machines');
  expect(all.status).toBe(200); expect(all.body.data).toHaveLength(2);
  expect(all.body.data.map((row: { id: string }) => row.id).sort()).toEqual(ids.slice(0, 2).sort());
  for (const [owner, index, os] of [['internal_fleet', 0, 'android'], ['customer', 1, 'win32']] as const) {
    const response = await get(`/api/agent/machines?owner_type=${owner}`);
    expect(response.status).toBe(200); expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: ids[index], owner_type: owner, os_type: os });
  }
  const other = await get('/api/agent/machines', 1);
  expect(other.body.data).toHaveLength(1); expect(other.body.data[0].id).toBe(ids[2]);
  expect((await get(`/api/agent/machines/${ids[0]}`, 1)).status).toBe(404);
});
