// Local integration fixture only: this module is not shipped in the runtime image.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const express = require('express');
const { ControlService, deploymentRecord, hash } = require('./dist/admin/service.js');
const { KvControlStore } = require('./dist/admin/store.js');
const { AdminAuth } = require('./dist/admin/auth.js');
const { createAdminRouter } = require('./dist/admin/router.js');
const port = Number(Deno.env.get('PORT') || 3200);
const origin = `http://127.0.0.1:${port}`;
const kv = await Deno.openKv(Deno.env.get('DENO_KV_PATH'));
const service = new ControlService(new KvControlStore(kv));
const token = 'test-worker-credential-at-least-32-characters';
await service.bootstrap('1', [
  deploymentRecord('legacy', 'Legacy', ['local'], token),
  deploymentRecord('aws', 'Regional', ['test-sg', 'test-hk'], token),
]);
await service.put(`sessions/${hash('test-session')}`, {
  staffId: '1',
  csrf: 'test-csrf',
  expiresAt: Date.now() + 3600000,
});
const app = express();
app.get('/test/ready', (_req: unknown, res: { json(value: unknown): void }) => res.json({ ok: true }));
app.use(
  createAdminRouter(
    service,
    new AdminAuth(service, { origin, clientId: 'test', clientSecret: 'test', secure: false }),
    '1',
  ),
);
const server = app.listen(port, '127.0.0.1');
Deno.addSignalListener('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => {
    kv.close();
    Deno.exit();
  });
});
