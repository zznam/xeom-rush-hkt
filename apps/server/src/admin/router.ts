import express, { type Request, type Response, type NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { resolve } from 'path';
import {
  ConfigValidationError,
  validateCityConfig,
  type AdminCommand,
  type AdminStaff,
  type BanRecord,
  type CityRef,
  type CityReport,
} from '@xeom-rush/shared';
import { AdminAuth, type AuthOptions } from './auth';
import {
  ControlService,
  ControlError,
  deploymentRecord,
  validId,
  validUuid,
  type AuditRecord,
  type ConfigRecord,
  type DeploymentRecord,
  type Preset,
} from './service';
import { KvControlStore, MemoryControlStore } from './store';
import type { KvStore } from '../storage';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
export function createAdminRouter(service: ControlService, auth: AdminAuth, ownerId: string) {
  const router = express.Router();
  router.use(['/api/admin', '/api/internal'], express.json({ limit: '128kb' }), (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const limited = new Map<string, { at: number; count: number }>();
  router.use('/api/admin/auth', (req, res, next) => {
    const key = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    for (const [ip, value] of limited) if (now - value.at > 60000) limited.delete(ip);
    const row = limited.get(key) ?? { at: now, count: 0 };
    if (++row.count > 30 || limited.size > 10000) {
      res.status(429).json({ error: 'Please wait before trying again' });
      return;
    }
    limited.set(key, row);
    next();
  });
  router.get(
    '/api/admin/auth/login',
    wrap((req, res) => auth.login(req, res)),
  );
  router.get(
    '/api/admin/auth/callback',
    wrap((req, res) => auth.callback(req, res)),
  );
  router.post(
    '/api/admin/auth/logout',
    wrap((req, res) => auth.logout(req, res)),
  );
  router.use('/api/admin', (req, res, next) => {
    void auth
      .authenticate(req)
      .then((value) => {
        res.locals.admin = value;
        next();
      })
      .catch(next);
  });
  const owner = (res: Response) => {
    if (res.locals.admin.staff.role !== 'owner') throw new ControlError(403, 'Owner access required');
  };
  const gm = (res: Response) => {
    if (res.locals.admin.staff.role === 'moderator') throw new ControlError(403, 'Game Master access required');
  };
  router.get('/api/admin/me', (_req, res) => res.json({ staff: res.locals.admin.staff, csrf: res.locals.admin.csrf }));
  router.get(
    '/api/admin/cities',
    wrap(async (_req, res) =>
      res.json((await service.store.list<CityReport>('cities/')).map((r) => ({ key: r.key.slice(7), ...r.value }))),
    ),
  );
  router.get(
    '/api/admin/cities/:city',
    wrap(async (req, res) => {
      const key = req.params.city;
      await service.observe(key);
      const [city, config, players, map, commands] = await Promise.all([
        service.store.get<CityReport>(`cities/${key}`),
        service.store.get<ConfigRecord>(`config/${key}`),
        service.store.get(`players/${key}`),
        service.store.get(`maps/${key}`),
        service.store.get<string[]>(`recent/${key}`),
      ]);
      const recentIds = commands.value ?? [];
      for (const id of recentIds) await service.expireCommand(key, id);
      res.json({
        city: city.value,
        config: config.value,
        players: players.value,
        map: map.value,
        commands: (await Promise.all(recentIds.map((id) => service.store.get<AdminCommand>(`commands/${key}/${id}`))))
          .map((r) => r.value)
          .filter(Boolean),
      });
    }),
  );
  router.post(
    '/api/admin/cities/:city/commands',
    wrap(async (req, res) => {
      res.status(202).json(await service.submit(res.locals.admin.staff, req.params.city, req.body));
    }),
  );
  router.get(
    '/api/admin/deployments',
    wrap(async (_req, res) => {
      res.json(
        (await service.store.list<DeploymentRecord>('deployments/')).map((row) => {
          const { tokenHash: _secret, ...value } = row.value!;
          return { ...value, version: row.version };
        }),
      );
    }),
  );
  router.post(
    '/api/admin/deployments',
    wrap(async (req, res) => {
      owner(res);
      const token = randomBytes(32).toString('hex');
      const value = deploymentRecord(req.body.id, req.body.label, req.body.regions, token);
      const row = await service.store.get<DeploymentRecord>(`deployments/${value.id}`);
      if (row.value) throw new ControlError(409, 'Deployment already registered');
      if (
        !(await service.store.commit(
          [row],
          [{ key: row.key, value }, service.audit(res.locals.admin.staff.id, 'register-deployment', value.id)],
        ))
      )
        throw new ControlError(409, 'Deployment already registered');
      res.json({ id: value.id, token });
    }),
  );
  router.put(
    '/api/admin/deployments/:id/defaults',
    wrap(async (req, res) => {
      owner(res);
      if (typeof req.body.version !== 'string') throw new ControlError(400, 'Reload defaults before saving');
      const value = await service.deployment(req.params.id);
      const defaults = validateCityConfig(req.body.config);
      await service.change(
        res.locals.admin.staff.id,
        'set-defaults',
        `deployments/${value.id}`,
        { ...value, defaults },
        req.body.version,
      );
      res.json({ ok: true });
    }),
  );
  router.get(
    '/api/admin/presets',
    wrap(async (_req, res) =>
      res.json((await service.store.list<Preset>('presets/')).map((r) => ({ ...r.value, version: r.version }))),
    ),
  );
  router.put(
    '/api/admin/presets/:id',
    wrap(async (req, res) => {
      gm(res);
      if (
        !validId(req.params.id) ||
        typeof req.body.name !== 'string' ||
        !req.body.name.trim() ||
        req.body.name.length > 80
      )
        throw new ControlError(400, 'Invalid preset name');
      await service.change(
        res.locals.admin.staff.id,
        'save-preset',
        `presets/${req.params.id}`,
        { id: req.params.id, name: req.body.name.trim(), config: validateCityConfig(req.body.config) },
        req.body.version ?? null,
      );
      res.json({ ok: true });
    }),
  );
  router.get(
    '/api/admin/staff',
    wrap(async (_req, res) => {
      owner(res);
      res.json((await service.store.list<AdminStaff>('staff/')).map((r) => ({ ...r.value, version: r.version })));
    }),
  );
  router.put(
    '/api/admin/staff/:id',
    wrap(async (req, res) => {
      owner(res);
      const id = req.params.id;
      if (
        !/^\d{1,20}$/.test(id) ||
        !['owner', 'gm', 'moderator'].includes(req.body.role) ||
        typeof req.body.login !== 'string' ||
        req.body.login.length > 80 ||
        typeof req.body.disabled !== 'boolean'
      )
        throw new ControlError(400, 'Invalid staff record');
      if (id === ownerId && (req.body.disabled || req.body.role !== 'owner'))
        throw new ControlError(400, 'The configured recovery owner cannot be disabled');
      await service.change(
        res.locals.admin.staff.id,
        'update-staff',
        `staff/${id}`,
        { id, login: req.body.login, role: req.body.role, disabled: req.body.disabled },
        req.body.version ?? null,
      );
      res.json({ ok: true });
    }),
  );
  router.get(
    '/api/admin/bans',
    wrap(async (req, res) => {
      const deployment = await service.deployment(String(req.query.deployment ?? ''));
      res.json(
        (await service.store.list<BanRecord>(`bans/${deployment.id}/`)).map((r) => ({
          ...r.value,
          version: r.version,
        })),
      );
    }),
  );
  router.put(
    '/api/admin/bans/:deployment/:guestId',
    wrap(async (req, res) => {
      await service.deployment(req.params.deployment);
      if (
        !validUuid(req.params.guestId) ||
        typeof req.body.reason !== 'string' ||
        !req.body.reason.trim() ||
        req.body.reason.length > 240 ||
        !(
          req.body.revoked === true ||
          req.body.expiresAt === null ||
          (Number.isSafeInteger(req.body.expiresAt) && req.body.expiresAt > service.now())
        )
      )
        throw new ControlError(400, 'Invalid ban or expiry');
      const value: BanRecord = {
        deployment: req.params.deployment,
        guestId: req.params.guestId,
        reason: req.body.reason.trim(),
        expiresAt: req.body.expiresAt,
        createdAt: service.now(),
        actor: res.locals.admin.staff.id,
      };
      if (req.body.revoked === true) value.revokedAt = service.now();
      await service.change(
        value.actor,
        value.revokedAt ? 'unban' : 'ban',
        `bans/${value.deployment}/${value.guestId}`,
        value,
        req.body.version ?? null,
      );
      res.json({ ok: true });
    }),
  );
  router.get(
    '/api/admin/audit',
    wrap(async (req, res) => {
      const query = String(req.query.q ?? '')
        .toLowerCase()
        .slice(0, 100);
      res.json(
        (await service.store.list<AuditRecord>('audit/', 500))
          .map((r) => r.value!)
          .filter((r) => !query || JSON.stringify(r).toLowerCase().includes(query))
          .slice(0, 100),
      );
    }),
  );
  router.use('/api/internal', (req, res, next) => {
    void service
      .authenticateWorker(
        String(req.headers['x-deployment-id'] ?? ''),
        String(req.headers.authorization ?? '').replace(/^Bearer /, ''),
      )
      .then((deployment) => {
        res.locals.deployment = deployment;
        next();
      })
      .catch(next);
  });
  router.post(
    '/api/internal/report',
    wrap(async (req, res) => {
      await service.report(req.body, res.locals.deployment);
      res.json({ ok: true });
    }),
  );
  router.post(
    '/api/internal/poll',
    wrap(async (req, res) => {
      service.validateRef(req.body, res.locals.deployment);
      res.json(await service.poll(req.body));
    }),
  );
  router.post(
    '/api/internal/ack',
    wrap(async (req, res) => {
      service.validateRef(req.body.ref, res.locals.deployment);
      res.json(await service.acknowledge(req.body.ref as CityRef, req.body.id, req.body.status, req.body.result));
    }),
  );
  router.post(
    '/api/internal/admit',
    wrap(async (req, res) => {
      if (!res.locals.deployment.regions.includes(req.body.region)) throw new ControlError(400, 'Invalid region');
      const banned = await service.isBanned(res.locals.deployment.id, req.body.guestId);
      const alias = await service.store.get<string>(
        `aliases/${res.locals.deployment.id}/${req.body.region}/${req.body.guestId}`,
      );
      res.json({ banned, profileId: alias.value ?? req.body.guestId });
    }),
  );
  router.post(
    '/api/internal/link',
    wrap(async (req, res) => {
      const deployment = res.locals.deployment as DeploymentRecord;
      if (
        !deployment.regions.includes(req.body.region) ||
        !validUuid(req.body.guestId) ||
        !validUuid(req.body.legacyProfileId)
      )
        throw new ControlError(400, 'Invalid identity link');
      const prefix = `${deployment.id}/${req.body.region}`;
      const alias = await service.store.get<string>(`aliases/${prefix}/${req.body.guestId}`);
      const previous = await service.store.get<string>(`alias-owners/${prefix}/${req.body.legacyProfileId}`);
      if (
        (alias.value && alias.value !== req.body.legacyProfileId) ||
        (previous.value && previous.value !== req.body.guestId)
      )
        throw new ControlError(409, 'Career already linked to another identity');
      if (
        !(await service.store.commit(
          [alias, previous],
          [
            { key: alias.key, value: req.body.legacyProfileId },
            { key: previous.key, value: req.body.guestId },
          ],
        ))
      )
        throw new ControlError(409, 'Identity link raced another request');
      res.json({ ok: true });
    }),
  );
  router.use('/admin', (_req, res, next) => {
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
    );
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  router.use('/admin', express.static(resolve(__dirname, '../../../admin/dist'), { index: 'index.html' }));
  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      error instanceof ControlError
        ? error.status
        : error instanceof ConfigValidationError ||
            (error instanceof SyntaxError && 'status' in error && error.status === 400)
          ? 400
          : 503;
    res
      .status(status)
      .json({ error: status >= 500 ? 'Controller temporarily unavailable' : error.message.slice(0, 300) });
  });
  return router;
}
export async function createHubFromEnv() {
  if (process.env.ADMIN_HUB_ENABLED !== '1') return null;
  const production = process.env.NODE_ENV === 'production' || !!process.env.DENO_DEPLOY;
  const origin = process.env.ADMIN_ORIGIN || '';
  const parsed = new URL(origin);
  if (parsed.origin !== origin || (production && parsed.protocol !== 'https:'))
    throw new Error('ADMIN_ORIGIN must be an exact HTTPS origin');
  const clientId = process.env.ADMIN_GITHUB_CLIENT_ID || '';
  const clientSecret = process.env.ADMIN_GITHUB_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('Configure GitHub admin OAuth credentials');
  const deno = (globalThis as unknown as { Deno?: { openKv(path?: string): Promise<KvStore> } }).Deno;
  const store = deno
    ? new KvControlStore(await deno.openKv(process.env.DENO_KV_PATH || undefined))
    : !production && process.env.ADMIN_STORE === 'memory'
      ? new MemoryControlStore()
      : null;
  if (!store) throw new Error('The control hub requires Deno KV (ADMIN_STORE=memory is local-only)');
  const service = new ControlService(store);
  const deployments = JSON.parse(process.env.ADMIN_DEPLOYMENTS_JSON || '[]') as {
    id: string;
    label: string;
    regions: string[];
    token: string;
  }[];
  const ownerId = process.env.ADMIN_OWNER_GITHUB_ID || '';
  await service.bootstrap(
    ownerId,
    deployments.map((d) => deploymentRecord(d.id, d.label, d.regions, d.token)),
  );
  const authOptions: AuthOptions = { origin, clientId, clientSecret, secure: parsed.protocol === 'https:' };
  return {
    service,
    router: createAdminRouter(service, new AdminAuth(service, authOptions), ownerId),
    close: () => store.close(),
  };
}
