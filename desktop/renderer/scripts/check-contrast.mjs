/**
 * WCAG AA for the Quorum tokens, in both themes: every text color on every
 * surface the UI puts it on reaches 4.5:1, and focus rings and status dots
 * reach 3:1. Translucent tints are blended over the surface they sit on.
 * When the UI puts a new text or status color on a surface, add the pair here.
 *
 * Run: node renderer/scripts/check-contrast.mjs (from desktop/)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SURFACES = ['bg-0', 'bg-1', 'bg-2', 'bg-3', 'bg-4'];
const STATES = ['healthy', 'warning', 'critical', 'info', 'running', 'unknown'];

/** [foreground, background, minimum ratio]. A background "x over y" is tint x blended onto y. */
const PAIRS = [
  ...['text-1', 'text-2', 'text-3'].flatMap((t) => SURFACES.map((s) => [t, s, 4.5])),
  ...['bg-0', 'bg-2', 'bg-3'].map((s) => ['accent-text', s, 4.5]),
  ['text-inverse', 'accent', 4.5], // primary button label
  ...STATES.flatMap((st) => [
    [`${st}-text`, 'bg-2', 4.5],
    [`${st}-text`, 'bg-3', 4.5],
    [`${st}-text`, `${st}-subtle over bg-2`, 4.5], // status badge label on its tint
  ]),
  // Banners sit on the page; the app raises errors (critical) and updates (info).
  ...['critical', 'info'].map((st) => [`${st}-text`, `${st}-subtle over bg-0`, 4.5]),
  ['accent', 'bg-0', 3], // focus ring
  ['accent', 'bg-2', 3],
  ...['healthy', 'warning', 'critical', 'running'].map((st) => [st, 'bg-2', 3]), // status dots
];

function declarations(text) {
  const out = {};
  for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** Dark is :root; light overrides it. */
export function parseThemes(css) {
  const dark = /:root,\s*\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const light = /\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const d = declarations(dark);
  return { dark: d, light: { ...d, ...declarations(light) } };
}

function resolve(theme, name) {
  let value = theme[name];
  for (let i = 0; value && i < 10; i++) {
    const m = /^var\(--([\w-]+)\)$/.exec(value);
    if (!m) break;
    value = theme[m[1]];
  }
  if (!value) throw new Error(`--${name} is not defined`);
  return value;
}

function rgba(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (fn) {
    const [r, g, b, a = '1'] = fn[1].split(',').map((x) => x.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`"${value}" is not a color`);
}

const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];

function color(theme, spec) {
  const [tint, base] = spec.split(' over ');
  const c = rgba(resolve(theme, tint));
  return base ? over(c, color(theme, base)) : c;
}

function luminance([r, g, b]) {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** "light: text-3 on bg-4 is 4.21:1, needs 4.5" for every failing pair; [] when all pass. */
export function checkContrast(css) {
  const failures = [];
  for (const [name, theme] of Object.entries(parseThemes(css))) {
    for (const [fg, bg, min] of PAIRS) {
      const background = color(theme, bg);
      const r = ratio(over(color(theme, fg), background), background);
      if (r < min) failures.push(`${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}`);
    }
  }
  return failures;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2] ?? fileURLToPath(new URL('../src/styles/quorum/colors.css', import.meta.url));
  const failures = checkContrast(readFileSync(file, 'utf8'));
  for (const f of failures) console.error(f);
  if (failures.length) process.exit(1);
  console.log(`contrast: ${PAIRS.length} pairs pass AA in both themes`);
}
