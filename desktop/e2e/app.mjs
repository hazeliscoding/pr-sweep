/**
 * Launches the built app for the UI scripts (screenshot.mjs, states.test.mjs).
 *
 * Every launch gets a throwaway --user-data-dir and aborts unless the app really
 * uses it, so your own config, token and snapshot are never touched. (Chromium
 * finds %APPDATA% through a Windows API, so overriding the variable does nothing.)
 * Selectors go by visible text, labels and roles, not classes, so the same
 * scripts work before and after a restyle.
 */
import { _electron } from 'playwright-core';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFixture } from '../dist/main/main/core/fixture.js';

// Chromium's sandbox can't start on CI's Ubuntu runners (no unprivileged user namespaces).
const SANDBOX = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : [];

export async function launch(config, env) {
  const userData = mkdtempSync(join(tmpdir(), 'prsweep-shots-'));
  writeFileSync(join(userData, 'config.json'), JSON.stringify(config));
  const app = await _electron.launch({
    args: [`--user-data-dir=${userData}`, ...SANDBOX, '.'],
    env: { ...process.env, ELECTRON_RENDERER_URL: '', PRSWEEP_DEBUG: '', ...env },
  });
  const actual = await app.evaluate(({ app: a }) => a.getPath('userData'));
  if (actual.toLowerCase() !== userData.toLowerCase()) {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
    throw new Error(`the app uses ${actual}, not the throwaway folder — aborting`);
  }
  // Copy standup writes the system clipboard; a script run leaves yours alone.
  await app.evaluate(({ clipboard }) => {
    clipboard.write = () => undefined;
  });
  const win = await app.firstWindow();
  // The app scrolls inside its main pane, so a full-page shot stops at the
  // window's height: a tall viewport captures every section.
  await win.setViewportSize({ width: 1440, height: 2400 });
  // An occluded window can throttle rendering and stall page.screenshot.
  await win.bringToFront().catch(() => void 0);
  win.setDefaultTimeout(60_000);
  const close = async () => {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  };
  return { win, close, app };
}

export function configFor(profile) {
  return {
    profiles: [{ id: 'shots', name: 'Acme team', ...profile }],
    activeProfileId: 'shots',
    autoRefreshMinutes: 0,
    notifications: false,
    closeToTray: false,
    oauthClientId: '',
  };
}

/** The app serving e2e/fixtures/<name>.json, with that fixture's profile. */
export function launchFixture(name) {
  const read = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
  const fixture = loadFixture(name, read, Date.now());
  return launch(configFor(fixture.profile), { PRSWEEP_FIXTURE: name });
}

export async function boardReady(win) {
  await win.locator('#sweep-title').waitFor();
  await win.waitForTimeout(800);
}

export const button = (win, name, exact = false) => win.getByRole('button', { name, exact });
