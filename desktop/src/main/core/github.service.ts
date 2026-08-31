/**
 * GitHub GraphQL client for the sweep. Uses the ISSUE_ADVANCED search backend —
 * the only one that supports `(author:a OR author:b)` — with the search string
 * passed as a GraphQL variable so logins never need escaping into the query
 * document. Plain class (token comes in via a provider fn) — no Electron imports.
 *
 * Backend quirks this encodes, verified against the live API:
 *  - multiple bare `author:` qualifiers AND together (match nothing); OR + parens
 *    require ISSUE_ADVANCED.
 *  - the advanced backend spells it `review:changes_requested` (legacy search
 *    uses a hyphen) — we don't use review: qualifiers here (bucketing is done
 *    from reviewDecision), but keep this in mind if adding filters.
 *  - search hard-caps every query at 1000 results no matter how you paginate;
 *    the only way past it is narrower queries (see searchWindowed).
 *
 * Big-org behavior:
 *  - date-windowed queries split themselves when they'd hit the 1000-result cap,
 *    so a busy quarter still sweeps completely instead of silently truncating.
 *  - rate limits (primary and secondary) and transient 5xx are retried with the
 *    server-stated wait when GitHub provides one, exponential backoff otherwise.
 *  - auto-refreshes can run incrementally against the previous sweep: one cheap
 *    org-wide "what changed since last time" probe plus per-bucket deltas,
 *    instead of re-fetching every PR in the range (see sweep()'s `base` param).
 */
import { DateRange, PrRow, ReviewBucket, SweepConfig, SweepResult } from '../../shared/types';
import { activeProfile } from './config.service';

const GRAPHQL_URL = 'https://api.github.com/graphql';
// GraphQL search's max page size — fewer round trips is the single biggest
// lever on sweep latency for busy ranges.
const PAGE_SIZE = 100;
/** GitHub search returns at most this many results per query, full stop. */
const SEARCH_CAP = 1000;
const MAX_RETRIES = 3;
/** Never sleep longer than this on a rate limit — surface the error instead. */
const MAX_RETRY_WAIT_MS = 120_000;
/** Incremental sweeps re-fetch this much overlap so search-index lag can't drop rows. */
const INCREMENTAL_SKEW_MS = 5 * 60_000;
/** A snapshot older than this is refetched in full rather than patched. */
const INCREMENTAL_MAX_AGE_MS = 60 * 60_000;

// statusCheckRollup and timelineItems are the two most expensive fields we
// touch — GitHub computes them per PR, per page, and they dominate sweep
// latency. Each search therefore requests only what its rows display:
// merged rows show neither, open rows show the CI dot, queue rows also show
// the review-wait badge. The incremental probe needs only keys → bare.
const NODE_FIELDS = `
          number title url isDraft createdAt updatedAt mergedAt
          reviewDecision totalCommentsCount additions deletions
          repository { name }
          author { login avatarUrl }
          reviewRequests(first: 10) {
            nodes { requestedReviewer { ... on User { login } } }
          }`;

const CI_FIELD = `
          commits(last: 1) {
            nodes { commit { statusCheckRollup { state } } }
          }`;

const TIMELINE_FIELD = `
          timelineItems(last: 10, itemTypes: [REVIEW_REQUESTED_EVENT]) {
            nodes {
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer { ... on User { login } }
              }
            }
          }`;

function buildSearchQuery(extras: { ci?: boolean; timeline?: boolean }): string {
  return `
  query ($q: String!, $after: String) {
    search(query: $q, type: ISSUE_ADVANCED, first: ${PAGE_SIZE}, after: $after) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {${NODE_FIELDS}${extras.ci ? CI_FIELD : ''}${extras.timeline ? TIMELINE_FIELD : ''}
        }
      }
    }
  }
`;
}

const QUERY_BARE = buildSearchQuery({});
const QUERY_OPEN = buildSearchQuery({ ci: true });
const QUERY_QUEUE = buildSearchQuery({ ci: true, timeline: true });

interface SearchNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  totalCommentsCount: number;
  additions: number;
  deletions: number;
  repository: { name: string };
  author: { login: string; avatarUrl: string } | null;
  reviewRequests: { nodes: Array<{ requestedReviewer: { login?: string } | null }> };
  commits?: {
    nodes: Array<{
      commit: {
        statusCheckRollup: { state: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' } | null;
      };
    }>;
  };
  timelineItems?: {
    nodes: Array<{ createdAt?: string; requestedReviewer?: { login?: string } | null }>;
  };
}

interface SearchPage {
  search: {
    issueCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: SearchNode[];
  };
}

export class GithubService {
  constructor(
    private readonly token: () => string | null,
    /** retryBaseMs shrinks the backoff for tests; production uses the default. */
    private readonly opts: { retryBaseMs?: number } = {},
  ) {}

  /**
   * Validates the stored token; returns the login it authenticates as.
   * Memoized per token so sweeps can reuse it without an extra round trip.
   */
  async viewer(): Promise<string> {
    const token = this.token();
    if (this.viewerCache && this.viewerCache.token === token) return this.viewerCache.login;
    const data = await this.graphql<{ viewer: { login: string } }>('query { viewer { login } }', {});
    this.viewerCache = { token, login: data.viewer.login };
    return data.viewer.login;
  }
  private viewerCache: { token: string | null; login: string } | null = null;

  /**
   * Whether the token can see the org at all. A valid token that isn't
   * SSO-authorized for the org gets no error from search — the org's results
   * are just silently filtered to nothing — so an explicit org lookup is the
   * only way to tell "quiet sprint" from "blind token".
   */
  async orgVisible(org: string): Promise<boolean> {
    try {
      // Repo count, not just the org's name: an SSO-unauthorized token can
      // resolve the org while every repo (and all search results) is filtered.
      const data = await this.graphql<{
        organization: { repositories: { totalCount: number } } | null;
      }>(
        'query ($org: String!) { organization(login: $org) { repositories(first: 1) { totalCount } } }',
        { org },
      );
      const count = data.organization?.repositories.totalCount ?? 0;
      if (process.env.PRSWEEP_DEBUG) console.log('[github] org repos visible:', count);
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Runs the sweep. When `base` (the previous sweep) is fresh and matches the
   * org + range, only PRs updated since it are fetched and patched in — for a
   * big org's auto-refresh that's a handful of results instead of the whole
   * range. Anything that makes the patch unsafe (stale base, range mismatch,
   * more changes than search can enumerate) falls back to a full sweep.
   */
  async sweep(config: SweepConfig, range: DateRange, base: SweepResult | null = null): Promise<SweepResult> {
    const profile = activeProfile(config);
    if (!profile.org) throw new Error('No GitHub organization configured — set one in Settings.');
    const authors = profile.authors.length
      ? `(${profile.authors.map((a) => `author:${a}`).join(' OR ')})`
      : '';
    const drafts = profile.includeDrafts ? '' : 'draft:false';
    // The queue is deliberately unscoped by range and authors: if someone asked
    // for your review, you want to see it no matter whose PR it is or how old.
    const login = await this.viewer();
    const parts = {
      open: `org:${profile.org} is:pr is:open ${drafts} ${authors}`,
      merged: `org:${profile.org} is:pr is:merged ${authors}`,
      queue: `org:${profile.org} is:pr is:open ${drafts} review-requested:${login}`,
    };

    if (this.canPatch(base, profile.org, range)) {
      const patched = await this.incrementalSweep(base, parts, range, login);
      if (patched) return patched;
    }

    const today = new Date().toISOString().slice(0, 10);
    const end = range.end ?? today;
    const [open, merged, queue] = await Promise.all([
      this.searchWindowed((a, b) => `${parts.open} updated:${a}..${b}`, range.start, end, QUERY_OPEN),
      this.searchWindowed((a, b) => `${parts.merged} merged:${a}..${b}`, range.start, end, QUERY_BARE),
      this.searchAll(parts.queue, QUERY_QUEUE).then((r) => r.nodes),
    ]);
    return {
      fetchedAt: new Date().toISOString(),
      org: profile.org,
      range,
      open: open.map((n) => toRow(n, bucketOf(n))),
      merged: merged.map((n) => toRow(n, 'merged')),
      // Queue rows resolve "when was *my* review requested" from the timeline.
      queue: queue.map((n) => toRow(n, bucketOf(n), login)),
    };
  }

  private canPatch(base: SweepResult | null, org: string, range: DateRange): base is SweepResult {
    if (!base || base.org !== org) return false;
    if (base.range.start !== range.start || (base.range.end ?? null) !== (range.end ?? null)) return false;
    const age = Date.now() - Date.parse(base.fetchedAt);
    return age >= 0 && age < INCREMENTAL_MAX_AGE_MS;
  }

  /**
   * Patch `base` with everything that changed since it was fetched, or return
   * null to request a full sweep. The org-wide probe (no state/author/draft
   * filters) is the removal signal: a PR that left a bucket — closed, merged,
   * un-requested, drafted — was necessarily updated, so cached rows whose key
   * it names are dropped unless the per-bucket deltas re-add them.
   */
  private async incrementalSweep(
    base: SweepResult,
    parts: { open: string; merged: string; queue: string },
    range: DateRange,
    login: string,
  ): Promise<SweepResult | null> {
    // `since` never reaches before the range start, so the looser updated:>=
    // filter on the open delta can't smuggle in rows the range would exclude.
    const sinceMs = Math.max(
      Date.parse(base.fetchedAt) - INCREMENTAL_SKEW_MS,
      Date.parse(`${range.start}T00:00:00Z`),
    );
    // Search wants +00:00, not the Z suffix, for datetime qualifiers.
    const since = new Date(sinceMs).toISOString().replace(/\.\d{3}Z$/, '+00:00');

    const changed = await this.searchAll(`org:${base.org} is:pr updated:>=${since}`, QUERY_BARE);
    // More changes than one query can enumerate → the removal signal is
    // incomplete and patching could leave ghosts. Resweep instead.
    if (changed.total > SEARCH_CAP) return null;
    const touched = new Set(changed.nodes.map(nodeKey));
    const fetchedAt = new Date().toISOString();
    if (touched.size === 0) return { ...base, fetchedAt };

    const mergedRange = range.end ? `merged:${range.start}..${range.end}` : `merged:>=${range.start}`;
    const [open, merged, queue] = await Promise.all([
      this.searchAll(`${parts.open} updated:>=${since}`, QUERY_OPEN).then((r) => r.nodes),
      this.searchAll(`${parts.merged} ${mergedRange} updated:>=${since}`, QUERY_BARE).then((r) => r.nodes),
      this.searchAll(`${parts.queue} updated:>=${since}`, QUERY_QUEUE).then((r) => r.nodes),
    ]);

    const patch = (rows: PrRow[], fresh: PrRow[]): PrRow[] => {
      const freshKeys = new Set(fresh.map(rowKey));
      return [...fresh, ...rows.filter((r) => !touched.has(rowKey(r)) && !freshKeys.has(rowKey(r)))];
    };
    return {
      fetchedAt,
      org: base.org,
      range,
      open: patch(base.open, open.map((n) => toRow(n, bucketOf(n)))),
      merged: patch(base.merged, merged.map((n) => toRow(n, 'merged'))),
      queue: patch(base.queue, queue.map((n) => toRow(n, bucketOf(n), login))),
    };
  }

  /**
   * Search a date-windowed query completely: when GitHub's 1000-result cap
   * would truncate the window, split it in half by date and recurse. A window
   * narrowed to a single day that still overflows is truncated (and logged) —
   * there is no finer qualifier to split on.
   */
  private async searchWindowed(
    build: (from: string, to: string) => string,
    from: string,
    to: string,
    doc: string,
    depth = 0,
  ): Promise<SearchNode[]> {
    const { nodes, total } = await this.searchAll(build(from, to), doc);
    if (total <= SEARCH_CAP || from >= to || depth >= 8) {
      if (total > SEARCH_CAP) {
        console.warn(`[github] ${total} results in ${from}..${to} exceed the search cap — showing the first ${SEARCH_CAP}`);
      }
      return nodes;
    }
    const mid = midDate(from, to);
    const [a, b] = await Promise.all([
      this.searchWindowed(build, from, mid, doc, depth + 1),
      this.searchWindowed(build, nextDay(mid), to, doc, depth + 1),
    ]);
    // Day-granular halves can't overlap for a single date field, but dedupe
    // defensively — a duplicate row is worse than a wasted comparison.
    const seen = new Set<string>();
    return [...a, ...b].filter((n) => {
      const k = nodeKey(n);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  private async searchAll(q: string, doc: string = QUERY_BARE): Promise<{ nodes: SearchNode[]; total: number }> {
    const nodes: SearchNode[] = [];
    let after: string | null = null;
    let total = 0;
    // The search cap is SEARCH_CAP results = SEARCH_CAP / PAGE_SIZE pages; the
    // guard also keeps a backend pagination bug from spinning forever.
    for (let page = 0; page < SEARCH_CAP / PAGE_SIZE; page++) {
      const data: SearchPage = await this.graphql(doc, { q, after });
      total = data.search.issueCount ?? 0;
      // Non-PR results (the search type is issue-shaped) come back as empty
      // objects from the inline fragment — drop them.
      nodes.push(...data.search.nodes.filter((n) => n && n.url));
      if (!data.search.pageInfo.hasNextPage) break;
      after = data.search.pageInfo.endCursor;
    }
    return { nodes, total };
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>, attempt = 0): Promise<T> {
    const token = this.token();
    if (!token) throw new Error('No GitHub token configured.');
    let res: {
      ok: boolean;
      status: number;
      headers: { get(name: string): string | null };
      json(): Promise<unknown>;
    };
    try {
      res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'pr-sweep',
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (e) {
      // Network blip — same treatment as a transient server error.
      if (attempt >= MAX_RETRIES) throw e;
      await sleep(this.backoff(attempt));
      return this.graphql(query, variables, attempt + 1);
    }
    if (res.status === 401) throw new Error('GitHub rejected the token (401). Replace it in Settings.');
    if (!res.ok) {
      // 403/429 are the primary/secondary rate limits; 5xx is GitHub having a
      // moment (big GraphQL queries 502 more than they should). Honor the
      // server-stated wait when there is one, back off exponentially otherwise.
      if (attempt < MAX_RETRIES && [403, 429, 502, 503, 504].includes(res.status)) {
        await sleep(this.retryAfter(res) ?? this.backoff(attempt));
        return this.graphql(query, variables, attempt + 1);
      }
      throw new Error(`GitHub API error: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string; type?: string }> };
    if (process.env.PRSWEEP_DEBUG) {
      console.log('[github] vars:', JSON.stringify(variables).slice(0, 300));
      console.log('[github] scopes:', res.headers.get('x-oauth-scopes'), '| sso:', res.headers.get('x-github-sso'), '| token:', (token ?? '').slice(0, 12) + '…' + (token ?? '').length);
      console.log('[github] body:', JSON.stringify(body).slice(0, 500));
    }
    if (body.errors?.length) {
      // GraphQL rate limiting arrives as an HTTP 200 with a typed error.
      if (attempt < MAX_RETRIES && body.errors.some((e) => e.type === 'RATE_LIMITED')) {
        await sleep(this.retryAfter(res) ?? this.backoff(attempt));
        return this.graphql(query, variables, attempt + 1);
      }
      throw new Error(`GitHub API error: ${body.errors[0].message}`);
    }
    if (!body.data) throw new Error('GitHub API returned no data.');
    return body.data;
  }

  /** Server-stated wait: Retry-After seconds, or the primary limit's reset stamp. */
  private retryAfter(res: { headers: { get(name: string): string | null } }): number | null {
    const ra = Number(res.headers.get('retry-after'));
    if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, MAX_RETRY_WAIT_MS);
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      if (Number.isFinite(reset) && reset > 0) {
        return Math.min(Math.max(reset * 1000 - Date.now(), 1000), MAX_RETRY_WAIT_MS);
      }
    }
    return null;
  }

  private backoff(attempt: number): number {
    return (this.opts.retryBaseMs ?? 1000) * 2 ** attempt;
  }
}

function bucketOf(n: SearchNode): ReviewBucket {
  switch (n.reviewDecision) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changes-requested';
    // REVIEW_REQUIRED, and null for repos without required-review protection —
    // either way nobody has approved it yet, so it needs eyes.
    default:
      return 'needs-review';
  }
}

function toRow(n: SearchNode, bucket: ReviewBucket, viewer?: string): PrRow {
  return {
    repo: n.repository.name,
    number: n.number,
    title: n.title,
    url: n.url,
    isDraft: n.isDraft,
    author: n.author?.login ?? 'unknown',
    authorAvatarUrl: n.author?.avatarUrl ?? '',
    bucket,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    mergedAt: n.mergedAt,
    comments: n.totalCommentsCount,
    additions: n.additions,
    deletions: n.deletions,
    requestedReviewers: n.reviewRequests.nodes
      .map((r) => r.requestedReviewer?.login)
      .filter((l): l is string => !!l),
    ci: ciOf(n),
    reviewRequestedAt: viewer ? requestedAtFor(n, viewer) : null,
  };
}

/** Latest commit's check rollup, collapsed to a traffic light (null = no checks). */
function ciOf(n: SearchNode): PrRow['ci'] {
  const state = n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
  if (!state) return null;
  if (state === 'SUCCESS') return 'success';
  if (state === 'FAILURE' || state === 'ERROR') return 'failure';
  return 'pending'; // PENDING / EXPECTED
}

/** Newest REVIEW_REQUESTED_EVENT naming `viewer` — when their review was asked for. */
function requestedAtFor(n: SearchNode, viewer: string): string | null {
  const events = n.timelineItems?.nodes ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.requestedReviewer?.login === viewer && events[i].createdAt) {
      return events[i].createdAt ?? null;
    }
  }
  return null;
}

const nodeKey = (n: SearchNode): string => `${n.repository.name}#${n.number}`;
const rowKey = (r: PrRow): string => `${r.repo}#${r.number}`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function midDate(from: string, to: string): string {
  const mid = new Date((Date.parse(`${from}T00:00:00Z`) + Date.parse(`${to}T00:00:00Z`)) / 2);
  return mid.toISOString().slice(0, 10);
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
