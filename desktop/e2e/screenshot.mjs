/**
 * Drives the built app for a visual check: launches Electron, completes
 * onboarding with the token from GH_TOKEN if the modal is up, waits for the
 * board to populate, and drops screenshots of the board (light + dark) and
 * settings pages into e2e/shots/.
 *
 * Usage:  GH_TOKEN=$(gh auth token) node e2e/screenshot.mjs
 *
 * Demo mode (PRSWEEP_DEMO=1): temporarily points the app at a public org with
 * real public activity — for README images — then restores the user's config.
 */
import { _electron } from 'playwright-core';
import { mkdirSync } from 'fs';

mkdirSync(new URL('./shots', import.meta.url), { recursive: true });

async function launch() {
  const app = await _electron.launch({ args: ['.'] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // An occluded window can throttle rendering and stall page.screenshot — keep
  // it frontmost and give captures a generous timeout.
  await win.bringToFront().catch(() => void 0);
  win.setDefaultTimeout(60_000);
  return { app, win };
}

let { app, win } = await launch();

// The modal only renders once the boot-time auth check (network) resolves —
// wait for it properly instead of a peek that races Angular's init.
const tokenInput = win.locator('.modal input[type="password"]');
const modalUp = await tokenInput
  .waitFor({ timeout: 15_000 })
  .then(() => true)
  .catch(() => false);
if (modalUp) {
  const token = process.env.GH_TOKEN;
  if (!token) {
    await win.screenshot({ path: 'e2e/shots/onboarding.png' });
    console.log('no GH_TOKEN — captured onboarding only');
    await app.close();
    process.exit(0);
  }
  const orgInput = win.locator('.modal .field input');
  if (!(await orgInput.inputValue())) {
    const org = process.env.PRSWEEP_DEMO ? 'electron' : process.env.PRSWEEP_ORG;
    if (!org) {
      await win.screenshot({ path: 'e2e/shots/onboarding.png' });
      console.log('no org configured and none supplied — captured onboarding only');
      await app.close();
      process.exit(0);
    }
    await orgInput.fill(org);
  }
  await tokenInput.fill(token);
  await win.locator('.modal .btn-primary').click();
  // Modal closes once the token validates; the first sweep starts right after.
  await win.locator('.modal').waitFor({ state: 'hidden', timeout: 30_000 });
}

let savedConfig = null;
if (process.env.PRSWEEP_DEMO) {
  savedConfig = await win.evaluate(() => window.api.getConfig());
  const day = 86_400_000;
  await win.evaluate(
    (c) => window.api.setConfig(c),
    {
      org: 'electron',
      authors: ['MarshallOfSound', 'codebytere', 'deepak1556', 'YUCLing', 'Bloomca'],
      range: { start: new Date(Date.now() - 30 * day).toISOString().slice(0, 10), end: null },
      autoRefreshMinutes: 5,
      includeDrafts: false,
      staleDays: 5,
    },
  );
  // Relaunch so the app boots cleanly from the demo config (reload() doesn't
  // survive the file:// + hash-routing combo in the packaged renderer).
  await app.close();
  ({ app, win } = await launch());
}

// Board is populated once any PR row renders (or give up and shoot anyway).
await win
  .locator('td.pr-ref')
  .first()
  .waitFor({ timeout: 30_000 })
  .catch(() => console.warn('no PR rows appeared — screenshotting as-is'));
await win.evaluate(() => {
  localStorage.setItem('prsweep-theme', 'light');
  document.documentElement.dataset.theme = 'light';
});
await win.screenshot({ path: 'e2e/shots/board.png' });

await win.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
await win.waitForTimeout(200);
await win.screenshot({ path: 'e2e/shots/board-dark.png' });
await win.evaluate(() => (document.documentElement.dataset.theme = 'light'));

await win.locator('a.nav-link', { hasText: 'Settings' }).click();
await win.waitForTimeout(400);
await win.screenshot({ path: 'e2e/shots/settings.png' });

if (savedConfig) await win.evaluate((c) => window.api.setConfig(c), savedConfig);
await app.close();
console.log('screenshots written to e2e/shots/');
