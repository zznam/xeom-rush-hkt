import { readFileSync } from 'node:fs';
import { smoke } from '../tests/regional-live.mjs';
const manifest = JSON.parse(readFileSync('release/manifest.json', 'utf8'));
if (manifest.target !== 'regional-production')
  throw new Error('Only AWS regional-production artifacts can be published here');
if (!manifest.regions.length) throw new Error('No regions in release');
for (const region of manifest.regions) await smoke(region.apiUrl, region.id, manifest.revision);
