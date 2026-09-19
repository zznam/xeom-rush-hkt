import { dbManager } from './db';
import { savePlayerSession, type ISessionStats } from './persist';

type Key = (string | number)[];
interface Entry<T> {
  key: Key;
  value: T | null;
  versionstamp: string | null;
}
interface Atomic {
  check(...entries: { key: Key; versionstamp: string | null }[]): Atomic;
  set(key: Key, value: unknown): Atomic;
  delete(key: Key): Atomic;
  commit(): Promise<{ ok: boolean }>;
}
export interface KvStore {
  get<T>(key: Key): Promise<Entry<T>>;
  list<T>(selector: { prefix: Key }, options?: { limit?: number }): AsyncIterable<Entry<T>>;
  atomic(): Atomic;
  close(): void;
}
interface Profile {
  username: string;
  careerScore: number;
  peakScore: number;
  peakStreak: number;
  totalDeliveries: number;
}

// The adapter keeps simulation and the wire protocol identical on Node and Deno.
export class KvPersistence {
  constructor(private kv: KvStore) {}

  async save(sessionId: string, stats: ISessionStats): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const profile = await this.kv.get<Profile>(['players', stats.username]);
      const previous = await this.kv.get<ISessionStats>(['sessions', sessionId]);
      if (previous.value && JSON.stringify(previous.value) === JSON.stringify(stats)) return;
      const old = profile.value;
      const next: Profile = {
        username: stats.username,
        careerScore: (old?.careerScore ?? 0) + stats.score - (previous.value?.score ?? 0),
        totalDeliveries: (old?.totalDeliveries ?? 0) + stats.deliveriesCount - (previous.value?.deliveriesCount ?? 0),
        peakScore: Math.max(old?.peakScore ?? 0, stats.score),
        peakStreak: Math.max(old?.peakStreak ?? 0, stats.peakStreak),
      };
      const transaction = this.kv.atomic().check(profile, previous);
      if (old) transaction.delete(['leaderboard', -old.careerScore, stats.username]);
      const result = await transaction
        .set(['players', stats.username], next)
        .set(['leaderboard', -next.careerScore, stats.username], next)
        .set(['sessions', sessionId], stats)
        .commit();
      if (result.ok) return;
    }
    throw new Error('Could not save score after concurrent updates');
  }

  async leaderboard(): Promise<Profile[]> {
    const profiles: Profile[] = [];
    for await (const entry of this.kv.list<Profile>({ prefix: ['leaderboard'] }, { limit: 10 })) {
      if (entry.value) profiles.push(entry.value);
    }
    return profiles;
  }
  async health(): Promise<void> {
    await this.kv.get(['health']);
  }
  close(): void {
    this.kv.close();
  }
}

let kvPersistence: KvPersistence | null = null;
export async function connectStorage(mongoUri: string): Promise<void> {
  const deno = (globalThis as unknown as { Deno?: { openKv(path?: string): Promise<KvStore> } }).Deno;
  if (deno) {
    kvPersistence = new KvPersistence(await deno.openKv(process.env.DENO_KV_PATH || undefined));
    console.log('[Storage] Connected to Deno KV');
  } else {
    await dbManager.connect(mongoUri);
  }
}
export async function storageHealth(): Promise<void> {
  if (kvPersistence) return kvPersistence.health();
  await dbManager.getDb().command({ ping: 1 });
}
const writes = new Map<string, Promise<void>>();
export async function saveSession(id: string, stats: ISessionStats): Promise<void> {
  const previous = writes.get(id) ?? Promise.resolve();
  const write = previous
    .catch(() => {})
    .then(() => (kvPersistence ? kvPersistence.save(id, stats) : savePlayerSession(stats.username, stats)));
  writes.set(id, write);
  try {
    await write;
  } finally {
    if (writes.get(id) === write) writes.delete(id);
  }
}
export async function getLeaderboard(): Promise<Profile[]> {
  if (kvPersistence) return kvPersistence.leaderboard();
  const rows = await dbManager.getDb().collection('players').find().sort({ careerScore: -1 }).limit(10).toArray();
  return rows.map((p) => ({
    username: p.username,
    careerScore: p.careerScore,
    peakScore: p.peakScore,
    peakStreak: p.peakStreak,
    totalDeliveries: p.totalDeliveries,
  }));
}
export function isKvStorage(): boolean {
  return kvPersistence !== null;
}
export async function closeStorage(): Promise<void> {
  if (kvPersistence) kvPersistence.close();
  else await dbManager.close();
}
