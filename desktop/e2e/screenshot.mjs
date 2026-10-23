/**
 * Screenshots of the built app, for reviewing the UI and for the README.
 *
 *   node e2e/screenshot.mjs --fixtures [busy,calm,…]
 *     Every fixture state (e2e/fixtures) in both themes. No token, no network.
 *   node e2e/screenshot.mjs --readme
 *     The README images: the busy board in both themes, one 1440×900 window at
 *     2x, written to docs/screenshots/board.png and board-dark.png.
 *   GH_TOKEN=$(gh auth token) PRSWEEP_ORG=<org> [PRSWEEP_AUTHORS=a,b] node e2e/screenshot.mjs
 *     The live board for an org, in both themes.
 *
 * Run from desktop/ after `npm run build`. Output: e2e/shots/<state>-<theme>.png.
 * Launching, and the throwaway data folder each run gets, are in app.mjs.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardReady, button, configFor, launch, launchFixture } from './app.mjs';

const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

/** Both themes of the current screen, as <name>-light.png and <name>-dark.png. */
async function shoot(win, name) {
  for (const theme of ['light', 'dark']) {
    await win.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await win.waitForTimeout(200);
    await win.screenshot({ path: join(SHOTS, `${name}-${theme}.png`), fullPage: true });
  }
  await win.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  console.log(`  ${name}`);
}

/** What to capture for each fixture, beyond launching it. */
const STATES = {
  async busy(win) {
    await boardReady(win);
    await shoot(win, 'busy');
    await button(win, 'Copy standup').click();
    await win.getByText(/^Copied: /).waitFor();
    await shoot(win, 'busy-standup');
    await button(win, /^Snooze /).first().click();
    await button(win, /Show snoozed/).click();
    await shoot(win, 'busy-snoozed');
    await button(win, /Show snoozed/).click();
    await button(win, /Show quiet/).click();
    await shoot(win, 'busy-quiet');
    await button(win, /Show quiet/).click();
    await win.getByPlaceholder('Filter by title or repo').fill('zzz');
    await shoot(win, 'busy-filtered');
    await win.getByPlaceholder('Filter by title or repo').fill('');
    await win.locator('a', { hasText: 'Settings' }).first().click();
    await win.waitForTimeout(500);
    await shoot(win, 'settings');
  },
  async calm(win) {
    await boardReady(win);
    await shoot(win, 'calm');
    // No schedule yet: the top bar's link opens Settings on a sprint schedule to set up.
    await win.getByRole('link', { name: 'Set up sprints' }).click();
    await win.locator('#sprints tbody tr').first().waitFor();
    await shoot(win, 'settings-setup');
  },
  async empty(win) {
    await boardReady(win);
    await shoot(win, 'empty');
  },
  async error(win) {
    await boardReady(win);
    await win.getByRole('button', { name: 'Refresh', exact: true }).click();
    await win.getByText('HTTP 502').first().waitFor();
    await shoot(win, 'error');
  },
  async onboarding(win) {
    await win.getByRole('dialog').waitFor();
    await win.waitForTimeout(500);
    await shoot(win, 'onboarding');
    await win.getByText('use a personal access token').click();
    await win.locator('input[type="password"]').waitFor();
    await shoot(win, 'onboarding-token');
  },
  async update(win) {
    await win.getByText(/0\.12\.1/).first().waitFor();
    await shoot(win, 'update-downloading');
    await button(win, /Restart/).waitFor();
    await shoot(win, 'update-ready');
  },
  async 'update-portable'(win) {
    await button(win, /Download v0\.13\.1/).waitFor();
    await shoot(win, 'update-portable');
  },
  async loading(win) {
    await win.waitForTimeout(1500);
    await shoot(win, 'loading');
  },
};

async function shootFixtures(names) {
  for (const name of names) {
    const { win, close } = await launchFixture(name);
    console.log(name);
    try {
      await STATES[name](win);
    } finally {
      await close();
    }
  }
}

async function shootLive() {
  const org = process.env.PRSWEEP_ORG;
  if (!process.env.GH_TOKEN || !org) {
    console.error('Live mode needs GH_TOKEN and PRSWEEP_ORG (or use --fixtures).');
    process.exit(1);
  }
  const start = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const authors = process.env.PRSWEEP_AUTHORS ? process.env.PRSWEEP_AUTHORS.split(',') : [];
  const { win, close } = await launch(
    configFor({ org, authors, range: { start, end: null }, includeDrafts: false, staleDays: 5 }),
    { PRSWEEP_FIXTURE: '' },
  );
  try {
    await win.getByRole('dialog').waitFor();
    const tokenLink = win.getByText('use a personal access token');
    if (await tokenLink.count()) await tokenLink.click();
    await win.locator('input[type="password"]').fill(process.env.GH_TOKEN);
    await button(win, /Connect/).click();
    await win.getByRole('dialog').waitFor({ state: 'hidden' });
    await boardReady(win);
    await win.waitForTimeout(3000);
    await shoot(win, 'live');
  } finally {
    await close();
  }
}

/** The README's board: what fits in a window, drawn at 2x so it stays sharp on GitHub. */
async function shootReadme() {
  const { win, close, app } = await launchFixture('busy');
  const out = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url));
  try {
    await win.setViewportSize({ width: 2880, height: 1800 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
    await boardReady(win);
    for (const theme of ['light', 'dark']) {
      await win.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      await win.waitForTimeout(300);
      await win.screenshot({ path: join(out, theme === 'light' ? 'board.png' : 'board-dark.png') });
    }
  } finally {
    await close();
  }
  console.log(`README screenshots in ${out}`);
  process.exit(0);
}

if (process.argv.includes('--readme')) await shootReadme();
const i = process.argv.indexOf('--fixtures');
if (i >= 0) {
  const list = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1].split(',') : Object.keys(STATES);
  await shootFixtures(list);
} else {
  await shootLive();
}
console.log(`screenshots in ${SHOTS}`);
