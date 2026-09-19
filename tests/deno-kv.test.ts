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
