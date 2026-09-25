/**
 * Verifies the sweep's query construction, reviewDecision bucketing, rate-limit
 * retries, cap-window splitting, and incremental patching against a mocked
 * GitHub GraphQL endpoint — no network. Run after `npm run build:main`:
 * node src/main/core/github.service.test.mjs
 */
import assert from 'node:assert';
import { GithubService } from '../../../dist/main/main/core/github.service.js';
import { SWEEP_SCHEMA } from '../../../dist/main/shared/types.js';

function node(number, reviewDecision, extra = {}) {
  return {
    number,
    title: `pr ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    isDraft: false,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    mergedAt: null,
    reviewDecision,
    totalCommentsCount: 0,
    additions: 1,
    deletions: 0,
    repository: { name: 'r' },
    author: { login: 'a', avatarUrl: '' },
    reviewRequests: { nodes: [] },
    ...extra,
  };
}

function row(number, bucket) {
  return {
    repo: 'r',
    number,
    title: `pr ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    isDraft: false,
    author: 'a',
    authorAvatarUrl: '',
    bucket,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    mergedAt: null,
    comments: 0,
    additions: 1,
    deletions: 0,
    requestedReviewers: [],
  };
}

function makeConfig(profilePatch = {}) {
  return {
    profiles: [
      {
        id: 'x',
        name: 'X',
        org: 'acme',
        authors: ['alice', 'bob'],
        range: { start: '2026-08-01', end: null },
        includeDrafts: false,
        staleDays: 5,
        ...profilePatch,
      },
    ],
    activeProfileId: 'x',
    autoRefreshMinutes: 5,
    notifications: true,
    closeToTray: true,
    oauthClientId: '',
  };
}

const headers = () => ({ get: () => null });
const json = (data) => ({ ok: true, status: 200, headers: headers(), json: async () => ({ data }) });
const page = (nodes, issueCount = nodes.length) => ({
  search: { issueCount, pageInfo: { hasNextPage: false, endCursor: null }, nodes },
});

/** Runs sweep with a fetch mock, returning { result, queries: {open,merged,queue} }. */
async function runSweep(config, range) {
  const queries = {};
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    // The search query mentions `requestedReviewer` (contains "viewer"), so key
    // off the search( call instead of a naive "viewer" substring.
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    const q = body.variables.q;
    if (q.includes('review-requested')) {
      queries.queue = q;
      return json(page([node(10, 'REVIEW_REQUIRED')]));
    }
    if (q.includes('is:merged')) {
      (queries.merged ??= []).push(q);
      return json(page([node(20, null, { mergedAt: '2026-08-05T00:00:00Z' })]));
    }
    queries.open = q;
    return json(
      page([
        node(1, 'APPROVED'),
        node(2, 'CHANGES_REQUESTED'),
        node(3, 'REVIEW_REQUIRED'),
        node(4, null),
        node(5, 'REVIEW_REQUIRED', { isDraft: true }),
      ]),
    );
  };
  const svc = new GithubService(() => 'tok');
  const result = await svc.sweep(config, range);
  return { result, queries };
}

// --- default profile (drafts hidden, two authors, open-ended range) ---
{
  const { result, queries } = await runSweep(makeConfig(), { start: '2026-08-01', end: null });

  assert.match(queries.open, /org:acme/, 'targets the org');
  assert.match(queries.open, /is:open/);
  assert.match(queries.open, /draft:false/, 'hides drafts by default');
  assert.match(queries.open, /\(author:alice OR author:bob\)/, 'ORs the authors');
  assert.match(queries.open, /updated:2026-08-01\.\.\d{4}-\d{2}-\d{2}/, 'open-ended range closes at today');
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(queries.merged.some((q) => q.includes('merged:2026-08-01..2026-08-07')), 'first week starts at the range start');
  assert.ok(queries.merged.some((q) => q.endsWith(`..${today}`)), 'open-ended merged closes at today');
  assert.match(queries.queue, /review-requested:me/, 'queue uses the viewer login');

  const bucket = (n) => result.open.find((r) => r.number === n)?.bucket;
  assert.equal(bucket(1), 'approved');
  assert.equal(bucket(2), 'changes-requested');
  assert.equal(bucket(3), 'needs-review');
  assert.equal(bucket(4), 'needs-review', 'null reviewDecision → needs review');
  assert.equal(result.open.find((r) => r.number === 5)?.isDraft, true, 'isDraft passes through');
  assert.equal(result.queue.length, 1);
  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].bucket, 'merged');
  assert.equal(result.org, 'acme');
}

// --- includeDrafts drops the draft:false filter ---
{
  const { queries } = await runSweep(makeConfig({ includeDrafts: true }), { start: '2026-08-01', end: null });
  assert.ok(!queries.open.includes('draft:false'), 'includeDrafts omits draft:false');
}

// --- a closed range is swept one week per merged search, the last week cut at the end ---
{
  const { result, queries } = await runSweep(makeConfig(), { start: '2026-08-01', end: '2026-09-01' });
  assert.deepEqual(
    queries.merged.map((q) => q.match(/merged:(\S+)/)[1]).sort(),
    [
      '2026-08-01..2026-08-07',
      '2026-08-08..2026-08-14',
      '2026-08-15..2026-08-21',
      '2026-08-22..2026-08-28',
      '2026-08-29..2026-09-01',
    ],
  );
  assert.equal(result.merged.length, 1, 'the same PR from every window is kept once');
}

// --- no authors → no OR clause ---
{
  const { queries } = await runSweep(makeConfig({ authors: [] }), { start: '2026-08-01', end: null });
  assert.ok(!queries.open.includes('author:'), 'empty authors omits the OR clause');
}

// --- no org → clear error ---
await assert.rejects(
  () => runSweep(makeConfig({ org: '' }), { start: '2026-08-01', end: null }),
  /No GitHub organization/,
);

// --- transient 502 is retried, then succeeds ---
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 502, headers: headers(), json: async () => ({}) };
    return json({ viewer: { login: 'me' } });
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  assert.equal(await svc.viewer(), 'me');
  assert.equal(calls, 2, '502 retried once');
}

// --- secondary rate limit (403 + Retry-After) is retried ---
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 403,
        headers: { get: (n) => (n === 'retry-after' ? '0' : null) },
        json: async () => ({}),
      };
    }
    return json({ viewer: { login: 'me' } });
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  assert.equal(await svc.viewer(), 'me');
  assert.equal(calls, 2, '403 retried once');
}

// --- GraphQL RATE_LIMITED (HTTP 200) is retried ---
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return { ok: true, status: 200, headers: headers(), json: async () => ({ errors: [{ message: 'rate limited', type: 'RATE_LIMITED' }] }) };
    }
    return json({ viewer: { login: 'me' } });
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  assert.equal(await svc.viewer(), 'me');
  assert.equal(calls, 2, 'RATE_LIMITED retried once');
}

// --- retries are bounded: persistent 502 surfaces the error ---
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 502, headers: headers(), json: async () => ({}) };
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  await assert.rejects(() => svc.viewer(), /HTTP 502/);
  assert.equal(calls, 4, 'initial call + 3 retries');
}

// --- a week over the 1000-result cap splits by date; other weeks are kept ---
{
  const merged = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    const q = body.variables.q;
    if (q.includes('review-requested')) return json(page([]));
    if (q.includes('is:merged')) {
      merged.push(q);
      if (q.includes('merged:2026-08-01..2026-08-07')) return json(page([node(100, null)], 1500));
      if (q.includes('merged:2026-08-01..2026-08-04')) return json(page([node(101, null)], 800));
      if (q.includes('merged:2026-08-05..2026-08-07')) return json(page([node(102, null)], 700));
      // Every other week: one PR numbered after its first day.
      return json(page([node(200 + Number(q.match(/merged:\d{4}-\d{2}-(\d{2})/)[1]), null)]));
    }
    return json(page([node(1, 'APPROVED')]));
  };
  const svc = new GithubService(() => 'tok');
  const result = await svc.sweep(makeConfig(), { start: '2026-08-01', end: '2026-08-31' });
  assert.equal(merged.length, 7, 'five weeks + two halves of the capped one');
  assert.deepEqual(
    result.merged.map((r) => r.number).sort((a, b) => a - b),
    [101, 102, 208, 215, 222, 229],
    'capped week replaced by its halves, other weeks kept',
  );
}

// --- merged weeks run in parallel, at most 4 at a time ---
{
  let inFlight = 0;
  let peak = 0;
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    if (!body.variables.q.includes('is:merged')) return json(page([]));
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return json(page([]));
  };
  const svc = new GithubService(() => 'tok');
  await svc.sweep(makeConfig(), { start: '2026-06-01', end: '2026-08-31' });
  assert.equal(peak, 4, 'thirteen weeks, four in flight');
}

// --- incremental patch: a changed PR moves buckets, untouched rows survive ---
{
  const base = {
    fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    schema: SWEEP_SCHEMA,
    org: 'acme',
    range: { start: '2026-08-01', end: null },
    open: [row(1, 'needs-review'), row(2, 'needs-review')],
    merged: [row(20, 'merged')],
    queue: [],
  };
  const queries = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    const q = body.variables.q;
    queries.push(q);
    if (q.includes('review-requested')) return json(page([]));
    if (q.includes('is:merged')) return json(page([]));
    if (q.includes('is:open')) return json(page([node(2, 'APPROVED')]));
    return json(page([node(2, 'APPROVED')])); // the org-wide changed probe
  };
  const svc = new GithubService(() => 'tok');
  const result = await svc.sweep(makeConfig(), { start: '2026-08-01', end: null }, base);
  const probe = queries.find((q) => !q.includes('is:open') && !q.includes('is:merged'));
  assert.match(probe, /updated:>=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00/, 'probe uses a datetime cutoff');
  assert.equal(queries.length, 4, 'probe + three deltas');
  assert.equal(result.open.find((r) => r.number === 2)?.bucket, 'approved', 'changed PR re-bucketed');
  assert.equal(result.open.find((r) => r.number === 1)?.bucket, 'needs-review', 'untouched row kept');
  assert.equal(result.merged.length, 1, 'merged untouched');
}

// --- incremental patch: a PR that left the result set is dropped ---
{
  const base = {
    fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    schema: SWEEP_SCHEMA,
    org: 'acme',
    range: { start: '2026-08-01', end: null },
    open: [row(1, 'needs-review'), row(2, 'approved')],
    merged: [],
    queue: [row(1, 'needs-review')],
  };
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    const q = body.variables.q;
    if (q.includes('review-requested') || q.includes('is:merged') || q.includes('is:open')) {
      return json(page([])); // changed PR no longer matches any bucket query
    }
    return json(page([node(1, null)])); // probe: PR 1 was updated (e.g. closed)
  };
  const svc = new GithubService(() => 'tok');
  const result = await svc.sweep(makeConfig(), { start: '2026-08-01', end: null }, base);
  assert.deepEqual(result.open.map((r) => r.number), [2], 'closed PR dropped from open');
  assert.deepEqual(result.queue, [], 'closed PR dropped from queue');
}

// --- incremental with nothing changed: one probe, base returned refreshed ---
{
  const base = {
    fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    schema: SWEEP_SCHEMA,
    org: 'acme',
    range: { start: '2026-08-01', end: null },
    open: [row(1, 'needs-review')],
    merged: [],
    queue: [],
  };
  let searches = 0;
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    searches++;
    return json(page([]));
  };
  const svc = new GithubService(() => 'tok');
  const result = await svc.sweep(makeConfig(), { start: '2026-08-01', end: null }, base);
  assert.equal(searches, 1, 'quiet org costs a single search');
  assert.deepEqual(result.open, base.open, 'rows unchanged');
  assert.ok(result.fetchedAt > base.fetchedAt, 'fetchedAt refreshed');
}

// --- a stale base is ignored: full windowed sweep runs instead ---
{
  const base = {
    fetchedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    schema: SWEEP_SCHEMA,
    org: 'acme',
    range: { start: '2026-08-01', end: null },
    open: [],
    merged: [],
    queue: [],
  };
  const queries = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    queries.push(body.variables.q);
    return json(page([]));
  };
  const svc = new GithubService(() => 'tok');
  await svc.sweep(makeConfig(), { start: '2026-08-01', end: null }, base);
  assert.ok(
    queries.some((q) => /updated:2026-08-01\.\./.test(q)),
    'stale base → full range sweep',
  );
  assert.ok(!queries.some((q) => q.includes('updated:>=')), 'no incremental cutoff used');
}

// --- CI rollup maps to a traffic light; absent checks stay null ---
{
  const rollup = (state) => ({ commits: { nodes: [{ commit: { statusCheckRollup: state ? { state } : null } }] } });
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    const q = body.variables.q;
    if (q.includes('review-requested') || q.includes('is:merged')) return json(page([]));
    return json(
      page([
        node(1, null, rollup('SUCCESS')),
        node(2, null, rollup('FAILURE')),
        node(3, null, rollup('ERROR')),
        node(4, null, rollup('PENDING')),
        node(5, null, rollup(null)),
        node(6, null), // no commits field at all
      ]),
    );
  };
  const svc = new GithubService(() => 'tok');
  const { open } = await svc.sweep(makeConfig(), { start: '2026-08-01', end: null });
  const ci = (n) => open.find((r) => r.number === n)?.ci;
  assert.equal(ci(1), 'success');
  assert.equal(ci(2), 'failure');
  assert.equal(ci(3), 'failure', 'ERROR counts as failure');
  assert.equal(ci(4), 'pending');
  assert.equal(ci(5), null, 'no rollup → null');
  assert.equal(ci(6), null, 'missing commits → null');
}

// --- queue rows resolve when *my* review was requested; other rows stay null ---
{
  const timeline = {
    timelineItems: {
      nodes: [
        { createdAt: '2026-08-10T00:00:00Z', requestedReviewer: { login: 'me' } },
        { createdAt: '2026-08-12T00:00:00Z', requestedReviewer: { login: 'other' } },
        { createdAt: '2026-08-20T00:00:00Z', requestedReviewer: { login: 'me' } },
      ],
    },
  };
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    const q = body.variables.q;
    if (q.includes('review-requested')) return json(page([node(10, 'REVIEW_REQUIRED', timeline)]));
    if (q.includes('is:merged')) return json(page([]));
    return json(page([node(1, null, timeline)]));
  };
  const svc = new GithubService(() => 'tok');
  const result = await svc.sweep(makeConfig(), { start: '2026-08-01', end: null });
  assert.equal(
    result.queue[0].reviewRequestedAt,
    '2026-08-20T00:00:00Z',
    'newest request naming the viewer wins',
  );
  assert.equal(result.open[0].reviewRequestedAt, null, 'non-queue rows skip the lookup');
}

// --- expensive fields are fetched only where their rows display them ---
// statusCheckRollup and timelineItems dominate sweep latency; the merged list
// (often the sweep's biggest) must request neither, and only queue rows need
// the timeline. The incremental probe needs keys only → bare document.
{
  const docs = {};
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    const q = body.variables.q;
    if (q.includes('review-requested')) docs.queue = body.query;
    else if (q.includes('is:merged')) docs.merged = body.query;
    else if (q.includes('is:open')) docs.open = body.query;
    else docs.probe = body.query;
    return json(page([]));
  };
  const svc = new GithubService(() => 'tok');
  await svc.sweep(makeConfig(), { start: '2026-08-01', end: null });
  const base = {
    fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    schema: SWEEP_SCHEMA,
    org: 'acme',
    range: { start: '2026-08-01', end: null },
    open: [row(1, 'needs-review')],
    merged: [],
    queue: [],
  };
  // Force the delta queries too (probe must return a change).
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    const q = body.variables.q;
    if (q.includes('review-requested')) docs.queue = body.query;
    else if (q.includes('is:merged')) docs.merged = body.query;
    else if (q.includes('is:open')) docs.open = body.query;
    else {
      docs.probe = body.query;
      return json(page([node(1, null)]));
    }
    return json(page([]));
  };
  await svc.sweep(makeConfig(), { start: '2026-08-01', end: null }, base);

  assert.ok(docs.open.includes('statusCheckRollup'), 'open rows fetch CI');
  assert.ok(!docs.open.includes('timelineItems'), 'open rows skip the timeline');
  assert.ok(!docs.merged.includes('statusCheckRollup'), 'merged rows skip CI');
  assert.ok(!docs.merged.includes('timelineItems'), 'merged rows skip the timeline');
  assert.ok(docs.queue.includes('statusCheckRollup'), 'queue rows fetch CI');
  assert.ok(docs.queue.includes('timelineItems'), 'queue rows fetch the timeline');
  assert.ok(!docs.probe.includes('statusCheckRollup'), 'changed probe stays bare');
  assert.ok(!docs.probe.includes('timelineItems'), 'changed probe stays bare');
}

// --- a search page that times out is re-sent at 50, then 25, not at the same size ---
{
  const sizes = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    if (!body.variables.q.includes('is:open') || body.variables.q.includes('review-requested')) return json(page([]));
    sizes.push(body.variables.first);
    if (body.variables.first === 100) return { ok: false, status: 502, headers: headers(), json: async () => ({}) };
    if (body.variables.first === 50) return { ok: false, status: 504, headers: headers(), json: async () => ({}) };
    return json(page([node(1, 'APPROVED')]));
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  const result = await svc.sweep(makeConfig(), { start: '2026-08-01', end: null });
  assert.deepEqual(sizes, [100, 50, 25], 'each timeout halves the page instead of repeating it');
  assert.equal(result.open.length, 1, 'the smaller page still delivers the rows');
  assert.equal(svc.lastSweep.retries, 2, 'both re-sends count as retries');
}

// --- once a search shrinks its pages, later pages stay small ---
{
  const calls = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    if (!body.variables.q.includes('is:open') || body.variables.q.includes('review-requested')) return json(page([]));
    const { first, after } = body.variables;
    calls.push({ first, after });
    if (first === 100) return { ok: false, status: 502, headers: headers(), json: async () => ({}) };
    const next = after === null;
    return json({
      search: {
        issueCount: 2,
        pageInfo: { hasNextPage: next, endCursor: next ? 'c1' : null },
        nodes: [node(after === null ? 1 : 2, 'APPROVED')],
      },
    });
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  const result = await svc.sweep(makeConfig(), { start: '2026-08-01', end: null });
  assert.deepEqual(calls, [
    { first: 100, after: null },
    { first: 50, after: null },
    { first: 50, after: 'c1' },
  ]);
  assert.deepEqual(result.open.map((r) => r.number), [1, 2]);
}

// --- at 25 the normal retries apply, then the sweep reports the error ---
{
  const sizes = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    if (!body.variables.q.includes('is:open') || body.variables.q.includes('review-requested')) return json(page([]));
    sizes.push(body.variables.first);
    return { ok: false, status: 502, headers: headers(), json: async () => ({}) };
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  await assert.rejects(() => svc.sweep(makeConfig(), { start: '2026-08-01', end: null }), /HTTP 502/);
  assert.deepEqual(sizes, [100, 50, 25, 25, 25, 25], 'halve twice, then the usual 3 retries');
}

// --- a search page that arrives as a cut-off 200 body is re-sent smaller ---
{
  const sizes = [];
  const truncated = { ok: true, status: 200, headers: headers(), json: async () => JSON.parse('{"data":') };
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    if (!body.variables.q.includes('is:open') || body.variables.q.includes('review-requested')) return json(page([]));
    sizes.push(body.variables.first);
    return body.variables.first === 100 ? truncated : json(page([node(1, 'APPROVED')]));
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  const result = await svc.sweep(makeConfig(), { start: '2026-08-01', end: null });
  assert.deepEqual(sizes, [100, 50], 'treated like a timeout');
  assert.equal(result.open.length, 1);
}

// --- any other request with a cut-off body is retried like a 5xx ---
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: true, status: 200, headers: headers(), json: async () => JSON.parse('{"data":') };
    return json({ viewer: { login: 'me' } });
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  assert.equal(await svc.viewer(), 'me');
  assert.equal(calls, 2, 'retried once');
}

// --- results carry the snapshot schema ---
{
  const { result } = await runSweep(makeConfig(), { start: '2026-08-01', end: null });
  assert.strictEqual(result.schema, SWEEP_SCHEMA, 'full sweep result is stamped');
}

// --- a base from an older schema is never patched: full sweep instead ---
{
  const queries = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    queries.push(body.variables.q);
    return json(page([]));
  };
  const base = {
    fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    org: 'acme',
    range: { start: '2026-08-01', end: null },
    open: [row(1, 'needs-review')],
    merged: [],
    queue: [],
  };
  const svc = new GithubService(() => 'tok');
  const result = await svc.sweep(makeConfig(), { start: '2026-08-01', end: null }, base);
  assert.ok(!queries.some((q) => q.includes('updated:>=')), 'no incremental cutoff used');
  assert.strictEqual(svc.lastSweep.mode, 'full');
  assert.strictEqual(result.schema, SWEEP_SCHEMA, 'the replacement is stamped');
}

// --- lastSweep records mode, duration, round trips and retries (the PRSWEEP_DEBUG line) ---
{
  let calls = 0;
  let failedOnce = false;
  globalThis.fetch = async (_url, opts) => {
    calls++;
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    if (!failedOnce) {
      failedOnce = true;
      return { ok: false, status: 502, headers: headers(), json: async () => ({}) };
    }
    return json(page([]));
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  assert.strictEqual(svc.lastSweep, null, 'no stats before the first sweep');
  await svc.sweep(makeConfig(), { start: '2026-08-01', end: null });
  const s = svc.lastSweep;
  assert.equal(s.mode, 'full');
  assert.equal(s.ok, true);
  assert.equal(s.requests, calls, 'every HTTP round trip counts, re-sends included');
  assert.equal(s.retries, 1, 'the 502 re-send counts as a retry');
  assert.ok(Number.isFinite(s.ms) && s.ms >= 0, 'duration in ms');
}

// --- an incremental patch reports its mode, and counters reset per sweep ---
{
  const range = { start: '2026-08-01', end: null };
  const base = () => ({
    fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    schema: SWEEP_SCHEMA,
    org: 'acme',
    range,
    open: [row(1, 'needs-review')],
    merged: [],
    queue: [],
  });
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    return json(page([]));
  };
  const svc = new GithubService(() => 'tok');
  await svc.sweep(makeConfig(), range, base());
  assert.equal(svc.lastSweep.mode, 'incremental');
  assert.equal(svc.lastSweep.requests, 2, 'viewer lookup + one probe');
  await svc.sweep(makeConfig(), range, base());
  assert.equal(svc.lastSweep.requests, 1, 'counters reset per sweep (viewer is memoized)');
  assert.equal(svc.lastSweep.retries, 0);
}

// --- a failed sweep still records its stats ---
{
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (!body.query.includes('search(')) return json({ viewer: { login: 'me' } });
    return { ok: false, status: 502, headers: headers(), json: async () => ({}) };
  };
  const svc = new GithubService(() => 'tok', { retryBaseMs: 1 });
  await assert.rejects(() => svc.sweep(makeConfig(), { start: '2026-08-01', end: null }), /HTTP 502/);
  assert.equal(svc.lastSweep.ok, false);
  assert.equal(svc.lastSweep.mode, 'full');
  assert.ok(svc.lastSweep.retries >= 3, 'the failing search exhausted its retries');
}

console.log('github.service: query construction, bucketing, retry, windowing, incremental + CI cases pass');
