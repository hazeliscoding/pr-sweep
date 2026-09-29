/**
 * Keeps the renderer on Quorum and off the network:
 *  - no remote URL anywhere in its source except the GitHub pages the app
 *    opens in the browser (and the SVG namespace), so it never loads fonts,
 *    icons or scripts from a CDN: the "only GitHub" promise;
 *  - fonts only through the Quorum font tokens (Manrope, IBM Plex Mono);
 *  - with --colors, no raw colors outside the token files (styles/quorum/).
 *
 * Run: node renderer/scripts/check-assets.mjs [--colors] [dir] (from desktop/)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_URL = /^(https:\/\/github\.com\/|http:\/\/www\.w3\.org\/2000\/svg$)/;
const TOKENS_DIR = `styles${sep}quorum${sep}`;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(css|ts|html)$/.test(name) ? [path] : [];
  });
}

/** "app/x.css:3: remote URL https://…" for every violation under `dir`; [] when clean. */
export function checkAssets(dir, { colors }) {
  const failures = [];
  for (const path of files(dir)) {
    const rel = relative(dir, path);
    const tokens = rel.startsWith(TOKENS_DIR);
    const css = path.endsWith('.css');
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const at = `${rel.split(sep).join('/')}:${i + 1}`;
        for (const [url] of line.matchAll(/\bhttps?:\/\/[^\s'"`)]+/g)) {
          if (css || !ALLOWED_URL.test(url)) failures.push(`${at}: remote URL ${url}`);
        }
        if (tokens) return;
        for (const m of line.matchAll(/\bfont(?:-family)?\s*:\s*([^;}]+)/g)) {
          if (!/var\(--(font|text)-|^\s*inherit/.test(m[1])) failures.push(`${at}: font "${m[1].trim()}" — use var(--font-sans), var(--font-mono) or a --text-* token`);
        }
        if (colors && css) {
          for (const [c] of line.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g)) {
            failures.push(`${at}: raw color ${c} — use a Quorum color token`);
          }
        }
      });
  }
  return failures;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('../src', import.meta.url));
  const failures = checkAssets(dir, { colors: args.includes('--colors') });
  for (const f of failures) console.error(f);
  if (failures.length) process.exit(1);
  console.log(`assets: no remote URLs or stray fonts${args.includes('--colors') ? ', no raw colors' : ''}`);
}
