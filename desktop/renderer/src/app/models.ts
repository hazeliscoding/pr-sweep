/**
 * Renderer-side mirror of desktop/src/shared/types.ts (the renderer builds in
 * its own tree and can't import across the boundary — same trade-off as
 * gil-sweep). Keep the two files in sync when the IPC contract changes.
 */

export interface DateRange {
  start: string;
  /** null = open-ended ("from start until now"). */
  end: string | null;
}

export interface SweepConfig {
  org: string;
  authors: string[];
  range: DateRange;
  autoRefreshMinutes: number;
}

export type SweepConfigPatch = Partial<SweepConfig>;

export type ReviewBucket = 'needs-review' | 'changes-requested' | 'approved' | 'merged';

export interface PrRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  authorAvatarUrl: string;
  bucket: ReviewBucket;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  comments: number;
  additions: number;
  deletions: number;
  requestedReviewers: string[];
}

export interface SweepResult {
  fetchedAt: string;
  range: DateRange;
  open: PrRow[];
  merged: PrRow[];
}

export interface AuthStatus {
  hasToken: boolean;
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
  openExternal(url: string): Promise<void>;
}
