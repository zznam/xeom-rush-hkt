import { expect, it, vi } from 'vitest';
import { findMatch } from './matchmaking';

it('packs players together, skips failed rooms and retries a capacity race locally', async () => {
  const reserveOrder: string[] = [];
  const request = vi.fn(async (url: any, options?: any) => {
    if (!options?.method) {
      if (url.includes('dead')) throw new Error('offline');
      return Response.json({ available: 1, players: url.includes('busy') ? 4 : 0 });
    }
    reserveOrder.push(url);
    expect(options.headers['x-matchmaker-key']).toBe('rpc-key');
    return url.includes('busy')
      ? new Response('', { status: 409 })
      : Response.json({ ticket: 'ticket', expires: 10000 });
  });
  const result = await findMatch(
    [
      { id: 'empty', url: 'https://sg.example/rooms/empty' },
      { id: 'dead', url: 'https://sg.example/rooms/dead' },
      { id: 'busy', url: 'https://sg.example/rooms/busy' },
    ],
    'session',
    'guest',
    'rpc-key',
    request as typeof fetch,
  );
  expect(reserveOrder).toEqual([
    'https://sg.example/rooms/busy/api/reservations',
    'https://sg.example/rooms/empty/api/reservations',
  ]);
  expect(result?.room).toBe('empty');
  expect(result?.wsUrl).toBe('wss://sg.example/rooms/empty?session=session&ticket=ticket');
});

it('returns unavailable without silently matching another region', async () => {
  const request = vi.fn(async () => new Response('', { status: 503 }));
  expect(
    await findMatch([{ id: 'a', url: 'https://sg.example/rooms/a' }], 's', 'g', 'key', request as typeof fetch),
  ).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});
