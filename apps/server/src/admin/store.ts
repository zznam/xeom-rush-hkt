import type { KvStore } from '../storage';

export interface Stored<T = unknown> {
  key: string;
  value: T | null;
  version: string | null;
}
export interface ControlStore {
  get<T>(key: string): Promise<Stored<T>>;
  list<T>(prefix: string, limit?: number): Promise<Stored<T>[]>;
  commit(checks: Stored[], writes: { key: string; value: unknown | null }[]): Promise<boolean>;
  close(): void;
}
/** Only for explicitly opted-in local development and tests; never production. */
export class MemoryControlStore implements ControlStore {
  private values = new Map<string, Stored>();
  private revision = 0;
  async get<T>(key: string): Promise<Stored<T>> {
    return structuredClone(this.values.get(key) ?? { key, value: null, version: null }) as Stored<T>;
  }
  async list<T>(prefix: string, limit = 500): Promise<Stored<T>[]> {
    return structuredClone(
      [...this.values.values()]
        .filter((v) => v.key.startsWith(prefix))
        .sort((a, b) => a.key.localeCompare(b.key))
        .slice(0, limit),
    ) as Stored<T>[];
  }
  async commit(checks: Stored[], writes: { key: string; value: unknown | null }[]): Promise<boolean> {
    if (checks.some((c) => (this.values.get(c.key)?.version ?? null) !== c.version)) return false;
    for (const w of writes) {
      if (w.value === null) this.values.delete(w.key);
      else this.values.set(w.key, { key: w.key, value: structuredClone(w.value), version: String(++this.revision) });
    }
    return true;
  }
  close(): void {}
}
export class KvControlStore implements ControlStore {
  constructor(private kv: KvStore) {}
  private key(key: string) {
    return ['admin-v1', ...key.split('/')];
  }
  async get<T>(key: string): Promise<Stored<T>> {
    const row = await this.kv.get<T>(this.key(key));
    return { key, value: row.value, version: row.versionstamp };
  }
  async list<T>(prefix: string, limit = 500): Promise<Stored<T>[]> {
    const rows: Stored<T>[] = [];
    for await (const row of this.kv.list<T>({ prefix: this.key(prefix.replace(/\/$/, '')) }, { limit })) {
      rows.push({ key: row.key.slice(1).join('/'), value: row.value, version: row.versionstamp });
    }
    return rows;
  }
  async commit(checks: Stored[], writes: { key: string; value: unknown | null }[]): Promise<boolean> {
    const tx = this.kv.atomic();
    for (const c of checks) tx.check({ key: this.key(c.key), versionstamp: c.version });
    for (const w of writes) {
      if (w.value === null) tx.delete(this.key(w.key));
      else {
        if (Buffer.byteLength(JSON.stringify(w.value)) > 60000) throw new Error('Control record exceeds storage limit');
        const expiring =
          (w.key.startsWith('oauth/') || w.key.startsWith('sessions/')) &&
          typeof w.value === 'object' &&
          'expiresAt' in w.value &&
          typeof w.value.expiresAt === 'number';
        tx.set(
          this.key(w.key),
          w.value,
          expiring ? { expireIn: Math.max(1, (w.value as { expiresAt: number }).expiresAt - Date.now()) } : undefined,
        );
      }
    }
    return (await tx.commit()).ok;
  }
  close() {
    this.kv.close();
  }
}
