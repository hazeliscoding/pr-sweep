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
 *  - the full sweep's merged list runs one week per search, a few in flight,
 *    instead of paging through the whole range one request at a time.
 *  - a search page that times out (502/504, or a 200 with a cut-off body) is
 *    re-sent at half the size, down to 25, before the usual retries —
 *    whole-org searches on big orgs time out at 100 every time. Later searches
 *    of the same kind start at the smaller size for an hour, so the timeouts
 *    (and the secondary rate limits they trigger) aren't paid again and again.
 *  - rate limits (primary and secondary) and transient 5xx are retried with the
 *    server-stated wait when GitHub provides one, exponential backoff otherwise.
 *  - auto-refreshes can run incrementally against the previous sweep: one cheap
 *    org-wide "what changed since last time" probe plus per-bucket deltas,
 *    instead of re-fetching every PR in the range (see sweep()'s `base` param).
 */
import { DateRange, PrRow, ReviewBucket, SWEEP_SCHEMA, SweepConfig, SweepResult } from '../../shared/types';
import { activeProfile } from './config.service';

const GRAPHQL_URL = 'https://api.github.com/graphql';
// GraphQL search's max page size — fewer round trips is the single biggest
// lever on sweep latency for busy ranges.
const PAGE_SIZE = 100;
/**
 * A search page GitHub can't answer in time (502/504) is re-sent at half the
 * size, down to this. Whole-org searches on big orgs time out at 100 every time,
 * and repeating the same request only adds the backoff.
 */
const MIN_PAGE_SIZE = 25;
/**
 * A shrunken page size is reused by later searches of the same kind for this
 * long, so a sweep doesn't pay the same timeouts search after search. It then
 * expires, and a one-off 502 can't keep a small profile's pages small.
 */
const PAGE_SIZE_MEMORY_MS = 60 * 60_000;
/** GitHub search returns at most this many results per query, full stop. */
const SEARCH_CAP = 1000;
/**
 * The full sweep's merged search runs one week per query, a few at a time. A
 * single query over the range pages through it one request after another, and
 * that made up most of a full sweep (28.9 s on a 5-author electron team in
 * v0.10.4). The cap keeps concurrent searches clear of GitHub's secondary rate
 * limits.
 */
const MERGED_WINDOW_DAYS = 7;
const MERGED_CONCURRENCY = 4;
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
  query ($q: String!, $after: String, $first: Int!) {
    search(query: $q, type: ISSUE_ADVANCED, first: $first, after: $after) {
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

/** What the last sweep cost — logged under PRSWEEP_DEBUG and read by e2e/bench-sweep.mjs. */
export interface SweepStats {
  mode: 'full' | 'incremental';
  ok: boolean;
  ms: number;
  /** HTTP round trips, re-sends included. */
  requests: number;
  retries: number;
}

export class GithubService {
  constructor(
    private readonly token: () => string | null,
    /** retryBaseMs and now let tests shrink the backoff and move the clock. */
    private readonly opts: { retryBaseMs?: number; now?: () => number } = {},
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

  lastSweep: SweepStats | null = null;
  private counters = { mode: 'full' as SweepStats['mode'], requests: 0, retries: 0 };

  /**
   * Runs the sweep. When `base` (the previous sweep) is fresh and matches the
   * org + range, only PRs updated since it are fetched and patched in — for a
   * big org's auto-refresh that's a handful of results instead of the whole
   * range. Anything that makes the patch unsafe (stale base, range mismatch,
   * more changes than search can enumerate) falls back to a full sweep.
   */
  async sweep(config: SweepConfig, range: DateRange, base: SweepResult | null = null): Promise<SweepResult> {
    const started = Date.now();
    this.counters = { mode: 'full', requests: 0, retries: 0 };
    let ok = false;
    try {
      const result = await this.sweepOnce(config, range, base);
      ok = true;
      return result;
    } finally {
      this.lastSweep = { ...this.counters, ok, ms: Date.now() - started };
    }
  }

  private async sweepOnce(config: SweepConfig, range: DateRange, base: SweepResult | null): Promise<SweepResult> {
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
      if (patched) {
        this.counters.mode = 'incremental';
        return patched;
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const end = range.end ?? today;
    const [open, merged, queue] = await Promise.all([
      this.searchWindowed((a, b) => `${parts.open} updated:${a}..${b}`, range.start, end, QUERY_OPEN),
      this.searchMerged(parts.merged, range.start, end),
      this.searchAll(parts.queue, QUERY_QUEUE).then((r) => r.nodes),
    ]);
    return {
      schema: SWEEP_SCHEMA,
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
    if (!base || base.schema !== SWEEP_SCHEMA || base.org !== org) return false;
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
      schema: SWEEP_SCHEMA,
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
      this.searchWindowed(build, addDays(mid, 1), to, doc, depth + 1),
    ]);
    return uniqueNodes([...a, ...b]);
  }

  /** Merged PRs in from..to, one week per search with MERGED_CONCURRENCY in flight. */
  private async searchMerged(q: string, from: string, to: string): Promise<SearchNode[]> {
    const weeks = await mapLimit(windows(from, to, MERGED_WINDOW_DAYS), MERGED_CONCURRENCY, ([a, b]) =>
      this.searchWindowed((x, y) => `${q} merged:${x}..${y}`, a, b, QUERY_BARE),
    );
    return uniqueNodes(weeks.flat());
  }

  private async searchAll(q: string, doc: string = QUERY_BARE): Promise<{ nodes: SearchNode[]; total: number }> {
    const nodes: SearchNode[] = [];
    let after: string | null = null;
    let total = 0;
    const kind = searchKind(q, doc);
    let first = this.startingPageSize(kind);
    // Search stops at SEARCH_CAP results; the guard (smallest pages, plus the two
    // halvings) also keeps a backend pagination bug from spinning forever.
    for (let request = 0; request < SEARCH_CAP / MIN_PAGE_SIZE + 2 && nodes.length < SEARCH_CAP; request++) {
      let data: SearchPage;
      try {
        first = Math.min(first, this.startingPageSize(kind));
        data = await this.graphql(doc, { q, after, first }, 0, first > MIN_PAGE_SIZE);
      } catch (e) {
        if (!(e instanceof GithubTimeout)) throw e;
        first = Math.max(MIN_PAGE_SIZE, first / 2);
        this.rememberPageSize(kind, first);
        this.counters.retries++;
        continue;
      }
      total = data.search.issueCount ?? 0;
      // Non-PR results (the search type is issue-shaped) come back as empty
      // objects from the inline fragment — drop them.
      nodes.push(...data.search.nodes.filter((n) => n && n.url));
      if (!data.search.pageInfo.hasNextPage) break;
      after = data.search.pageInfo.endCursor;
    }
    return { nodes, total };
  }

  /** `shrinkable`: a 502/504 throws GithubTimeout at once so the caller can ask for less. */
  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    attempt = 0,
    shrinkable = false,
  ): Promise<T> {
    const token = this.token();
    if (!token) throw new Error('No GitHub token configured.');
    this.counters.requests++;
    if (attempt > 0) this.counters.retries++;
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
      await this.pause('network error', this.backoff(attempt));
      return this.graphql(query, variables, attempt + 1, shrinkable);
    }
    if (res.status === 401) throw new Error('GitHub rejected the token (401). Replace it in Settings.');
    if (!res.ok) {
      if (shrinkable && (res.status === 502 || res.status === 504)) {
        throw new GithubTimeout(`GitHub API error: HTTP ${res.status}`);
      }
      // 403/429 are the primary/secondary rate limits; 5xx is GitHub having a
      // moment (big GraphQL queries 502 more than they should). Honor the
      // server-stated wait when there is one, back off exponentially otherwise.
      if (attempt < MAX_RETRIES && [403, 429, 502, 503, 504].includes(res.status)) {
        await this.pause(`HTTP ${res.status}`, this.retryAfter(res) ?? this.backoff(attempt));
        return this.graphql(query, variables, attempt + 1, shrinkable);
      }
      throw new Error(`GitHub API error: HTTP ${res.status}`);
    }
    let body: { data?: T; errors?: Array<{ message: string; type?: string }> };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // Queries GitHub gives up on can also arrive as a 200 with a cut-off body.
      if (shrinkable) throw new GithubTimeout('GitHub API returned a truncated response.');
      if (attempt < MAX_RETRIES) {
        await this.pause('truncated response', this.backoff(attempt));
        return this.graphql(query, variables, attempt + 1, shrinkable);
      }
      throw new Error('GitHub API returned a truncated response.');
    }
    if (process.env.PRSWEEP_DEBUG) {
      console.log('[github] vars:', JSON.stringify(variables).slice(0, 300));
      console.log('[github] scopes:', res.headers.get('x-oauth-scopes'), '| sso:', res.headers.get('x-github-sso'), '| token:', (token ?? '').slice(0, 12) + '…' + (token ?? '').length);
      console.log('[github] body:', JSON.stringify(body).slice(0, 500));
    }
    if (body.errors?.length) {
      // GraphQL rate limiting arrives as an HTTP 200 with a typed error.
      if (attempt < MAX_RETRIES && body.errors.some((e) => e.type === 'RATE_LIMITED')) {
        await this.pause('RATE_LIMITED', this.retryAfter(res) ?? this.backoff(attempt));
        return this.graphql(query, variables, attempt + 1, shrinkable);
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

  private pageSizes = new Map<string, { size: number; until: number }>();

  private startingPageSize(kind: string): number {
    const memory = this.pageSizes.get(kind);
    return memory && memory.until > this.now() ? memory.size : PAGE_SIZE;
  }

  private rememberPageSize(kind: string, size: number): void {
    if (size < this.startingPageSize(kind)) {
      this.pageSizes.set(kind, { size, until: this.now() + PAGE_SIZE_MEMORY_MS });
    }
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** Sleep before a retry; PRSWEEP_DEBUG says why and for how long. */
  private async pause(reason: string, ms: number): Promise<void> {
    if (process.env.PRSWEEP_DEBUG) console.log(`[github] retry after ${reason}, waiting ${(ms / 1000).toFixed(1)} s`);
    await sleep(ms);
  }

  private backoff(attempt: number): number {
    return (this.opts.retryBaseMs ?? 1000) * 2 ** attempt;
  }
}

/** GitHub couldn't answer a search page in time; the page should be re-sent smaller. */
class GithubTimeout extends Error {}

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

/**
 * Searches that differ only in their date window (merged weeks, the halves of a
 * capped window, an incremental delta) are the same kind for page sizing.
 */
function searchKind(q: string, doc: string): string {
  return `${doc}\n${q.replace(/\s(updated|merged|created):\S+/g, '')}`;
}

const nodeKey = (n: SearchNode): string => `${n.repository.name}#${n.number}`;
const rowKey = (r: PrRow): string => `${r.repo}#${r.number}`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function midDate(from: string, to: string): string {
  const mid = new Date((Date.parse(`${from}T00:00:00Z`) + Date.parse(`${to}T00:00:00Z`)) / 2);
  return mid.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Consecutive `days`-long windows covering from..to, the last one cut short at `to`. */
function windows(from: string, to: string, days: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let start = from; start <= to; start = addDays(start, days)) {
    const end = addDays(start, days - 1);
    out.push([start, end < to ? end : to]);
  }
  return out;
}

/** Windows can't overlap for a single date field, but dedupe defensively — a
    duplicate row is worse than a wasted comparison. */
function uniqueNodes(nodes: SearchNode[]): SearchNode[] {
  const seen = new Set<string>();
  return nodes.filter((n) => {
    const k = nodeKey(n);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Like Promise.all over `items.map(fn)`, but with at most `limit` calls in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
