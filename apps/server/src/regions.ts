import { resolveDeploymentTarget, resolveRegions } from '@xeom-rush/shared';

export function regionsFromEnv() {
  return resolveRegions(
    resolveDeploymentTarget(process.env.DEPLOY_TARGET),
    process.env.REGIONS_JSON,
    process.env.NODE_ENV === 'production',
  );
}
