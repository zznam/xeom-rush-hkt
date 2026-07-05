import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Force Vite to include and pre-bundle shared CJS package
    include: ['@xeom-rush/shared'],
  },
});
