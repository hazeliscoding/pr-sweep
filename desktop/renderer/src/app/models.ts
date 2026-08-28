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

export interface Profile {
  id: string;
  name: string;
  org: string;
  authors: string[];
  range: DateRange;
  includeDrafts: boolean;
  staleDays: number;
}

export type ProfilePatch = Partial<Omit<Profile, 'id'>>;

export interface SweepConfig {
  profiles: Profile[];
  activeProfileId: string;
  autoRefreshMinutes: number;
  notifications: boolean;
  closeToTray: boolean;
  oauthClientId: string;
}

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
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
  requestedReviewers: string[];
}

export interface SweepResult {
  fetchedAt: string;
  org: string;
  range: DateRange;
  open: PrRow[];
  merged: PrRow[];
  queue: PrRow[];
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
  oauthAvailable(): Promise<boolean>;
  startOAuth(): Promise<AuthStatus>;
  onOAuthCode(cb: (info: DeviceCodeInfo) => void): void;
  /**
   * Run a sweep. 'auto' (the refresh timer) may patch the cached snapshot
   * incrementally — only PRs updated since it — while 'full' (the default;
   * manual refresh, settings changes) always re-fetches everything.
   */
  fetchPrs(range: DateRange, mode?: 'full' | 'auto'): Promise<SweepResult>;
  latestSweep(): Promise<SweepResult | null>;
  syncTray(sync: { queue: PrRow[]; needsReviewCount: number }): Promise<void>;
  openExternal(url: string): Promise<void>;
  exportProfiles(): Promise<boolean>;
  importProfiles(): Promise<SweepConfig | null>;
}
