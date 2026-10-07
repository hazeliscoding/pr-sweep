/**
 * Verifies the sprint summary behind the health strip: where today falls in the
 * range, days left and the ending-soon warning, the open and attention counts
 * (which must match the standup's groups), merged since the last working day,
 * and median time to merge. Run after `npm run build:main`:
 * node src/main/core/summary.test.mjs
 */
import assert from 'node:assert';
import { annotate } from '../../../dist/main/main/core/attention.js';
import { lastWorkingDay, sinceOf, summarize } from '../../../dist/main/main/core/summary.js';

const NOW = Date.parse('2026-09-29T15:00:00Z');
const HOUR = 3_600_000;
const ago = (hours) => new Date(NOW - hours * HOUR).toISOString();
const SPRINT = { start: '2026-09-17', end: '2026-10-01' };

function pr(patch = {}) {
  return {
    repo: 'api', number: 7, title: 'Add a thing', url: 'https://github.com/acme/api/pull/7', isDraft: false,
    author: 'dana', authorAvatarUrl: '', bucket: 'needs-review', createdAt: ago(2), updatedAt: ago(1),
    mergedAt: null, comments: 0, additions: 1, deletions: 0, requestedReviewers: ['lee'], requestCount: 1,
    ci: 'success', lastCommitAt: ago(2), reviewRequestedAt: null, mergeable: null, approvedAt: null,
    changesRequestedAt: null, reviewCount: null, attention: [], quiet: false, ...patch,
  };
}

/** Merges near midday UTC, so their local day is the same in any timezone this runs in. */
const merged = (created, mergedAt) => pr({ bucket: 'merged', createdAt: created, mergedAt, updatedAt: mergedAt });

function sweep(open, mergedRows = [], range = SPRINT) {
  const result = { schema: 6, fetchedAt: ago(0), org: 'acme', range, open, merged: mergedRows, queue: [], summary: null };
  return annotate(result, { now: NOW, staleDays: 5 });
}

// --- the last working day: a Monday looks back to Friday ---
assert.equal(lastWorkingDay('2026-09-29'), '2026-09-28', 'Tuesday → Monday');
assert.equal(lastWorkingDay('2026-09-28'), '2026-09-25', 'Monday → Friday');
assert.equal(lastWorkingDay('2026-09-27'), '2026-09-25', 'Sunday → Friday');
assert.equal(lastWorkingDay('2026-09-26'), '2026-09-25', 'Saturday → Friday');
assert.equal(lastWorkingDay('2026-10-02'), '2026-10-01', 'Friday → Thursday');
assert.deepEqual(sinceOf(SPRINT, '2026-09-29'), { since: '2026-09-28', sinceStart: false });
assert.deepEqual(
  sinceOf({ start: '2026-09-28', end: '2026-10-11' }, '2026-09-28'),
  { since: '2026-09-28', sinceStart: true },
  "a sprint's first day counts from its start, not the Friday before it",
);

// --- a sprint in its last days ---
{
  const open = [
    pr({ number: 1, ci: 'failure' }), // blocked
    pr({ number: 2, bucket: 'approved', approvedAt: ago(30) }), // needs attention: approved, not merged
    pr({ number: 3 }), // in review
    pr({ number: 4, bucket: 'approved', approvedAt: ago(3) }), // in review, approved today
    pr({ number: 5, createdAt: ago(7 * 24), updatedAt: ago(7 * 24) }), // quiet: waiting and stale
    pr({ number: 6, isDraft: true, createdAt: ago(9 * 24) }), // quiet: an old draft
  ];
  const mergedRows = [
    merged('2026-09-20T12:00:00Z', '2026-09-21T12:00:00Z'), // 24 h, last week
    merged('2026-09-27T12:00:00Z', '2026-09-28T18:00:00Z'), // 30 h, Monday
    merged('2026-09-28T06:00:00Z', '2026-09-29T10:00:00Z'), // 28 h, today
  ];
  const s = summarize(sweep(open, mergedRows), { today: '2026-09-29' });
  assert.equal(s.when, 'during');
  assert.equal(s.daysLeft, 2);
  assert.equal(s.endingSoon, true);
  assert.equal(s.startLabel, 'Sep 17');
  assert.equal(s.endLabel, 'Oct 1');
  assert.equal(s.open, 6, 'every open row on the board, drafts included');
  assert.equal(s.notApproved, 3, 'approved PRs and drafts are left out');
  assert.equal(s.blocked, 1);
  assert.equal(s.needsAttention, 2, 'blocked plus the rest of the Sweep, quiet rows not counted');
  assert.equal(s.quiet, 2);
  assert.equal(s.merged, 3);
  assert.equal(s.mergedSince, 2, 'Monday and today, not last week');
  assert.equal(s.sinceLabel, 'Monday');
  assert.equal(s.sinceStart, false);
  assert.equal(s.medianMergeMs, 28 * HOUR, 'median of 24, 28 and 30 hours');
}

// --- median of an even count, and of nothing ---
{
  const two = [merged('2026-09-20T12:00:00Z', '2026-09-21T12:00:00Z'), merged('2026-09-22T12:00:00Z', '2026-09-22T22:00:00Z')];
  assert.equal(summarize(sweep([], two), { today: '2026-09-29' }).medianMergeMs, 17 * HOUR, 'between 10 and 24 hours');
  const none = summarize(sweep([]), { today: '2026-09-29' });
  assert.strictEqual(none.medianMergeMs, null);
  assert.equal(none.merged, 0);
  assert.equal(none.needsAttention, 0);
}

// --- where today falls, and ranges without an end ---
{
  const at = (today, range = SPRINT) => summarize(sweep([], [], range), { today });
  assert.equal(at('2026-10-01').daysLeft, 0, 'the last day');
  assert.equal(at('2026-10-01').endingSoon, true);
  assert.equal(at('2026-09-28').daysLeft, 3);
  assert.equal(at('2026-09-28').endingSoon, false, 'three days out is not yet ending');
  assert.equal(at('2026-09-10').when, 'before');
  assert.equal(at('2026-09-10').endingSoon, false);
  assert.equal(at('2026-10-05').when, 'after');
  assert.equal(at('2026-10-05').endingSoon, false, 'an ended sprint never warns');
  const open = at('2026-09-29', { start: '2026-09-17', end: null });
  assert.equal(open.when, 'during');
  assert.strictEqual(open.daysLeft, null);
  assert.strictEqual(open.endLabel, null);
  assert.equal(open.endingSoon, false);
  const first = at('2026-09-28', { start: '2026-09-28', end: '2026-10-11' });
  assert.equal(first.sinceStart, true);
  assert.equal(first.sinceLabel, 'Sep 28', 'named by its start date');
  assert.equal(at('2026-01-05', { start: '2025-12-29', end: '2026-01-11' }).startLabel, 'Dec 29, 2025');
}

console.log('summary: days left, counts, merged since the last working day and median time to merge pass');
