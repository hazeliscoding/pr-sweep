/**
 * The design checks, and their positive controls: each check has to pass on
 * the real sources and fail on a planted violation, or it proves nothing.
 * Run: node renderer/scripts/checks.test.mjs (from desktop/)
 */
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAssets } from './check-assets.mjs';
import { checkContrast } from './check-contrast.mjs';

const tokens = fileURLToPath(new URL('../src/styles/quorum/colors.css', import.meta.url));
const src = fileURLToPath(new URL('../src', import.meta.url));

// --- contrast: the real tokens pass ---
{
  const failures = checkContrast(readFileSync(tokens, 'utf8'));
  assert.deepEqual(failures, [], `real tokens: ${failures.join('; ')}`);
}

// --- contrast, positive control: a muted text color that fails AA is caught, in the right theme ---
{
  const css = readFileSync(tokens, 'utf8').replace('--text-2:#525C6B;', '--text-2:#9AA1AC;');
  const failures = checkContrast(css);
  assert.ok(failures.some((f) => f.startsWith('light: text-2 on bg-2')), failures.join('; '));
  assert.ok(!failures.some((f) => f.startsWith('dark:')), 'dark untouched');
}

// --- assets: the real sources pass ---
{
  const failures = checkAssets(src);
  assert.deepEqual(failures, [], failures.join('\n'));
}

// --- assets, positive controls ---
{
  const dir = mkdtempSync(join(tmpdir(), 'prsweep-checks-'));
  mkdirSync(join(dir, 'app'));
  mkdirSync(join(dir, 'styles', 'quorum'), { recursive: true });
  writeFileSync(join(dir, 'app', 'ok.ts'), `const url = 'https://github.com/settings/tokens';\nconst ns = 'http://www.w3.org/2000/svg';\n`);
  writeFileSync(join(dir, 'styles', 'quorum', 'tokens.css'), `:root{ --x:#FFFFFF; --font-sans:"Manrope",sans-serif; }\n`);
  assert.deepEqual(checkAssets(dir), [], 'GitHub links, the SVG namespace and the token files are fine');

  writeFileSync(join(dir, 'app', 'cdn.css'), `@import url('https://fonts.googleapis.com/css2?family=Inter');\n`);
  writeFileSync(join(dir, 'app', 'font.css'), `.x { font-family: Arial, sans-serif; }\n`);
  writeFileSync(join(dir, 'app', 'remote.ts'), `const icon = 'https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js';\n`);
  writeFileSync(join(dir, 'app', 'hex.css'), `.y { color: #ff0000; }\n`);
  const found = checkAssets(dir).join('\n');
  assert.match(found, /cdn\.css:1: remote URL/);
  assert.match(found, /font\.css:1: font/);
  assert.match(found, /remote\.ts:1: remote URL/);
  assert.match(found, /hex\.css:1: raw color/);
}

console.log('checks: contrast and assets pass on the real sources and catch planted violations');
