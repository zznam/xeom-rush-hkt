export type DeploymentTarget = 'legacy' | 'regional-production';
export interface Region {
  id: string;
  label: string;
  apiUrl: string;
}

export function resolveDeploymentTarget(value?: string): DeploymentTarget {
  if (!value || value === 'legacy') return 'legacy';
  if (value === 'regional-production') return value;
  throw new Error('Deployment target must be legacy or regional-production');
}

export function resolveRegions(target: DeploymentTarget, json?: string, requireHttps = true): Region[] {
  // A stale AWS setting must never change the default deployment or break it.
  if (target === 'legacy') return [];
  const regions: Region[] = JSON.parse(json || '[]');
  if (!Array.isArray(regions) || regions.length < 1 || regions.length > 20)
    throw new Error('regional-production requires a region directory with 1-20 regions');
  const ids = new Set<string>();
  for (const region of regions) {
    if (
      !region ||
      typeof region.id !== 'string' ||
      !/^[a-z0-9-]{1,32}$/.test(region.id) ||
      ids.has(region.id) ||
      typeof region.label !== 'string' ||
      !region.label.trim() ||
      region.label.length > 64 ||
      typeof region.apiUrl !== 'string'
    )
      throw new Error('Invalid or duplicate region');
    ids.add(region.id);
    const url = new URL(region.apiUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== region.apiUrl ||
      (requireHttps && url.protocol !== 'https:')
    )
      throw new Error('Region API must be an HTTPS origin (HTTP is allowed only in development)');
  }
  return regions;
}
