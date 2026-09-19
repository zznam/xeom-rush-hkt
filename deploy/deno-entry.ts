import process from 'node:process';

// Enforce production protections regardless of provider environment defaults.
process.env.NODE_ENV = 'production';
await import('../apps/server/dist/index.js');
