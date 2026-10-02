import { describe, expect, it } from 'vitest';
import { Admission, issueGuest, verifyGuest } from './admission';

describe('regional admission', () => {
  it('bounds reservations plus connected and reconnecting players', () => {
    let occupied = 1;
    const admission = new Admission(2, () => occupied);
    const a = admission.reserve('a', 'guest-a')!;
    expect(admission.reserve('b', 'guest-b')).toBeNull();
    expect(admission.reserve('a', 'guest-a')).toEqual(a);
    expect(admission.reserve('a', 'impostor')).toBeNull();
    expect(admission.claim('a', 'wrong')).toBeNull();
    expect(admission.claim('a', a.ticket)).not.toBeNull();
    expect(admission.claim('a', a.ticket)).toBeNull();
    expect(admission.consume('a', a.ticket)).toBe('guest-a');
    occupied++;
    expect(admission.available).toBe(0);
    expect(admission.reserve('b', 'guest-b')).toBeNull();
  });
  it('reclaims abandoned reservations and rejects expired tickets', () => {
    let now = 0;
    const admission = new Admission(
      2,
      () => 0,
      () => now,
    );
    const a = admission.reserve('a', 'guest')!;
    now = 15000;
    expect(admission.claim('a', a.ticket)).toBeNull();
    expect(admission.available).toBe(2);
  });
  it('an old connection cannot consume or release a newer reservation', () => {
    let now = 0;
    const admission = new Admission(
      2,
      () => 0,
      () => now,
    );
    const old = admission.reserve('session', 'guest')!;
    admission.claim('session', old.ticket);
    now = 16000;
    const next = admission.reserve('session', 'guest')!;
    admission.claim('session', next.ticket);
    admission.release('session', old.ticket);
    expect(admission.consume('session', old.ticket)).toBeNull();
    expect(admission.consume('session', next.ticket)).toBe('guest');
  });
  it('does not let concurrent last-seat requests oversubscribe', async () => {
    const admission = new Admission(2, () => 1);
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => Promise.resolve().then(() => admission.reserve(String(i), 'guest'))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('authenticates identity independently of nicknames and rejects tampering', () => {
    const secret = 'test-secret-longer-than-thirty-two-characters';
    const token = issueGuest(secret);
    expect(verifyGuest(token, secret)).toBe(token.split('.')[0]);
    expect(verifyGuest(token, 'different region')).toBeNull();
    expect(verifyGuest(`${token.slice(0, -1)}x`, secret)).toBeNull();
    expect(verifyGuest('nickname', secret)).toBeNull();
    expect(issueGuest(secret)).not.toBe(token);
  });
});
