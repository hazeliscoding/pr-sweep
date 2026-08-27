/**
 * Types shared between the Electron main process and (via a mirrored copy in
 * renderer/src/app/models.ts) the Angular renderer. The PrSweepApi interface is
 * the whole main<->renderer contract: preload.ts implements it, ipc.ts handles
 * it — adding a feature means touching all three.
 */

/**
 * The board's date window. Dates are ISO `yyyy-mm-dd`, inclusive. A null end
 * means open-ended: "from start until now" — the friendly default, since it
 * never goes stale.
 */
export interface DateRange {
  start: string;
  end: string | null;
}

export interface SweepConfig {
  org: string;
  /** GitHub logins whose PRs the dashboard aggregates. */
  authors: string[];
  range: DateRange;
  /** 0 disables auto-refresh. */
  autoRefreshMinutes: number;
  /** Include draft PRs on the board. */
  includeDrafts: boolean;
  /** Flag open PRs untouched for this many days. 0 disables. */
  staleDays: number;
}

export type SweepConfigPatch = Partial<SweepConfig>;

export type ReviewBucket = 'needs-review' | 'changes-requested' | 'approved' | 'merged';

export interface PrRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  author: string;
  authorAvatarUrl: string;
  bucket: ReviewBucket;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  comments: number;
  additions: number;
  deletions: number;
  /** Logins with an outstanding review request. */
  requestedReviewers: string[];
}

export interface SweepResult {
  fetchedAt: string;
  /** Org the sweep ran against — lets a cached snapshot prove it's still relevant. */
  org: string;
  range: DateRange;
  open: PrRow[];
  merged: PrRow[];
  /** Open PRs org-wide with the signed-in user's review requested — any author, any age. */
  queue: PrRow[];
}

export interface AuthStatus {
  hasToken: boolean;
  /** GitHub login the token authenticates as; null until validated. */
  login: string | null;
  error: string | null;
}

export interface PrSweepApi {
  getConfig(): Promise<SweepConfig>;
  setConfig(patch: SweepConfigPatch): Promise<SweepConfig>;
  authStatus(): Promise<AuthStatus>;
  setToken(token: string): Promise<AuthStatus>;
  clearToken(): Promise<AuthStatus>;
  fetchPrs(range: DateRange): Promise<SweepResult>;
  /** Last sweep cached on disk, or null — for instant boot before the live refresh lands. */
  latestSweep(): Promise<SweepResult | null>;
  openExternal(url: string): Promise<void>;
}
