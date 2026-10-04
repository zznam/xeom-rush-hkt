import { readStored, writeStored } from './preferences';
import { regions } from './matchmaking';
export function roomApiBase(serverUrl: string) {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.split('/private/')[0].replace(/\/$/, '');
  return url.toString().replace(/\/$/, '');
}
export async function roomGuest(identityUrl: string) {
  const url = new URL(identityUrl),
    region = regions.find((r) => new URL(r.apiUrl).host === url.host),
    key = `guest:${region?.id ?? url.host}`;
  let guest = readStored(key);
  if (!guest) {
    const r = await fetch(`${identityUrl}/api/guest`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('Chưa tạo được hồ sơ tài xế.');
    guest = (await r.json()).guest;
    writeStored(key, guest);
  }
  return guest;
}
