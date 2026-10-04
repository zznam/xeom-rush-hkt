import { strict as assert } from 'node:assert';
import { KvControlStore } from '../apps/server/dist/admin/store.js';
import { ControlService, deploymentRecord } from '../apps/server/dist/admin/service.js';
import { defaultCityConfig, cityKey } from '../packages/shared/dist/index.js';

Deno.test('control records and conditional command submission use native Deno KV', async () => {
  const kv = await Deno.openKv(':memory:');
  const store = new KvControlStore(kv);
  const service = new ControlService(store);
  try {
    const deployment = deploymentRecord('legacy', 'Legacy', ['local'], 's'.repeat(32));
    await service.bootstrap('1', [deployment]);
    const ref = {
      deployment: 'legacy',
      region: 'local',
      room: 'local',
      runtimeId: crypto.randomUUID(),
      persistent: false,
    };
    await service.report(
      {
        ref,
        revision: 0,
        config: defaultCityConfig(),
        tick: 10,
        tickMs: 1,
        humans: 0,
        bots: { current: 8, requested: 8, retiring: 0 },
        paused: false,
        admissionsOpen: true,
        lastSeen: Date.now(),
      },
      deployment,
    );
    const key = cityKey(ref);
    const staff = { id: '1', login: 'Owner', role: 'owner' };
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        service.submit(staff, key, {
          id: crypto.randomUUID(),
          runtimeId: ref.runtimeId,
          expectedRevision: 0,
          action: { type: 'pause' },
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const pending = (await service.poll(ref)).command;
    assert.equal(pending.status, 'pending');
    await service.acknowledge(ref, pending.id, 'applied', 'Done');
    const secondService = new ControlService(store);
    assert.equal((await secondService.poll(ref)).config.revision, 1);
    assert.equal((await store.list('audit/')).length, 2);
  } finally {
    store.close();
  }
});
