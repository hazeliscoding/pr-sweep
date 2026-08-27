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
 */
import { DateRange, PrRow, ReviewBucket, SweepConfig, SweepResult } from '../../shared/types';

const GRAPHQL_URL = 'https://api.github.com/graphql';
// GraphQL search's max page size — fewer round trips is the single biggest
// lever on sweep latency for busy ranges.
const PAGE_SIZE = 100;

const SEARCH_QUERY = `
  query ($q: String!, $after: String) {
    search(query: $q, type: ISSUE_ADVANCED, first: ${PAGE_SIZE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number title url isDraft createdAt updatedAt mergedAt
          reviewDecision totalCommentsCount additions deletions
          repository { name }
          author { login avatarUrl }
          reviewRequests(first: 10) {
            nodes { requestedReviewer { ... on User { login } } }
          }
        }
      }
    }
  }
`;

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
}

export class GithubService {
  constructor(private readonly token: () => string | null) {}

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

  async sweep(config: SweepConfig, range: DateRange): Promise<SweepResult> {
    if (!config.org) throw new Error('No GitHub organization configured — set one in Settings.');
    const authors = config.authors.length
      ? `(${config.authors.map((a) => `author:${a}`).join(' OR ')})`
      : '';
    const drafts = config.includeDrafts ? '' : 'draft:false';
    const merged_ = range.end ? `merged:${range.start}..${range.end}` : `merged:>=${range.start}`;
    const openQ = `org:${config.org} is:pr is:open ${drafts} updated:>=${range.start} ${authors}`;
    const mergedQ = `org:${config.org} is:pr is:merged ${merged_} ${authors}`;
    // The queue is deliberately unscoped by range and authors: if someone asked
    // for your review, you want to see it no matter whose PR it is or how old.
    const login = await this.viewer();
    const queueQ = `org:${config.org} is:pr is:open ${drafts} review-requested:${login}`;

    const [open, merged, queue] = await Promise.all([
      this.searchAll(openQ),
      this.searchAll(mergedQ),
      this.searchAll(queueQ),
    ]);
    return {
      fetchedAt: new Date().toISOString(),
      org: config.org,
      range,
      open: open.map((n) => toRow(n, bucketOf(n))),
      merged: merged.map((n) => toRow(n, 'merged')),
      queue: queue.map((n) => toRow(n, bucketOf(n))),
    };
  }

  private async searchAll(q: string): Promise<SearchNode[]> {
    const nodes: SearchNode[] = [];
    let after: string | null = null;
    // The 1000-result search cap (20 pages) is far above any sprint's PR count;
    // the loop guard just keeps a backend pagination bug from spinning forever.
    for (let page = 0; page < 20; page++) {
      const data: {
        search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: SearchNode[] };
      } = await this.graphql(SEARCH_QUERY, { q, after });
      // Non-PR results (the search type is issue-shaped) come back as empty
      // objects from the inline fragment — drop them.
      nodes.push(...data.search.nodes.filter((n) => n && n.url));
      if (!data.search.pageInfo.hasNextPage) break;
      after = data.search.pageInfo.endCursor;
    }
    return nodes;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const token = this.token();
    if (!token) throw new Error('No GitHub token configured.');
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'pr-sweep',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401) throw new Error('GitHub rejected the token (401). Replace it in Settings.');
    if (!res.ok) throw new Error(`GitHub API error: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (process.env.PRSWEEP_DEBUG) {
      console.log('[github] vars:', JSON.stringify(variables).slice(0, 300));
      console.log('[github] scopes:', res.headers.get('x-oauth-scopes'), '| sso:', res.headers.get('x-github-sso'), '| token:', (token ?? '').slice(0, 12) + '…' + (token ?? '').length);
      console.log('[github] body:', JSON.stringify(body).slice(0, 500));
    }
    if (body.errors?.length) throw new Error(`GitHub API error: ${body.errors[0].message}`);
    if (!body.data) throw new Error('GitHub API returned no data.');
    return body.data;
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

function toRow(n: SearchNode, bucket: ReviewBucket): PrRow {
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
  };
}
