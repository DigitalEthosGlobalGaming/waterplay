/**
 * §13.4.9: fails if dev-only code leaked into production bundles.
 * Run after `npm run build:desktop`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = [
  'dev:save-now',
  'dev:session-save',
  'dev:session-clear',
  'DevSocketTransport',
  'installDevSession',
  'waterplay.devSession',
  'lil-gui',
];
const DIRS = ['dist/web/assets', 'dist-electron'];

const leaks: string[] = [];
for (const dir of DIRS) {
  if (!existsSync(dir)) {
    console.error(`${dir} missing — build first.`);
    process.exit(1);
  }
  for (const name of readdirSync(dir)) {
    if (!/\.(js|cjs|mjs)$/.test(name)) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    for (const s of FORBIDDEN) if (text.includes(s)) leaks.push(`${dir}/${name}: "${s}"`);
  }
}

if (leaks.length) {
  console.error('Dev-only code found in production bundle:');
  for (const l of leaks) console.error(`  ${l}`);
  process.exit(1);
}
console.log('Production bundle check passed.');
