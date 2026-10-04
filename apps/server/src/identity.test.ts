import { describe, expect, it } from 'vitest';
import { issueIdentity, verifyIdentity } from './identity';
describe('deployment guest identity', () => {
  it('verifies throughout a deployment using its common secret and rejects other deployments', () => {
    const secret = 's'.repeat(32);
    const guest = issueIdentity('aws', secret);
    expect(verifyIdentity(guest, 'aws', secret)).toMatch(/^[a-f0-9-]{36}$/);
    expect(verifyIdentity(guest, 'legacy', secret)).toBe(null);
    expect(verifyIdentity(guest, 'aws', 'x'.repeat(32))).toBe(null);
    expect(verifyIdentity(guest.slice(0, -1), 'aws', secret)).toBe(null);
    expect(verifyIdentity({ guest }, 'aws', secret)).toBe(null);
  });
});
