import { managedGuest } from './guest';
import { readStored, writeStored } from './preferences';
import { resolveDeploymentTarget, resolveRegions, type Region } from '@xeom-rush/shared';

export const regions = resolveRegions(
  resolveDeploymentTarget(import.meta.env.VITE_DEPLOY_TARGET),
  import.meta.env.VITE_REGIONS_JSON,
  import.meta.env.PROD,
);

export async function measureRegions(): Promise<Record<string, number | null>> {
  return Object.fromEntries(
    await Promise.all(
      regions.map(async (region) => {
        const start = performance.now();
        try {
          const response = await fetch(`${region.apiUrl}/api/latency`, {
            signal: AbortSignal.timeout(3000),
            cache: 'no-store',
          });
          if (!response.ok) throw new Error();
          return [region.id, Math.round(performance.now() - start)];
        } catch {
          return [region.id, null];
        }
      }),
    ),
  );
}

export async function matchRegion(region: Region): Promise<{ wsUrl: string; room: string }> {
  const deploymentGuest = await managedGuest(region.apiUrl, region.id);
  let guest = deploymentGuest || readStored(`guest:${region.id}`);
  if (!guest) {
    const response = await fetch(`${region.apiUrl}/api/guest`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Chưa tạo được hồ sơ tài xế. Vui lòng thử lại.');
    guest = (await response.json()).guest;
    writeStored(`guest:${region.id}`, guest);
  }
  const response = await fetch(`${region.apiUrl}/api/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ region: region.id, session: crypto.randomUUID(), guest }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 400
        ? 'Hồ sơ khu vực chưa hợp lệ. Vui lòng liên hệ hỗ trợ trước khi xóa dữ liệu trình duyệt.'
        : 'Khu vực đang đông hoặc tạm nghỉ. Thử lại hoặc chọn khu vực khác nhé!',
    );
  const match = await response.json();
  const target = new URL(match.wsUrl);
  const expected = new URL(region.apiUrl);
  if (target.host !== expected.host || target.protocol !== (expected.protocol === 'https:' ? 'wss:' : 'ws:'))
    throw new Error('Địa chỉ thành phố chưa hợp lệ.');
  if (deploymentGuest) {
    target.searchParams.set('guest', deploymentGuest);
    target.searchParams.set('managed', '1');
  }
  return { ...match, wsUrl: target.toString() };
}
