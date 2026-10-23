/**
 * Drives the built app through its fixture states and checks what a user sees:
 * first run, loading, nothing to show, a failed refresh, a token that can't see
 * the org, and a snooze. No token, no network; the throwaway data folder each
 * launch gets is in app.mjs.
 *
 * Run from desktop/ after `npm run build`: node e2e/states.test.mjs
 * CI runs it under xvfb-run.
 */
import assert from 'node:assert';
import { boardReady, button, launchFixture } from './app.mjs';

async function inFixture(name, check) {
  const { win, close } = await launchFixture(name);
  try {
    await check(win);
  } finally {
    await close();
  }
}

/** Waits for a locator to match `n` elements, then asserts it. */
async function count(locator, n, message) {
  for (let i = 0; i < 50 && (await locator.count()) !== n; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(await locator.count(), n, message);
}

// --- first run: onboarding, with the token field one click away ---
await inFixture('onboarding', async (win) => {
  await win.getByRole('dialog').waitFor();
  await win.getByText('use a personal access token').click();
  await win.locator('input[type="password"]').waitFor();
});

// --- loading: the Sweep shows a skeleton until the first sweep lands ---
await inFixture('loading', async (win) => {
  await win.getByText('Loading pull requests').first().waitFor({ state: 'attached' });
  assert.ok(await button(win, 'Refresh', true).isDisabled(), 'no second sweep while one runs');
});

// --- empty: a quiet team reads as good news, not as a broken board ---
await inFixture('empty', async (win) => {
  await boardReady(win);
  await win.getByText('Nothing needs attention').waitFor();
  await win.getByText('Nothing waiting on review.').waitFor();
});

// --- error: a failed refresh says so, with the evidence, and keeps the last board ---
await inFixture('error', async (win) => {
  await boardReady(win);
  await button(win, 'Refresh', true).click();
  const banner = win.getByRole('alert').filter({ hasText: "Couldn't refresh" });
  await banner.waitFor();
  const text = await banner.innerText();
  assert.match(text, /HTTP 502/, 'the evidence');
  assert.match(text, /Showing data from/, 'says the board is the last good one');
  assert.ok((await button(win, /^Snooze /).count()) > 0, 'the last board stays');
});

// --- a token that can't see the org: onboarding says how to fix it ---
await inFixture('sso-blind', async (win) => {
  const alert = win.getByRole('dialog').getByRole('alert');
  await alert.waitFor();
  const text = await alert.innerText();
  assert.match(text, /can't see acme/);
  assert.match(text, /Configure SSO/);
});

// --- snooze: hides a Sweep row, survives a reload, and can be undone ---
await inFixture('busy', async (win) => {
  await boardReady(win);
  const snooze = button(win, /^Snooze /);
  const before = await snooze.count();
  assert.ok(before > 1, 'busy has Sweep rows to snooze');
  const name = await snooze.first().getAttribute('aria-label');
  await snooze.first().click();
  await count(snooze, before - 1, 'the snoozed row leaves the Sweep');
  await win.reload();
  await boardReady(win);
  await count(snooze, before - 1, 'the snooze survives a reload');
  await button(win, /Show snoozed/).click();
  await button(win, name.replace(/^Snooze/, 'Unsnooze'), true).click();
  await count(snooze, before, 'unsnoozing brings it back');
});

console.log('e2e: first run, loading, empty, error, SSO-blind token and snooze pass');
