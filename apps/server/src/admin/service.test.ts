import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { cityKey, defaultCityConfig, type AdminStaff, type CityReport, type AdminCommand } from '@xeom-rush/shared';
import { MemoryControlStore } from './store';
import { ControlService, deploymentRecord } from './service';
const owner: AdminStaff = { id: '1', login: 'owner', role: 'owner' };
const deployment = deploymentRecord('test', 'Test', ['local', 'sg'], 'a'.repeat(32));
let now: number;
let service: ControlService;
let report: CityReport;
const request = () => ({
  id: randomUUID(),
  runtimeId: report.ref.runtimeId,
  expectedRevision: 0,
  action: { type: 'pause' as const },
});
beforeEach(async () => {
  now = 100000;
  service = new ControlService(new MemoryControlStore(), () => now);
  await service.bootstrap('1', [deployment]);
  report = {
    ref: { deployment: 'test', region: 'local', room: 'local', runtimeId: randomUUID(), persistent: false },
    revision: 0,
    config: defaultCityConfig(),
    tick: 1,
    tickMs: 2,
    humans: 0,
    bots: { current: 8, requested: 8, retiring: 0 },
    paused: false,
    admissionsOpen: true,
    lastSeen: now,
  };
  await service.report(report, deployment);
});
describe('control delivery and authorization', () => {
  it('distinguishes accepted from applied and idempotently retries submissions', async () => {
    const input = request();
    const key = cityKey(report.ref);
    const first = await service.submit(owner, key, input);
    expect(first.status).toBe('pending');
    expect(await service.submit(owner, key, input)).toEqual(first);
    await service.acknowledge(report.ref, first.id, 'applied', 'Done');
    expect((await service.poll(report.ref)).config?.revision).toBe(1);
    expect((await service.acknowledge(report.ref, first.id, 'applied', 'Done'))?.status).toBe('applied');
    expect((await service.poll(report.ref)).config?.revision).toBe(1);
  });
  it('rejects request ID reuse with different actions', async () => {
    const input = request();
    await service.submit(owner, cityKey(report.ref), input);
    await expect(service.submit(owner, cityKey(report.ref), { ...input, action: { type: 'resume' } })).rejects.toThrow(
      'already used',
    );
  });
  it('rejects moderators editing a city and permits announcements', async () => {
    const moderator = { ...owner, role: 'moderator' as const };
    await expect(service.submit(moderator, cityKey(report.ref), request())).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await service.submit(moderator, cityKey(report.ref), {
          ...request(),
          action: { type: 'announce', message: 'Hello' },
        })
      ).status,
    ).toBe('pending');
  });
  it('atomically accepts only one concurrent edit', async () => {
    const outcomes = await Promise.allSettled([
      service.submit(owner, cityKey(report.ref), request()),
      service.submit(owner, cityKey(report.ref), request()),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('rejects stale revisions and wrong runtimes', async () => {
    await expect(service.submit(owner, cityKey(report.ref), { ...request(), expectedRevision: 4 })).rejects.toThrow(
      'changed',
    );
    await expect(service.submit(owner, cityKey(report.ref), { ...request(), runtimeId: randomUUID() })).rejects.toThrow(
      'owner',
    );
  });
  it('marks undelivered requests expired and delivered requests unknown', async () => {
    const command = await service.submit(owner, cityKey(report.ref), request());
    now += 90001;
    await service.expireCommand(command.city, command.id);
    expect((await service.store.get<AdminCommand>(`commands/${command.city}/${command.id}`)).value?.status).toBe(
      'expired',
    );
    report.lastSeen = now;
    await service.report(report, deployment);
    const next = await service.submit(owner, cityKey(report.ref), request());
    await service.poll(report.ref);
    now += 90001;
    await service.expireCommand(next.city, next.id);
    expect((await service.store.get<AdminCommand>(`commands/${next.city}/${next.id}`)).value?.status).toBe('unknown');
  });
  it('recovers a lost acknowledgement after expiry without replaying execution', async () => {
    const command = await service.submit(owner, cityKey(report.ref), request());
    await service.poll(report.ref);
    now += 90001;
    await service.expireCommand(command.city, command.id);
    await service.report({ ...report, revision: 1 }, deployment);
    await expect(service.submit(owner, cityKey(report.ref), request())).rejects.toThrow('reconcile');
    await service.acknowledge(report.ref, command.id, 'applied', 'Late ack');
    expect((await service.poll(report.ref)).config?.revision).toBe(1);
  });
  it('fences persistent room ownership and never delivers old-owner commands to a new owner', async () => {
    report.ref.persistent = true;
    await service.report(report, deployment);
    const command = await service.submit(owner, cityKey(report.ref), request());
    const next = { ...report, ref: { ...report.ref, runtimeId: randomUUID() } };
    await expect(service.report(next, deployment)).rejects.toThrow('live owner');
    now += 16000;
    await service.report(next, deployment);
    expect((await service.poll(next.ref)).command).toBe(null);
    await expect(service.acknowledge(report.ref, command.id, 'applied', 'stale')).rejects.toThrow('ownership');
  });
  it('rejects credentials and deployment/region spoofing', async () => {
    await expect(service.authenticateWorker('test', 'b'.repeat(32))).rejects.toMatchObject({ status: 403 });
    expect(() => service.validateRef({ ...report.ref, region: 'unregistered' }, deployment)).toThrow('identity');
  });
  it('preserves saved AWS configuration when its owner restarts', async () => {
    report.ref.persistent = true;
    await service.report(report, deployment);
    const config = defaultCityConfig();
    config.bots.count = 12;
    const command = await service.submit(owner, cityKey(report.ref), {
      ...request(),
      action: { type: 'configure', config },
    });
    await service.acknowledge(report.ref, command.id, 'applied', 'Done');
    now += 16000;
    report.ref.runtimeId = randomUUID();
    await service.report(report, deployment);
    expect((await service.poll(report.ref)).config?.config.bots.count).toBe(12);
  });
  it('enforces deployment-wide bans, expiry and revocation', async () => {
    const guestId = randomUUID();
    const key = `bans/test/${guestId}`;
    const ban = { deployment: 'test', guestId, reason: 'Spam', expiresAt: now + 1000, actor: '1', createdAt: now };
    await service.put(key, ban);
    expect(await service.isBanned('test', guestId)).toBe(true);
    expect(await service.isBanned('different', guestId)).toBe(false);
    now += 1001;
    expect(await service.isBanned('test', guestId)).toBe(false);
    await service.put(key, { ...ban, expiresAt: null });
    expect(await service.isBanned('test', guestId)).toBe(true);
    await service.put(key, { ...ban, expiresAt: null, revokedAt: now });
    expect(await service.isBanned('test', guestId)).toBe(false);
  });
});
