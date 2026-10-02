import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveDeploymentTarget, resolveRegions } from '@xeom-rush/shared';

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target = resolveDeploymentTarget(env.VITE_DEPLOY_TARGET);
  // Reject incomplete AWS builds before publishing; legacy builds need no AWS settings.
  const regions = resolveRegions(target, env.VITE_REGIONS_JSON, command === 'build');
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_DEPLOY_TARGET': JSON.stringify(target),
      'import.meta.env.VITE_REGIONS_JSON': JSON.stringify(JSON.stringify(regions)),
    },
    optimizeDeps: {
      // Shared workspace exports can change without a lockfile change.
      force: true,
      include: ['@xeom-rush/shared'],
    },
  };
});
