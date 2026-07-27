/**
 * Runs after `vite build` (see the `build` script in package.json). Vite
 * already content-hashes every filename under dist/assets/, so hashing that
 * filename list is itself a content hash of the build — no need to re-read
 * every file. Stamping CACHE_NAME with it means any JS/CSS change produces a
 * different cache name, which is what makes the service worker's
 * update-toast flow actually fire: the old hardcoded 'book-cricket-v1' never
 * changed on a normal deploy, so a new build's install event saw an
 * already-existing cache of the same name and had nothing to signal.
 *
 * public/sw.js (used verbatim by `npm run dev`) keeps its plain
 * 'book-cricket-v1' placeholder — only the built dist/sw.js gets stamped.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const distDir = 'dist';
const assetsDir = join(distDir, 'assets');
const swPath = join(distDir, 'sw.js');

if (!existsSync(swPath)) {
  console.error(`stamp-sw-cache: ${swPath} not found — did vite build run first?`);
  process.exit(1);
}

const assetFiles = existsSync(assetsDir) ? readdirSync(assetsDir).sort() : [];
const hash = createHash('sha256').update(assetFiles.join('|')).digest('hex').slice(0, 10);

const sw = readFileSync(swPath, 'utf8');
const stamped = sw.replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'book-cricket-${hash}';`);

if (stamped === sw) {
  console.error(
    'stamp-sw-cache: CACHE_NAME pattern not found in dist/sw.js — check public/sw.js still declares it the same way.',
  );
  process.exit(1);
}

writeFileSync(swPath, stamped);
console.log(`stamp-sw-cache: CACHE_NAME -> book-cricket-${hash}`);
