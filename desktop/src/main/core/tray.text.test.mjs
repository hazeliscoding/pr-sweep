/**
 * Verifies the tray's wording: the tooltip says the most urgent thing, and the
 * menu lists every count. Run after `npm run build:main`:
 * node src/main/core/tray.text.test.mjs
 */
import assert from 'node:assert';
import { trayMenuLines, trayTooltip } from '../../../dist/main/main/core/tray.text.js';

const counts = (patch) => ({ queue: 0, attention: 0, needsReview: 0, ...patch });

// --- the tooltip leads with what waits on you, then the team's Sweep, then reviews ---
assert.equal(trayTooltip(counts({ queue: 2, attention: 4, needsReview: 3 })), 'PR Sweep — 2 awaiting your review');
assert.equal(trayTooltip(counts({ attention: 4, needsReview: 3 })), 'PR Sweep — 4 need attention');
assert.equal(trayTooltip(counts({ attention: 1 })), 'PR Sweep — 1 needs attention');
assert.equal(trayTooltip(counts({ needsReview: 3 })), 'PR Sweep — 3 need review');
assert.equal(trayTooltip(counts({})), 'PR Sweep — nothing waiting');

// --- the menu lists all three, the team-wide ones labelled as such ---
assert.deepEqual(trayMenuLines(counts({ queue: 2, attention: 4, needsReview: 3 })), [
  '2 awaiting your review',
  '4 need attention (team)',
  '3 need review (team)',
]);
assert.deepEqual(trayMenuLines(counts({ attention: 1 })), [
  '0 awaiting your review',
  '1 needs attention (team)',
  '0 need review (team)',
]);

console.log('tray.text: tooltip priority and menu lines pass');
