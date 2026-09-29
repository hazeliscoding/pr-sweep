/**
 * Verifies the standup: each open PR once, in Blocked, Needs attention or In
 * review; merged since the last working day first; the heading's wording; PR
 * links in both formats; titles escaped so Markdown and HTML show them as typed;
 * and counts that agree with the summary's. Run after `npm run build:main`:
 * node src/main/core/standup.test.mjs
 */
import assert from 'node:assert';
import { annotate } from '../../../dist/main/main/core/attention.js';
import { buildStandup } from '../../../dist/main/main/core/standup.js';
import { summarize } from '../../../dist/main/main/core/summary.js';

const NOW = Date.parse('2026-09-29T15:00:00Z');
const HOUR = 3_600_000;
const ago = (hours) => new Date(NOW - hours * HOUR).toISOString();
const SPRINT = { start: '2026-09-17', end: '2026-10-01' };
const TRICKY = 'Escape test: <b>not bold</b> *not italic* _nor this_ `nor code` [nor](link) & done';

function pr(patch = {}) {
  const repo = patch.repo ?? 'api';
  const number = patch.number ?? 7;
  return {
    repo, number, title: 'Add a thing', url: `https://github.com/acme/${repo}/pull/${number}`, isDraft: false,
    author: 'dana', authorAvatarUrl: '', bucket: 'needs-review', createdAt: ago(2), updatedAt: ago(1),
    mergedAt: null, comments: 0, additions: 1, deletions: 0, requestedReviewers: ['lee'], requestCount: 1,
    ci: 'success', lastCommitAt: ago(2), reviewRequestedAt: null, mergeable: null, approvedAt: null,
    changesRequestedAt: null, reviewCount: null, attention: [], quiet: false, ...patch,
  };
}

function period(range = SPRINT, kind = 'sprint') {
  const sprint = kind === 'sprint' ? { number: 24, name: 'Sprint 24', start: range.start, end: range.end } : null;
  return { kind, label: '', range, sprint, isCurrent: true, previous: null, next: null, current: sprint, hasSchedule: kind === 'sprint' };
}

function sweep(open, merged = [], range = SPRINT) {
  const result = { schema: 6, fetchedAt: ago(0), org: 'acme', range, open, merged, queue: [], summary: null };
  return annotate(result, { now: NOW, staleDays: 5 });
}

const open = [
  pr({ number: 482, title: 'Refresh OAuth tokens', ci: 'failure', lastCommitAt: ago(7) }),
  pr({ repo: 'infra', number: 94, title: 'Pool Redis connections', author: 'sam', bucket: 'approved', approvedAt: ago(72), mergeable: 'conflicting' }),
  pr({
    repo: 'web', number: 799, title: 'Warn before the session times out', author: 'jo', bucket: 'changes-requested',
    changesRequestedAt: ago(96), lastCommitAt: ago(48), updatedAt: ago(48),
  }),
  pr({ number: 491, title: 'OAuth for service accounts', author: 'lee', bucket: 'approved', approvedAt: ago(36) }),
  pr({ repo: 'docs', number: 201, title: TRICKY, author: 'priya' }),
  pr({ repo: 'web', number: 830, title: 'Dark mode tokens', author: 'sam', bucket: 'approved', approvedAt: ago(3), updatedAt: ago(0.5) }),
  pr({ repo: 'web', number: 835, title: 'Layout experiment', isDraft: true, createdAt: ago(9 * 24) }),
];
const merged = [
  pr({ repo: 'infra', number: 92, title: 'Rotate the staging password', bucket: 'merged', createdAt: '2026-09-27T12:00:00Z', mergedAt: '2026-09-28T12:00:00Z' }),
  pr({ number: 470, title: 'Paginate the audit log', bucket: 'merged', createdAt: '2026-09-19T12:00:00Z', mergedAt: '2026-09-21T12:00:00Z' }),
];

// --- a Tuesday in Sprint 24's last days ---
{
  const result = sweep(open, merged);
  const { text, html, counts } = buildStandup(result, { now: NOW, today: '2026-09-29', period: period() });

  assert.equal(text.split('\n')[0], '**Sprint 24 standup** · 2 days left · Sep 17 – Oct 1');
  const order = ['**Merged since Monday (1)**', '**Blocked (2)**', '**Needs attention (2)**', '**In review (2)**'].map((h) => text.indexOf(h));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), 'merged, blocked, needs attention, in review, in that order');

  assert.ok(text.includes('- [infra#92](<https://github.com/acme/infra/pull/92>) Rotate the staging password · dana'), 'merged since Monday');
  assert.ok(!text.includes('api#470'), 'merged last week is left out');
  assert.ok(text.includes('- [api#482](<https://github.com/acme/api/pull/482>) Refresh OAuth tokens · CI failing 7h · dana'));
  assert.ok(text.includes('- [infra#94](<https://github.com/acme/infra/pull/94>) Pool Redis connections · merge conflict · sam'), 'no age for a conflict');
  assert.ok(text.includes('Warn before the session times out · needs re-review 2d · jo'));
  assert.ok(text.includes('OAuth for service accounts · approved, not merged 36h · lee'));
  assert.ok(text.includes('Dark mode tokens · approved · sam'), 'in review says where review stands');
  assert.ok(!text.includes('Layout experiment') && !html.includes('Layout experiment'), 'drafts stay out');
  assert.ok(
    text.includes('Escape test: \\<b\\>not bold\\</b\\> \\*not italic\\* \\_nor this\\_ \\`nor code\\` \\[nor\\](link) \\& done · priya'),
    'a title reads as typed in Markdown',
  );

  assert.ok(html.startsWith('<meta charset="utf-8"><p><b>Sprint 24 standup</b> &#183; 2 days left &#183; Sep 17 &#8211; Oct 1</p><br><p><b>Merged since Monday (1)</b></p><ul>'));
  assert.ok(html.includes('<li><a href="https://github.com/acme/api/pull/482">api#482</a> Refresh OAuth tokens &#183; CI failing 7h &#183; dana</li>'));
  assert.ok(html.includes('Escape test: &lt;b&gt;not bold&lt;/b&gt; *not italic* _nor this_ `nor code` [nor](link) &amp; done'), 'a title reads as typed in HTML');
  assert.ok(!/[^\x00-\x7f]/.test(html), 'the HTML is plain ASCII');
  assert.ok(!html.endsWith('<br>'));

  assert.deepEqual(counts, { merged: 1, blocked: 2, attention: 2, review: 2 });
  const summary = summarize(result, { today: '2026-09-29' });
  assert.equal(counts.blocked + counts.attention, summary.needsAttention, 'the standup agrees with the strip');
  assert.equal(counts.merged, summary.mergedSince);
}

// --- Monday looks back to Friday ---
{
  const { text } = buildStandup(sweep(open, merged), { now: NOW, today: '2026-09-28', period: period() });
  assert.ok(text.includes('**Merged since Friday (1)**'));
}

// --- a sprint's first day: nothing fetched from before it, and it says so ---
{
  const range = { start: '2026-09-28', end: '2026-10-11' };
  const { text, html, counts } = buildStandup(sweep([pr({ number: 1 })], [], range), { now: NOW, today: '2026-09-28', period: period(range) });
  assert.ok(text.includes('**Merged this sprint (0)**\nNothing yet.'));
  assert.ok(html.includes('<p><b>Merged this sprint (0)</b></p><p>Nothing yet.</p><br><p><b>In review (1)</b></p>'), 'a gap after a paragraph');
  assert.ok(!text.includes('Blocked') && !text.includes('Needs attention'), 'empty groups are left out');
  assert.deepEqual(counts, { merged: 0, blocked: 0, attention: 0, review: 1 });
}

// --- custom ranges ---
{
  const custom = buildStandup(sweep(open, merged), { now: NOW, today: '2026-09-29', period: period(SPRINT, 'custom') });
  assert.equal(custom.text.split('\n')[0], '**Standup** · 2 days left · Sep 17 – Oct 1');
  const openEnded = { start: '2026-09-28', end: null };
  const since = buildStandup(sweep([], [], openEnded), { now: NOW, today: '2026-09-28', period: period(openEnded, 'custom') });
  assert.equal(since.text.split('\n')[0], '**Standup** · Since Sep 28');
  assert.ok(since.text.includes('**Merged since Sep 28 (0)**'), 'custom ranges name the start date');
}

console.log('standup: groups, wording, links, escaping and agreement with the summary pass');
