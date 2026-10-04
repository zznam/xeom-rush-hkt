import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import { AdminAuth } from './auth';
import { createAdminRouter } from './router';
import { MemoryControlStore } from './store';
import { ControlService, deploymentRecord, hash } from './service';

let server: Server;
let origin: string;
let service: ControlService;
const token = 'w'.repeat(32);
const cookie = 'test-admin-session';
const csrf = 'test-csrf';
let tokenExchange: Record<string, unknown>;
beforeEach(async () => {
  service = new ControlService(new MemoryControlStore());
  await service.bootstrap('1', [deploymentRecord('test', 'Test', ['sg', 'jp'], token)]);
  await service.put(`sessions/${hash(cookie)}`, { staffId: '1', csrf, expiresAt: Date.now() + 60000 });
  const app = express();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const auth = new AdminAuth(service, {
    origin,
    clientId: 'client',
    clientSecret: 'secret',
    secure: false,
    request: (async (url, options) => {
      if (String(url).includes('access_token')) {
        tokenExchange = JSON.parse(String(options?.body));
        return Response.json({ access_token: 'provider-token' });
      }
      return Response.json({ id: 1, login: 'owner' });
    }) as typeof fetch,
  });
  app.use(createAdminRouter(service, auth, '1'));
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const admin = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${origin}/api/admin/${path}`, {
    method,
    headers: {
      Cookie: `xeom_admin=${cookie}`,
      Origin: origin,
      'x-csrf-token': csrf,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const internal = (path: string, body: unknown) =>
  fetch(`${origin}/api/internal/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-deployment-id': 'test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
describe('admin HTTP boundary', () => {
  it('denies anonymous requests and exposes only identity plus CSRF to a signed-in admin', async () => {
    expect((await fetch(`${origin}/api/admin/cities`)).status).toBe(401);
    const me = await (await admin('me')).json();
    expect(me.staff.id).toBe('1');
    expect(me.csrf).toBe(csrf);
    expect(me.sessionKey).toBeUndefined();
  });
  it('requires both trusted origin and CSRF for mutations', async () => {
    const body = { login: 'GM', role: 'gm', disabled: false };
    expect((await admin('staff/2', 'PUT', body, { 'x-csrf-token': '' })).status).toBe(403);
    expect((await admin('staff/2', 'PUT', body, { Origin: 'https://attacker.example' })).status).toBe(403);
    expect((await admin('staff/2', 'PUT', body)).status).toBe(200);
  });
  it('revokes an already established session when staff is disabled', async () => {
    await service.put('staff/1', { id: '1', login: 'owner', role: 'owner', disabled: true });
    expect((await admin('me')).status).toBe(403);
  });
  it('logs out and removes the stored session', async () => {
    expect((await admin('auth/logout', 'POST')).status).toBe(200);
    expect((await admin('me')).status).toBe(401);
  });
  it('enforces owner role and protects the recovery owner', async () => {
    expect((await admin('staff/1', 'PUT', { login: 'owner', role: 'gm', disabled: false })).status).toBe(400);
    await service.put('staff/1', { id: '1', login: 'gm', role: 'gm' });
    expect((await admin('staff')).status).toBe(403);
    expect((await admin('deployments', 'POST', { id: 'x' })).status).toBe(403);
  });
  it('binds OAuth callback to its one-use cookie state and passes the PKCE verifier', async () => {
    const login = await fetch(`${origin}/api/admin/auth/login`, { redirect: 'manual' });
    const url = new URL(login.headers.get('location')!);
    const state = url.searchParams.get('state')!;
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('');
    const callback = `${origin}/api/admin/auth/callback?code=code&state=${state}`;
    expect((await fetch(callback, { redirect: 'manual' })).status).toBe(403);
    const response = await fetch(callback, { redirect: 'manual', headers: { Cookie: `xeom_oauth=${state}` } });
    expect(response.status).toBe(302);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(tokenExchange.code_verifier).toBeTypeOf('string');
    expect(tokenExchange.redirect_uri).toBe(`${origin}/api/admin/auth/callback`);
    expect((await fetch(callback, { redirect: 'manual', headers: { Cookie: `xeom_oauth=${state}` } })).status).toBe(
      403,
    );
  });
  it('does not expose worker secrets or hashes in deployments or audit', async () => {
    const list = await (await admin('deployments')).json();
    expect(JSON.stringify(list)).not.toContain(hash(token));
    expect(JSON.stringify(list)).not.toContain(token);
    const deployment = list[0];
    expect(
      (await admin('deployments/test/defaults', 'PUT', { config: deployment.defaults, version: deployment.version }))
        .status,
    ).toBe(200);
    expect(await (await admin('audit')).text()).not.toContain(hash(token));
  });
  it('binds legacy career aliases once and shares bans across regions', async () => {
    const guestId = randomUUID();
    const legacyProfileId = randomUUID();
    expect((await internal('link', { guestId, legacyProfileId, region: 'sg' })).status).toBe(200);
    expect((await internal('link', { guestId, legacyProfileId: randomUUID(), region: 'sg' })).status).toBe(409);
    expect((await internal('link', { guestId: randomUUID(), legacyProfileId, region: 'sg' })).status).toBe(409);
    expect((await (await internal('admit', { guestId, region: 'sg' })).json()).profileId).toBe(legacyProfileId);
    expect((await admin(`bans/test/${guestId}`, 'PUT', { reason: 'Abuse', expiresAt: null })).status).toBe(200);
    expect((await (await internal('admit', { guestId, region: 'jp' })).json()).banned).toBe(true);
    const ban = (await (await admin('bans?deployment=test')).json())[0];
    expect((await admin(`bans/test/${guestId}`, 'PUT', { ...ban, revoked: true })).status).toBe(200);
    expect((await (await internal('admit', { guestId, region: 'sg' })).json()).banned).toBe(false);
  });
});
