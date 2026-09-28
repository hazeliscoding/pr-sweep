/**
 * Times sweeps against the live API with the app's own GithubService, so the
 * numbers match the PRSWEEP_DEBUG line. Used for the performance budget in
 * ROADMAP.md. Read-only; your config and snapshot are never touched.
 *
 * Usage (from desktop/, after `npm run build:main`):
 *   GH_TOKEN=$(gh auth token) node e2e/bench-sweep.mjs <org> [login,login,…] [runs]
 *
 * Each run is a full sweep, then an auto-refresh patched onto its result. The
 * range is the app's default: the last 30 days, open-ended.
 */
import { GithubService } from '../dist/main/main/core/github.service.js';

const [org, authorsArg = '', runsArg = '5'] = process.argv.slice(2);
if (!org || !process.env.GH_TOKEN) {
  console.error('Usage: GH_TOKEN=$(gh auth token) node e2e/bench-sweep.mjs <org> [login,login,…] [runs]');
  process.exit(1);
}
const authors = authorsArg ? authorsArg.split(',') : [];
const runs = Number(runsArg);
const range = { start: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), end: null };
const config = {
  profiles: [{ id: 'bench', name: 'bench', org, authors, range, includeDrafts: false, staleDays: 5 }],
  activeProfileId: 'bench',
  autoRefreshMinutes: 5,
  notifications: false,
  closeToTray: false,
  oauthClientId: '',
};

const github = new GithubService(() => process.env.GH_TOKEN);
const results = { full: [], auto: [] };

function record(kind, run, error) {
  const s = github.lastSweep;
  results[kind].push(s);
  console.log(
    `${kind} ${run}: ${s.mode}${s.ok ? '' : ` FAILED (${error})`} · ${(s.ms / 1000).toFixed(1)} s · ` +
      `${s.requests} requests · ${s.retries} retries`,
  );
}

console.log(`${org} · ${authors.length ? authors.join(', ') : 'whole org'} · ${range.start}.. · ${runs} runs`);
for (let run = 1; run <= runs; run++) {
  let base = null;
  try {
    base = await github.sweep(config, range);
    record('full', run);
  } catch (e) {
    record('full', run, e.message);
    continue;
  }
  try {
    await github.sweep(config, range, base);
    record('auto', run);
  } catch (e) {
    record('auto', run, e.message);
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const [kind, list] of Object.entries(results)) {
  const ok = list.filter((s) => s.ok);
  if (!list.length) continue;
  if (!ok.length) {
    console.log(`${kind}: failed ${list.length} of ${list.length}`);
    continue;
  }
  console.log(
    `${kind}: median ${(median(ok.map((s) => s.ms)) / 1000).toFixed(1)} s · ` +
      `${median(ok.map((s) => s.requests))} requests · ${ok.reduce((n, s) => n + s.retries, 0)} retries total · ` +
      `${ok.length} of ${list.length} ok`,
  );
}
