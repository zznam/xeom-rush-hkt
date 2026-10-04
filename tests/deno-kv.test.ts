import { CareerRepository, KvCareerBackend } from '../apps/server/dist/career-store.js';
import { strict as assert } from 'node:assert';
import { KvPersistence } from '../apps/server/dist/storage.js';

const stats = {
  username: 'Cô Ba',
  score: 12000,
  deliveriesCount: 2,
  peakStreak: 2,
  violations: { redLights: 0, pedestrianHits: 0, driverCollisions: 0 },
};

Deno.test('KV checkpoints are idempotent and apply later penalties without duplicate earnings', async () => {
  const kv = await Deno.openKv(':memory:');
  const storage = new KvPersistence(kv);
  try {
    await storage.save('ride-1', stats);
    await storage.save('ride-1', stats);
    assert.equal((await storage.leaderboard())[0].careerScore, 12000);
    await storage.save('ride-1', { ...stats, score: 7000 });
    const profile = (await storage.leaderboard())[0];
    assert.equal(profile.careerScore, 7000);
    assert.equal(profile.totalDeliveries, 2);
    assert.equal(profile.peakScore, 12000);
    await storage.save('replacement-city-ride', { ...stats, score: 0, deliveriesCount: 0, peakStreak: 0 });
    assert.equal((await storage.leaderboard())[0].careerScore, 7000, 'a new city must preserve earlier savings');
  } finally {
    storage.close();
  }
});

Deno.test('KV concurrent sessions update career totals atomically', async () => {
  const kv = await Deno.openKv(':memory:');
  const storage = new KvPersistence(kv);
  try {
    await Promise.all([storage.save('ride-a', stats), storage.save('ride-b', { ...stats, score: 5000 })]);
    const rows = await storage.leaderboard();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].careerScore, 17000);
    assert.equal(rows[0].totalDeliveries, 4);
    await storage.save('ride-c', { ...stats, username: 'Chú Tư', score: 20000 });
    assert.equal((await storage.leaderboard())[0].username, 'Chú Tư');
  } finally {
    storage.close();
  }
});

Deno.test('ID careers keep the checkpoint ledger outside the bounded KV profile', async () => {
  const kv = await Deno.openKv(':memory:');
  const repository = new CareerRepository(new KvCareerBackend(kv));
  try {
    for (let i = 0; i < 300; i++) await repository.save('driver', `ride-${i}`, { ...stats, revision: 1 });
    const p = await repository.profile('driver');
    assert.equal(p.totalDeliveries, 600);
    assert.equal(Object.keys(p.contributions).length, 0);
    await repository.save('driver', 'ride-0', { ...stats, revision: 1 });
    assert.equal((await repository.profile('driver')).totalDeliveries, 600);
    assert.equal(await repository.secret(), await repository.secret());
  } finally {
    kv.close();
  }
});

Deno.test('KV objective claims and cosmetic equips are retry-safe', async () => {
  const kv = await Deno.openKv(':memory:');
  const repository = new CareerRepository(new KvCareerBackend(kv));
  const { activeObjectives } = await import('../packages/shared/dist/index.js');
  const now = Date.parse('2026-10-03T12:00:00Z'),
    o = activeObjectives(now)[0],
    target = `${o.period}:${o.id}`;
  try {
    await repository.save('driver', 'objective-ride', {
      ...stats,
      revision: 2,
      progress: { [o.period]: { [o.metric]: o.goal } },
    });
    await Promise.all([repository.claim('driver', target, now), repository.claim('driver', target, now)]);
    assert.equal((await repository.profile('driver')).claimCount, 1);
    await repository.equip('driver', 'paint-1');
    assert.equal((await repository.profile('driver')).equipped.paint, 'paint-1');
  } finally {
    kv.close();
  }
});

Deno.test('ID-based careers isolate duplicate nicknames from legacy scores', async () => {
  const kv = await Deno.openKv(':memory:');
  const storage = new KvPersistence(kv);
  try {
    await storage.save('legacy', stats);
    await storage.save('guest-a', { ...stats, profileId: 'identity-a', score: 3000 });
    await storage.save('guest-b', { ...stats, profileId: 'identity-b', score: 5000 });
    await storage.save('guest-a', { ...stats, profileId: 'identity-a', score: 3000 });
    assert.equal((await storage.leaderboard()).length, 1);
    const modern = await storage.leaderboard(true);
    assert.equal(modern.length, 2);
    assert.equal(modern[0].careerScore, 5000);
    assert.equal(modern[1].careerScore, 3000);
    await assert.rejects(() => storage.save('guest-a', { ...stats, profileId: 'identity-b' }), /owner/);
  } finally {
    storage.close();
  }
});
