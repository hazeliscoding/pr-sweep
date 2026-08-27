/**
 * Verifies the sweep's query construction and reviewDecision bucketing against
 * a mocked GitHub GraphQL endpoint — no network. Run after `npm run build:main`:
 * node src/main/core/github.service.test.mjs
 */
import assert from 'node:assert';
import { GithubService } from '../../../dist/main/main/core/github.service.js';

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

const json = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });

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
      return json({ search: { pageInfo: { hasNextPage: false }, nodes: [node(10, 'REVIEW_REQUIRED')] } });
    }
    if (q.includes('is:merged')) {
      queries.merged = q;
      return json({ search: { pageInfo: { hasNextPage: false }, nodes: [node(20, null, { mergedAt: '2026-08-05T00:00:00Z' })] } });
    }
    queries.open = q;
    return json({
      search: {
        pageInfo: { hasNextPage: false },
        nodes: [
          node(1, 'APPROVED'),
          node(2, 'CHANGES_REQUESTED'),
          node(3, 'REVIEW_REQUIRED'),
          node(4, null),
          node(5, 'REVIEW_REQUIRED', { isDraft: true }),
        ],
      },
    });
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
  assert.match(queries.open, /updated:>=2026-08-01/);
  assert.match(queries.merged, /merged:>=2026-08-01/, 'open-ended merged uses >=');
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

// --- a closed range uses merged:start..end ---
{
  const { queries } = await runSweep(makeConfig(), { start: '2026-08-01', end: '2026-09-01' });
  assert.match(queries.merged, /merged:2026-08-01\.\.2026-09-01/);
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

console.log('github.service: query construction + bucketing cases pass');
