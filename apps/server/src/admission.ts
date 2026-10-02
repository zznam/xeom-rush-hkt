import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export const isSessionId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

export function issueGuest(secret: string): string {
  const id = randomUUID();
  return `${id}.${createHmac('sha256', secret).update(`guest:${id}`).digest('hex')}`;
}

export const roomKey = (secret: string): string => createHmac('sha256', secret).update('matchmaker-rpc').digest('hex');
export function validRoomKey(value: unknown, secret: string): boolean {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(roomKey(secret), 'hex'))
  );
}

export function verifyGuest(token: unknown, secret: string): string | null {
  if (typeof token !== 'string' || token.length !== 101) return null;
  const [id, signature] = token.split('.');
  if (!isSessionId(id) || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const expected = createHmac('sha256', secret).update(`guest:${id}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? id : null;
}

interface Reservation {
  ticket: string;
  session: string;
  profileId: string;
  expires: number;
  claimed: boolean;
}

// Lives on the authoritative room owner. No awaits occur between capacity check
// and insertion: concurrent requests cannot allocate the same last seat.
export class Admission {
  private reservations = new Map<string, Reservation>();
  constructor(
    private capacity: number,
    private occupied: () => number,
    private now = Date.now,
  ) {}

  private prune(): void {
    for (const [key, value] of this.reservations) {
      if (value.expires <= this.now()) this.reservations.delete(key);
    }
  }
  get available(): number {
    this.prune();
    return Math.max(0, this.capacity - this.occupied() - this.reservations.size);
  }
  reserve(session: string, profileId: string): Reservation | null {
    this.prune();
    const previous = this.reservations.get(session);
    if (previous) return previous.profileId === profileId && !previous.claimed ? previous : null;
    if (!this.available) return null;
    const value = { session, profileId, ticket: randomUUID(), expires: this.now() + 15000, claimed: false };
    this.reservations.set(session, value);
    return value;
  }
  claim(session: string, ticket: string): Reservation | null {
    this.prune();
    const value = this.reservations.get(session);
    if (!value || value.ticket !== ticket || value.claimed) return null;
    value.claimed = true;
    return value;
  }
  consume(session: string, ticket: string): string | null {
    this.prune();
    const value = this.reservations.get(session);
    if (!value?.claimed || value.ticket !== ticket) return null;
    this.reservations.delete(session);
    return value.profileId;
  }
  release(session: string, ticket: string): void {
    if (this.reservations.get(session)?.ticket === ticket) this.reservations.delete(session);
  }
}
