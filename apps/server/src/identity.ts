import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export function issueIdentity(deployment: string, secret: string): string {
  if (secret.length < 32) throw new Error('Guest identity secret must contain at least 32 characters');
  const payload = `v2.${deployment}.${randomUUID()}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`;
}
export function verifyIdentity(value: unknown, deployment: string, secret: string): string | null {
  if (typeof value !== 'string' || value.length > 256 || secret.length < 32) return null;
  const parts = value.split('.');
  if (
    parts.length !== 4 ||
    parts[0] !== 'v2' ||
    parts[1] !== deployment ||
    !/^[a-f0-9-]{36}$/.test(parts[2]) ||
    !/^[a-f0-9]{64}$/.test(parts[3])
  )
    return null;
  const expected = createHmac('sha256', secret).update(parts.slice(0, 3).join('.')).digest();
  return timingSafeEqual(expected, Buffer.from(parts[3], 'hex')) ? parts[2] : null;
}
