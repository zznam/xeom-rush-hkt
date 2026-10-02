import { expect, it } from 'vitest';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoPersistence } from './dynamo-storage';
import type { ISessionStats } from './persist';

function store() {
  const records = new Map<string, any>();
  let conflicts = 0;
  const client = {
    async send(command: any) {
      if (command instanceof GetCommand) return { Item: structuredClone(records.get(command.input.Key!.pk)) };
      if (command instanceof TransactWriteCommand) {
        const writes = command.input.TransactItems!.map((item) => item.Put!);
        for (const write of writes) {
          const actual = records.get(write.Item!.pk);
          if ((actual?.revision ?? null) !== (write.ExpressionAttributeValues?.[':revision'] ?? null)) {
            conflicts++;
            throw Object.assign(new Error('Conflict'), { name: 'TransactionCanceledException' });
          }
        }
        for (const write of writes) records.set(write.Item!.pk, structuredClone(write.Item));
        return {};
      }
      throw new Error('Unexpected command');
    },
    destroy() {},
  };
  return { records, persistence: new DynamoPersistence('careers', client as any), conflicts: () => conflicts };
}
const stats: ISessionStats = {
  profileId: 'guest-a',
  username: 'Same name',
  score: 5000,
  deliveriesCount: 1,
  peakStreak: 1,
  violations: { redLights: 0, pedestrianHits: 0, driverCollisions: 0 },
};

it('checkpoints and finalization count each contribution once, including penalties', async () => {
  const { records, persistence } = store();
  await persistence.save('ride', stats);
  await persistence.save('ride', stats);
  await persistence.save('ride', { ...stats, score: 3000 });
  expect(records.get('player:guest-a').careerScore).toBe(3000);
  expect(records.get('player:guest-a').totalDeliveries).toBe(1);
  expect(records.get('player:guest-a').peakScore).toBe(5000);
});
it('concurrent sessions merge safely, while duplicate display names stay separate', async () => {
  const { records, persistence, conflicts } = store();
  await Promise.all([persistence.save('ride-a', stats), persistence.save('ride-b', stats)]);
  expect(conflicts()).toBeGreaterThan(0);
  expect(records.get('player:guest-a').careerScore).toBe(10000);
  await persistence.save('ride-c', { ...stats, profileId: 'guest-b' });
  expect(records.get('player:guest-b').careerScore).toBe(5000);
  await expect(persistence.save('ride-a', { ...stats, profileId: 'guest-b' })).rejects.toThrow('owner mismatch');
  await expect(persistence.save('legacy', { ...stats, profileId: undefined })).rejects.toThrow('authenticated guest');
});
