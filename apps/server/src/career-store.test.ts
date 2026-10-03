import { describe, expect, it } from 'vitest';
import { CareerRepository, MemoryCareerBackend } from './career-store';
import { emptySummary } from '@xeom-rush/shared';
describe('authenticated careers', () => {
  it('deduplicates checkpoints, rejects stale revisions, and applies penalties', async () => {
    const store = new CareerRepository(new MemoryCareerBackend());
    const stats = {
      username: 'Cô Ba',
      score: 10000,
      peakStreak: 3,
      deliveriesCount: 2,
      revision: 10,
      summary: { ...emptySummary(), distance: 500 },
    };
    await store.save('a', 'ride', stats);
    await store.save('a', 'ride', stats);
    await store.save('a', 'ride', { ...stats, revision: 12, score: 8000, username: 'Tên mới' });
    await store.save('a', 'ride', stats);
    const p = await store.profile('a');
    expect(p.careerScore).toBe(8000);
    expect(p.totalDeliveries).toBe(2);
    expect(p.username).toBe('Tên mới');
    expect(p.summary.distance).toBe(500);
    expect((await store.profile('b')).careerScore).toBe(0);
  });
  it('persists an identity key and resolves concurrent profile updates', async () => {
    const store = new CareerRepository(new MemoryCareerBackend());
    expect(await store.secret()).toBe(await store.secret());
    await Promise.all([
      store.save('a', 'one', { username: 'Same', score: 10, peakStreak: 1, deliveriesCount: 1 }),
      store.save('a', 'two', { username: 'Same', score: 20, peakStreak: 1, deliveriesCount: 1 }),
    ]);
    expect((await store.profile('a')).careerScore).toBe(30);
  });
});
