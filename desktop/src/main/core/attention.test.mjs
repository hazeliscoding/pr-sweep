/**
 * Verifies the attention engine: every reason fires on its side of each
 * boundary and not on the other, drafts and the stale threshold behave, and
 * reasons come out most severe first. Run after `npm run build:main`:
 * node src/main/core/attention.test.mjs
 */
import assert from 'node:assert';
import { annotate, attention, isQuiet, standupGroup } from '../../../dist/main/main/core/attention.js';

const NOW = Date.parse('2026-09-26T12:00:00Z');
const HOUR = 3_600_000;
const ago = (hours) => new Date(NOW - hours * HOUR).toISOString();
const ctx = (patch = {}) => ({ now: NOW, staleDays: 5, ...patch });

/** A healthy open PR: asked for review two hours ago, CI green. */
function pr(patch = {}) {
  return {
    repo: 'api',
    number: 7,
    title: 'Add a thing',
    url: 'https://github.com/acme/api/pull/7',
    isDraft: false,
    author: 'dana',
    authorAvatarUrl: '',
    bucket: 'needs-review',
    createdAt: ago(2),
    updatedAt: ago(1),
    mergedAt: null,
    comments: 0,
    additions: 1,
    deletions: 0,
    requestedReviewers: ['lee'],
    requestCount: 1,
    ci: 'success',
    lastCommitAt: ago(2),
    reviewRequestedAt: null,
    mergeable: null,
    approvedAt: null,
    changesRequestedAt: null,
    reviewCount: null,
    attention: [],
    quiet: false,
    ...patch,
  };
}
const reasons = (row, c = ctx()) => attention(row, c).map((a) => a.reason);

// --- a healthy PR needs nothing ---
assert.deepEqual(reasons(pr()), []);

// --- CI_FAILING: since the failing commit, next step opens the checks ---
{
  const [a] = attention(pr({ ci: 'failure', lastCommitAt: ago(3) }), ctx());
  assert.equal(a.reason, 'CI_FAILING');
  assert.equal(a.since, ago(3));
  assert.equal(a.action, 'Fix CI');
  assert.equal(a.href, 'https://github.com/acme/api/pull/7/checks');
  assert.deepEqual(reasons(pr({ ci: 'pending' })), [], 'pending is not failing');
}

// --- MERGE_CONFLICT: only a known conflict, and with no age ---
{
  const [a] = attention(pr({ bucket: 'approved', mergeable: 'conflicting', approvedAt: ago(30) }), ctx());
  assert.equal(a.reason, 'MERGE_CONFLICT');
  assert.strictEqual(a.since, null);
  assert.equal(a.action, 'Resolve conflict');
  assert.deepEqual(reasons(pr({ mergeable: 'unknown' })), [], 'UNKNOWN never fires');
}

// --- CHANGES_NOT_ADDRESSED: changes requested, no commit since, for more than a day ---
{
  const cr = (reviewHours, commitHours) =>
    pr({ bucket: 'changes-requested', changesRequestedAt: ago(reviewHours), lastCommitAt: ago(commitHours) });
  const [a] = attention(cr(25, 30), ctx());
  assert.equal(a.reason, 'CHANGES_NOT_ADDRESSED');
  assert.equal(a.since, ago(25));
  assert.equal(a.action, 'Address feedback');
  assert.deepEqual(reasons(cr(23, 30)), [], 'under a day is still fresh');
  assert.deepEqual(reasons(cr(25, 25)), ['CHANGES_NOT_ADDRESSED'], 'a commit at the review time is not after it');
  assert.deepEqual(reasons(pr({ bucket: 'changes-requested' })), [], 'no review time, no verdict');
}

// --- NEEDS_RE_REVIEW: the author pushed after the review, no re-review for more than a day ---
{
  const cr = (reviewHours, commitHours) =>
    pr({ bucket: 'changes-requested', changesRequestedAt: ago(reviewHours), lastCommitAt: ago(commitHours) });
  const [a] = attention(cr(50, 25), ctx());
  assert.equal(a.reason, 'NEEDS_RE_REVIEW');
  assert.equal(a.since, ago(25));
  assert.equal(a.action, 'Re-review');
  assert.equal(a.href, 'https://github.com/acme/api/pull/7/files');
  assert.deepEqual(reasons(cr(50, 23)), [], 'a push under a day ago is still fresh');
}

// --- APPROVED_NOT_MERGED: approved for more than a day, CI green or absent, no conflict ---
{
  const ok = (patch) => pr({ bucket: 'approved', approvedAt: ago(25), ...patch });
  const [a] = attention(ok(), ctx());
  assert.equal(a.reason, 'APPROVED_NOT_MERGED');
  assert.equal(a.since, ago(25));
  assert.equal(a.action, 'Merge');
  assert.deepEqual(reasons(ok({ ci: null })), ['APPROVED_NOT_MERGED'], 'no checks configured');
  assert.deepEqual(reasons(ok({ ci: 'pending' })), [], 'pending CI blocks it');
  assert.deepEqual(reasons(ok({ mergeable: 'conflicting' })), ['MERGE_CONFLICT'], 'a conflict replaces it');
  assert.deepEqual(reasons(ok({ approvedAt: ago(23) })), [], 'under a day');
  assert.deepEqual(reasons(ok({ approvedAt: null })), [], 'no approval time, no verdict');
}

// --- NO_REVIEWERS: nobody asked, nobody reviewed, open more than an hour ---
{
  const none = (patch) => pr({ requestCount: 0, requestedReviewers: [], reviewCount: 0, ...patch });
  const [a] = attention(none(), ctx());
  assert.equal(a.reason, 'NO_REVIEWERS');
  assert.equal(a.since, ago(2));
  assert.equal(a.action, 'Request reviewers');
  assert.deepEqual(reasons(none({ createdAt: ago(0.5) })), [], 'give the author an hour');
  assert.deepEqual(reasons(none({ reviewCount: 1 })), [], 'someone reviewed anyway');
  assert.deepEqual(reasons(none({ reviewCount: null })), [], 'unknown review count, no verdict');
  assert.deepEqual(reasons(pr({ reviewCount: 0 })), [], 'a request is pending');
}

// --- WAITING_FOR_REVIEW: requested, open longer than the stale threshold ---
{
  const [a] = attention(pr({ createdAt: ago(6 * 24) }), ctx());
  assert.equal(a.reason, 'WAITING_FOR_REVIEW');
  assert.equal(a.since, ago(6 * 24));
  assert.equal(a.action, 'Nudge reviewers');
  assert.deepEqual(reasons(pr({ createdAt: ago(4 * 24) })), []);
  assert.deepEqual(reasons(pr({ createdAt: ago(6 * 24) }), ctx({ staleDays: 0 })), [], '0 turns it off');
}

// --- STALE: no update in the stale threshold ---
{
  const [a] = attention(pr({ bucket: 'approved', createdAt: ago(9 * 24), updatedAt: ago(6 * 24), ci: 'pending' }), ctx());
  assert.equal(a.reason, 'STALE');
  assert.equal(a.since, ago(6 * 24));
  assert.equal(a.action, 'Nudge');
  assert.deepEqual(reasons(pr({ updatedAt: ago(4 * 24) })), []);
  assert.deepEqual(reasons(pr({ bucket: 'approved', updatedAt: ago(6 * 24), ci: 'pending' }), ctx({ staleDays: 0 })), []);
}

// --- DRAFT_TOO_LONG: a draft older than the threshold, and drafts get nothing else ---
{
  const draft = (patch) => pr({ isDraft: true, ...patch });
  const [a] = attention(draft({ createdAt: ago(6 * 24), updatedAt: ago(6 * 24), ci: 'failure' }), ctx());
  assert.equal(a.reason, 'DRAFT_TOO_LONG');
  assert.equal(a.since, ago(6 * 24));
  assert.equal(a.action, 'Mark ready or close');
  assert.equal(attention(draft({ createdAt: ago(6 * 24), ci: 'failure' }), ctx()).length, 1, 'only the draft reason');
  assert.deepEqual(reasons(draft({ ci: 'failure', mergeable: 'conflicting' })), [], 'a young draft is work in progress');
  assert.deepEqual(reasons(draft({ createdAt: ago(6 * 24) }), ctx({ staleDays: 0 })), []);
}

// --- reasons come out most severe first ---
{
  const row = pr({ ci: 'failure', mergeable: 'conflicting', bucket: 'approved', approvedAt: ago(48), updatedAt: ago(6 * 24) });
  assert.deepEqual(reasons(row), ['CI_FAILING', 'MERGE_CONFLICT', 'STALE']);
}

// --- quiet: the worst reason is a slow one, or nobody touched the PR in 30+ days ---
{
  const quiet = (patch) => {
    const row = pr(patch);
    return isQuiet(row, attention(row, ctx()), ctx());
  };
  assert.equal(quiet({ createdAt: ago(6 * 24) }), true, 'only waiting for review');
  assert.equal(quiet({ updatedAt: ago(6 * 24), ci: 'pending' }), true, 'only stale');
  assert.equal(quiet({ isDraft: true, createdAt: ago(6 * 24) }), true, 'old draft');
  assert.equal(quiet({ ci: 'failure', updatedAt: ago(31 * 24) }), true, 'failing, but untouched for a month');
  assert.equal(quiet({ ci: 'failure', updatedAt: ago(29 * 24) }), false, 'failing and touched within the month');
  assert.equal(quiet({ ci: 'failure', updatedAt: ago(1) }), false);
  assert.equal(quiet({}), false, 'nothing flagged, nothing quiet');
}

// --- annotate: open rows get reasons, merged and queue rows never do ---
{
  const failing = pr({ ci: 'failure' });
  const result = {
    schema: 4,
    fetchedAt: ago(0),
    org: 'acme',
    range: { start: '2026-09-15', end: '2026-09-27' },
    open: [failing, pr({ number: 8 })],
    merged: [pr({ number: 9, bucket: 'merged', ci: 'failure' })],
    queue: [pr({ number: 10, ci: 'failure' })],
    summary: null,
  };
  const out = annotate(result, ctx());
  assert.deepEqual(out.open.map((r) => r.attention.map((a) => a.reason)), [['CI_FAILING'], []]);
  assert.deepEqual(out.open.map((r) => r.quiet), [false, false]);
  assert.deepEqual(out.merged[0].attention, []);
  assert.deepEqual(out.queue[0].attention, []);
  assert.deepEqual(failing.attention, [], 'the input rows are left alone');
}

// --- standupGroup: Blocked, then the rest of the Sweep, then In review; drafts stay out ---
{
  const judged = (patch) => {
    const row = pr(patch);
    const reasons = attention(row, ctx());
    return { ...row, attention: reasons, quiet: isQuiet(row, reasons, ctx()) };
  };
  assert.equal(standupGroup(judged({ ci: 'failure' })), 'blocked', 'CI failing');
  assert.equal(standupGroup(judged({ bucket: 'approved', approvedAt: ago(30), mergeable: 'conflicting' })), 'blocked', 'a conflict');
  assert.equal(
    standupGroup(judged({ bucket: 'changes-requested', changesRequestedAt: ago(30), lastCommitAt: ago(40) })),
    'blocked',
    'changes left for over a day',
  );
  assert.equal(
    standupGroup(judged({ bucket: 'changes-requested', changesRequestedAt: ago(3), lastCommitAt: ago(40) })),
    'review',
    'changes requested today are still in review',
  );
  assert.equal(standupGroup(judged({ bucket: 'approved', approvedAt: ago(30) })), 'attention', 'approved, not merged');
  assert.equal(standupGroup(judged({ requestedReviewers: [], requestCount: 0, reviewCount: 0 })), 'attention', 'no reviewers');
  assert.equal(standupGroup(judged({})), 'review', 'nothing flagged');
  const waiting = judged({ createdAt: ago(7 * 24), updatedAt: ago(7 * 24) });
  assert.equal(waiting.quiet, true);
  assert.equal(standupGroup(waiting), 'review', 'quiet rows count as in review');
  const abandoned = judged({ ci: 'failure', updatedAt: ago(40 * 24) });
  assert.equal(abandoned.quiet, true);
  assert.equal(standupGroup(abandoned), 'review', 'even when failing, a quiet row is in review');
  assert.strictEqual(standupGroup(judged({ isDraft: true, createdAt: ago(9 * 24) })), null, 'drafts stay out');
}

console.log('attention: every reason, drafts, thresholds, ordering and standup groups pass');
