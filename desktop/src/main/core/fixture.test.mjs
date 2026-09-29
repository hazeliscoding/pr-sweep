/**
 * Verifies fixture loading: relative times resolve against "now", rows get
 * defaults, bad fixtures fail loudly, `extends` layers one fixture on another,
 * and the showcase fixture really triggers every attention reason.
 * Run after `npm run build:main`: node src/main/core/fixture.test.mjs
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { annotate } from '../../../dist/main/main/core/attention.js';
import { loadFixture, relativeDate, relativeTime } from '../../../dist/main/main/core/fixture.js';
import { localDate as today, resolvePeriod } from '../../../dist/main/main/core/sprints.js';
import { summarize } from '../../../dist/main/main/core/summary.js';

const NOW = Date.parse('2026-09-29T15:00:00Z');
const HOUR = 3_600_000;
const localDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// --- relative times and dates ---
assert.equal(relativeTime('-3d', NOW), new Date(NOW - 72 * HOUR).toISOString());
assert.equal(relativeTime('-2h', NOW), new Date(NOW - 2 * HOUR).toISOString());
assert.equal(relativeTime('+30m', NOW), new Date(NOW + 30 * 60_000).toISOString());
assert.equal(relativeTime('2026-01-02T03:04:05Z', NOW), '2026-01-02T03:04:05Z', 'absolute passes through');
assert.equal(relativeDate('+2d', NOW), localDate(NOW + 48 * HOUR), 'local calendar date');
assert.equal(relativeDate('2026-09-14', NOW), '2026-09-14');
assert.throws(() => relativeTime('yesterday', NOW), /"yesterday" is not a relative time/);

// --- rows get defaults; times resolve ---
const read = (files) => (name) => {
  if (!(name in files)) throw new Error(`no fixture ${name}`);
  return files[name];
};
{
  const f = loadFixture(
    'one',
    read({
      one: {
        profile: { org: 'acme', authors: ['dana'], range: { start: '-13d', end: '+2d' } },
        open: [{ repo: 'api', number: 7, title: 'Add a thing', createdAt: '-2d', requestedReviewers: ['lee', 'acme/platform'] }],
      },
    }),
    NOW,
  );
  const [row] = f.sweep.open;
  assert.equal(row.url, 'https://github.com/acme/api/pull/7');
  assert.equal(row.bucket, 'needs-review');
  assert.equal(row.createdAt, new Date(NOW - 48 * HOUR).toISOString());
  assert.equal(row.lastCommitAt, row.createdAt, 'last commit defaults to creation');
  assert.equal(row.requestCount, 2, 'request count follows the reviewers listed');
  assert.deepEqual(row.attention, []);
  assert.strictEqual(row.mergeable, null);
  assert.equal(f.profile.range.start, localDate(NOW - 13 * 24 * HOUR));
  assert.equal(f.auth, 'signed-in');
  assert.deepEqual(f.sweep.merged, []);
}

// --- bad rows fail with a message that names the fixture and the field ---
assert.throws(
  () =>
    loadFixture(
      'bad',
      read({ bad: { profile: { org: 'acme', authors: [], range: { start: '-1d', end: null } }, open: [{ repo: 'api', number: 1, title: 'x', bucket: 'stuck' }] } }),
      NOW,
    ),
  /bad: open\[0\]\.bucket "stuck" is not one of/,
);

// --- a sprint schedule passes through, its first start relative; the period defaults to current ---
{
  const f = loadFixture(
    'sprinting',
    read({
      sprinting: {
        profile: {
          org: 'acme', authors: [], range: { start: '-12d', end: null },
          sprints: { pattern: 'Sprint {n}', first: { number: 24, start: '-12d' }, lengthDays: 15 },
        },
      },
    }),
    NOW,
  );
  assert.deepEqual(f.profile.sprints, {
    pattern: 'Sprint {n}', first: { number: 24, start: localDate(NOW - 12 * 24 * HOUR) }, lengthDays: 15, lengths: {}, names: {},
  });
  assert.equal(f.profile.period, 'current');
}

// --- extends: the base fixture, with the extending one's fields on top ---
{
  const f = loadFixture(
    'err',
    read({
      base: { profile: { org: 'acme', authors: [], range: { start: '-1d', end: null } }, open: [{ repo: 'api', number: 1, title: 'x' }] },
      err: { extends: 'base', failAfter: 1, error: 'GitHub API error: HTTP 502' },
    }),
    NOW,
  );
  assert.equal(f.sweep.open.length, 1, 'rows come from the base');
  assert.equal(f.failAfter, 1);
  assert.equal(f.error, 'GitHub API error: HTTP 502');
}

// --- the busy fixture triggers every attention reason ---
{
  const files = (name) => JSON.parse(readFileSync(new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url), 'utf8'));
  const f = loadFixture('busy', files, Date.now());
  // busy runs on a sprint schedule: the current sprint ends in two days.
  const period = resolvePeriod({ id: 'x', name: 'x', ...f.profile }, today());
  assert.equal(period.kind, 'sprint');
  assert.equal(period.isCurrent, true);
  const judged = annotate(
    { schema: 0, fetchedAt: '', org: f.profile.org, range: period.range, ...f.sweep, summary: null },
    { now: Date.now(), staleDays: f.profile.staleDays },
  );
  const reasons = new Set(judged.open.flatMap((r) => r.attention.map((a) => a.reason)));
  assert.deepEqual(
    [...reasons].sort(),
    [
      'APPROVED_NOT_MERGED', 'CHANGES_NOT_ADDRESSED', 'CI_FAILING', 'DRAFT_TOO_LONG', 'MERGE_CONFLICT',
      'NEEDS_RE_REVIEW', 'NO_REVIEWERS', 'STALE', 'WAITING_FOR_REVIEW',
    ],
    'busy covers all nine reasons',
  );
  assert.ok(judged.open.some((r) => r.quiet), 'busy has a quiet tail');
  assert.ok(judged.open.some((r) => r.attention.length === 0), 'busy has healthy rows too');
  const summary = summarize(judged, { today: today() });
  assert.ok(summary.endingSoon, 'busy ends its sprint within two days');
  assert.ok(summary.blocked > 0 && summary.needsAttention > summary.blocked, 'busy has blocked and other flagged PRs');
}

console.log('fixture: relative times, defaults, validation, extends and busy coverage pass');
