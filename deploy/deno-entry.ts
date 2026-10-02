import process from 'node:process';

// Enforce production protections regardless of provider environment defaults.
process.env.NODE_ENV = 'production';
// This entrypoint is the default legacy route, even if AWS variables were copied in.
process.env.DEPLOY_TARGET = 'legacy';
await import('../apps/server/dist/index.js');
