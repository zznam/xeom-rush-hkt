import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3002' } },
  optimizeDeps: { include: ['@xeom-rush/shared'], force: true },
});
