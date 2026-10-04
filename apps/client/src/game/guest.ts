import { readStored, writeStored } from './preferences';

/** A deployment-wide browser identity; regional credentials are proof for career migration only. */
export async function managedGuest(apiUrl: string, region?: string): Promise<string | null> {
  const response = await fetch(`${apiUrl}/api/capabilities`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Chưa xác minh được thành phố. Vui lòng thử lại.');
  const capabilities = await response.json();
  if (!capabilities.managed) return null;
  if (typeof capabilities.deployment !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(capabilities.deployment))
    throw new Error('Thông tin thành phố không hợp lệ.');
  const key = `guest:deployment:${capabilities.deployment}`;
  let guest = readStored(key);
  if (!guest) {
    const issued = await fetch(`${apiUrl}/api/guest`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (!issued.ok) throw new Error('Chưa tạo được hồ sơ tài xế.');
    const body = await issued.json();
    if (typeof body.guest !== 'string' || !body.guest.startsWith(`v2.${capabilities.deployment}.`))
      throw new Error('Hồ sơ tài xế không hợp lệ.');
    guest = body.guest;
    writeStored(key, guest);
  }
  const legacy = region ? readStored(`guest:${region}`) : '';
  if (legacy) {
    const linked = await fetch(`${apiUrl}/api/guest/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest, legacy }),
      signal: AbortSignal.timeout(10000),
    });
    if (!linked.ok) throw new Error('Chưa liên kết được tiến trình cũ. Vui lòng giữ dữ liệu trình duyệt và thử lại.');
  }
  return guest;
}
