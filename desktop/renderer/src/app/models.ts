/**
 * Renderer-side mirror of desktop/src/shared/types.ts (the renderer builds in
 * its own tree and can't import across the boundary — same trade-off as
 * gil-sweep). Keep the two files in sync when the IPC contract changes.
 */

export interface Sprint {
  id: string;
  name: string;
  start: string;
  end: string;
}

export interface SweepConfig {
  org: string;
  authors: string[];
  sprints: Sprint[];
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

export interface SprintWindow {
  start: string;
  end: string;
}

export interface SweepResult {
  fetchedAt: string;
  window: SprintWindow;
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
  fetchPrs(window: SprintWindow): Promise<SweepResult>;
  openExternal(url: string): Promise<void>;
}
