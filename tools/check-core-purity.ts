/**
 * Enforces §14.1: src/core is pure. It may only import from inside src/core or
 * from src/data (plain tunables), and must not touch browser/Node globals or
 * unseeded randomness (§14.9).
 *
 *   tsx tools/check-core-purity.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CORE = join(ROOT, 'src', 'core');
const ALLOWED_ROOTS = [CORE, join(ROOT, 'src', 'data')];

const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const FORBIDDEN_GLOBALS: Array<[RegExp, string]> = [
  [/\bMath\.random\s*\(/, 'Math.random() — use the seeded Rng (ctx.rng)'],
  [/\bDate\.now\s*\(/, 'Date.now() — sim time comes from the world clock'],
  [/\bperformance\.now\s*\(/, 'performance.now() — sim time comes from the world clock'],
  [/\b(window|document|navigator|localStorage)\b\s*[.[]/, 'browser global'],
  [/\b(process|require|__dirname)\b\s*[.(]/, 'Node global'],
  [/\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/, 'real-time scheduling'],
];

const problems: string[] = [];

for (const file of walk(CORE)) {
  const source = readFileSync(file, 'utf8');
  const code = stripComments(source);
  const rel = relative(ROOT, file);

  for (const m of code.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    if (!spec.startsWith('.')) {
      problems.push(`${rel}: imports package "${spec}" (core may not depend on libraries)`);
      continue;
    }
    const target = resolve(dirname(file), spec);
    if (!ALLOWED_ROOTS.some((r) => target === r || target.startsWith(r + sep))) {
      problems.push(`${rel}: imports "${spec}" from outside src/core and src/data`);
    }
  }

  for (const [re, why] of FORBIDDEN_GLOBALS) {
    if (re.test(code)) problems.push(`${rel}: uses ${why}`);
  }
}

if (problems.length > 0) {
  console.error('Core purity check failed (see docs/architecture.md §14):');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('Core purity check passed.');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) yield p;
  }
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
