import { randomBytes } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  activeObjectives,
  COSMETICS,
  unlockCosmetics,
  applyContribution,
  newCareer,
  type CareerContribution,
  type CareerProfile,
} from '@xeom-rush/shared';
import { dbManager } from './db';
import type { KvStore } from './storage';

interface Row<T> {
  value: T | null;
  version: string | number | null;
}
interface Change {
  key: string;
  version: Row<unknown>['version'];
  value: any;
}
export interface CareerBackend {
  commit(changes: Change[]): Promise<boolean>;
  get<T>(key: string): Promise<Row<T>>;
  set<T>(key: string, version: Row<T>['version'], value: T): Promise<boolean>;
  leaders(): Promise<CareerProfile[]>;
}
export class MemoryCareerBackend implements CareerBackend {
  private rows = new Map<string, { value: unknown; version: number }>();
  async get<T>(key: string): Promise<Row<T>> {
    const row = this.rows.get(key);
    return { value: row ? (structuredClone(row.value) as T) : null, version: row?.version ?? null };
  }
  async set<T>(key: string, version: Row<T>['version'], value: T) {
    if ((this.rows.get(key)?.version ?? null) !== version) return false;
    this.rows.set(key, { value: structuredClone(value), version: Number(version ?? 0) + 1 });
    return true;
  }
  async commit(changes: Change[]) {
    if (changes.some((c) => (this.rows.get(c.key)?.version ?? null) !== c.version)) return false;
    for (const c of changes)
      this.rows.set(c.key, { value: structuredClone(c.value), version: Number(c.version ?? 0) + 1 });
    return true;
  }
  async leaders() {
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith('player:'))
      .map(([, row]) => structuredClone(row.value) as CareerProfile)
      .sort((a, b) => b.careerScore - a.careerScore)
      .slice(0, 10);
  }
}
export class KvCareerBackend implements CareerBackend {
  constructor(private kv: KvStore) {}
  async get<T>(key: string) {
    const row = await this.kv.get<T>(['career-v2', key]);
    return { value: row.value, version: row.versionstamp };
  }
  async set<T>(key: string, version: Row<T>['version'], value: T) {
    const tx = this.kv.atomic().check({ key: ['career-v2', key], versionstamp: version as string | null });
    if (key.startsWith('player:')) {
      const old = await this.kv.get<CareerProfile>(['career-v2', key]);
      if (old.value) tx.delete(['career-board', -old.value.careerScore, old.value.id]);
      const p = value as CareerProfile;
      tx.set(['career-board', -p.careerScore, p.id], p);
    }
    return (await tx.set(['career-v2', key], value).commit()).ok;
  }
  async commit(changes: Change[]) {
    const tx = this.kv.atomic();
    for (const c of changes) {
      tx.check({ key: ['career-v2', c.key], versionstamp: c.version as string | null });
      if (c.key.startsWith('player:')) {
        const old = await this.kv.get<CareerProfile>(['career-v2', c.key]);
        if (old.value) tx.delete(['career-board', -old.value.careerScore, old.value.id]);
        tx.set(['career-board', -c.value.careerScore, c.value.id], c.value);
      }
      tx.set(['career-v2', c.key], c.value);
    }
    return (await tx.commit()).ok;
  }
  async leaders() {
    const result: CareerProfile[] = [];
    for await (const row of this.kv.list<CareerProfile>({ prefix: ['career-board'] }, { limit: 10 }))
      if (row.value) result.push(row.value);
    return result;
  }
}
export class MongoCareerBackend implements CareerBackend {
  async get<T>(key: string) {
    const row = await dbManager.getDb().collection('career_v2').findOne({ key });
    return { value: (row?.value as T) ?? null, version: row?.revision ?? null };
  }
  async set<T>(key: string, version: Row<T>['version'], value: T) {
    try {
      const p = key.startsWith('player:') ? (value as CareerProfile) : undefined;
      const result = await dbManager
        .getDb()
        .collection('career_v2')
        .updateOne(
          { key, ...(version === null ? { revision: { $exists: false } } : { revision: version }) },
          { $set: { key, value, revision: Number(version ?? 0) + 1, ...(p ? { careerScore: p.careerScore } : {}) } },
          { upsert: version === null },
        );
      return result.modifiedCount + result.upsertedCount > 0;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }
  async commit(changes: Change[]) {
    const session = dbManager.startSession();
    try {
      await session.withTransaction(async () => {
        for (const c of changes) {
          const result = await dbManager
            .getDb()
            .collection('career_v2')
            .updateOne(
              { key: c.key, ...(c.version === null ? { revision: { $exists: false } } : { revision: c.version }) },
              {
                $set: {
                  key: c.key,
                  value: c.value,
                  revision: Number(c.version ?? 0) + 1,
                  ...(c.key.startsWith('player:') ? { careerScore: c.value.careerScore } : {}),
                },
              },
              { upsert: c.version === null, session },
            );
          if (!result.modifiedCount && !result.upsertedCount) throw new Error('Career CAS conflict');
        }
      });
      return true;
    } catch (error) {
      if ((error as Error).message === 'Career CAS conflict' || (error as { code?: number }).code === 11000)
        return false;
      throw error;
    } finally {
      await session.endSession();
    }
  }
  async leaders() {
    const rows = await dbManager
      .getDb()
      .collection('career_v2')
      .find({ key: /^player:/ })
      .sort({ careerScore: -1 })
      .limit(10)
      .toArray();
    return rows.map((row) => row.value as CareerProfile);
  }
}
export class DynamoCareerBackend implements CareerBackend {
  constructor(
    private table: string,
    private client = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 })),
  ) {}
  async get<T>(key: string) {
    const row = await this.client.send(
      new GetCommand({ TableName: this.table, Key: { pk: `career-v2:${key}` }, ConsistentRead: true }),
    );
    return { value: (row.Item?.value as T) ?? null, version: row.Item?.revision ?? null };
  }
  async set<T>(key: string, version: Row<T>['version'], value: T) {
    try {
      const p = key.startsWith('player:') ? (value as CareerProfile) : undefined;
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            pk: `career-v2:${key}`,
            value,
            revision: Number(version ?? 0) + 1,
            ...(p ? { board: 'careers-v2', careerScore: p.careerScore } : {}),
          },
          ConditionExpression: version === null ? 'attribute_not_exists(pk)' : 'revision = :revision',
          ...(version === null ? {} : { ExpressionAttributeValues: { ':revision': version } }),
        }),
      );
      return true;
    } catch (error) {
      if ((error as Error).name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }
  async commit(changes: Change[]) {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: changes.map((c) => ({
            Put: {
              TableName: this.table,
              Item: {
                pk: `career-v2:${c.key}`,
                value: c.value,
                revision: Number(c.version ?? 0) + 1,
                ...(c.key.startsWith('player:') ? { board: 'careers-v2', careerScore: c.value.careerScore } : {}),
              },
              ConditionExpression: c.version === null ? 'attribute_not_exists(pk)' : 'revision = :revision',
              ...(c.version === null ? {} : { ExpressionAttributeValues: { ':revision': c.version } }),
            },
          })),
        }),
      );
      return true;
    } catch (error) {
      if ((error as Error).name === 'TransactionCanceledException') return false;
      throw error;
    }
  }
  async leaders() {
    const rows = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'leaderboard',
        KeyConditionExpression: 'board = :board',
        ExpressionAttributeValues: { ':board': 'careers-v2' },
        ScanIndexForward: false,
        Limit: 10,
      }),
    );
    return (rows.Items ?? []).map((row) => row.value as CareerProfile);
  }
}
export class CareerRepository {
  constructor(private backend: CareerBackend) {}
  async profile(id: string) {
    return (await this.backend.get<CareerProfile>(`player:${id}`)).value ?? newCareer(id);
  }
  async update(id: string, change: (p: CareerProfile) => CareerProfile) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await this.backend.get<CareerProfile>(`player:${id}`);
      const next = change(row.value ?? newCareer(id));
      if (await this.backend.set(`player:${id}`, row.version, next)) return next;
    }
    throw new Error('Career update contention');
  }
  async save(id: string, session: string, stats: CareerContribution) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const [profile, entry] = await Promise.all([
        this.backend.get<CareerProfile>(`player:${id}`),
        this.backend.get<{ id: string; stats: CareerContribution }>(`session:${session}`),
      ]);
      if (entry.value && entry.value.id !== id) throw new Error('Session owner mismatch');
      const previous = entry.value?.stats;
      if (
        previous &&
        ((stats.revision ?? 0) < (previous.revision ?? 0) || JSON.stringify(previous) === JSON.stringify(stats))
      )
        return profile.value ?? newCareer(id);
      const next = applyContribution(profile.value ?? newCareer(id), session, stats, previous);
      next.contributions = {};
      // Contributions remain in their separate ledger; retain only current/recent objective periods.
      next.progress = Object.fromEntries(
        ['d:', 'w:'].flatMap((prefix) =>
          Object.entries(next.progress)
            .filter(([key]) => key.startsWith(prefix))
            .sort(([a], [b]) => b.localeCompare(a))
            .slice(0, 8),
        ),
      );
      unlockCosmetics(next);
      if (
        await this.backend.commit([
          { key: `player:${id}`, version: profile.version, value: next },
          { key: `session:${session}`, version: entry.version, value: { id, stats } },
        ])
      )
        return next;
    }
    throw new Error('Career contribution contention');
  }
  async claim(id: string, target: string, now = Date.now()) {
    const objective = activeObjectives(now).find((o) => `${o.period}:${o.id}` === target);
    if (!objective) throw new Error('Objective expired');
    for (let attempt = 0; attempt < 8; attempt++) {
      const [row, claim] = await Promise.all([
        this.backend.get<CareerProfile>(`player:${id}`),
        this.backend.get(`claim:${id}:${target}`),
      ]);
      const profile = row.value ?? newCareer(id);
      if (claim.value) return profile;
      if ((profile.progress[objective.period]?.[objective.metric] ?? 0) < objective.goal)
        throw new Error('Objective incomplete');
      profile.claimCount = (profile.claimCount ?? profile.claims.length) + 1;
      profile.claims = [...profile.claims, target].slice(-64);
      unlockCosmetics(profile);
      if (
        await this.backend.commit([
          { key: `player:${id}`, version: row.version, value: profile },
          { key: `claim:${id}:${target}`, version: claim.version, value: { claimed: now } },
        ])
      )
        return profile;
    }
    throw new Error('Claim contention');
  }
  async equip(id: string, cosmeticId: string) {
    const cosmetic = COSMETICS.find((c) => c.id === cosmeticId);
    if (!cosmetic) throw new Error('Unknown cosmetic');
    return this.update(id, (p) => {
      unlockCosmetics(p);
      if (!p.unlocked.includes(cosmeticId)) throw new Error('Cosmetic locked');
      p.equipped[cosmetic.slot] = cosmeticId;
      return p;
    });
  }
  async readRoom(invite: string) {
    return (await this.backend.get<import('@xeom-rush/shared').DurableRoom>(`private-room:${invite}`)).value;
  }
  async writeRoom(invite: string, value: import('@xeom-rush/shared').DurableRoom) {
    for (let i = 0; i < 8; i++) {
      const row = await this.backend.get(`private-room:${invite}`);
      if (await this.backend.set(`private-room:${invite}`, row.version, value)) return;
    }
    throw new Error('Room checkpoint contention');
  }
  async secret() {
    const row = await this.backend.get<string>('identity-key');
    if (row.value) return row.value;
    const key = randomBytes(32).toString('hex');
    if (await this.backend.set('identity-key', row.version, key)) return key;
    const stored = await this.backend.get<string>('identity-key');
    if (!stored.value) throw new Error('Identity key unavailable');
    return stored.value;
  }
  leaders() {
    return this.backend.leaders();
  }
}
export let careerRepository = new CareerRepository(new MemoryCareerBackend());
export function configureCareers(backend: CareerBackend) {
  careerRepository = new CareerRepository(backend);
}
