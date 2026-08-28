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

/**
 * A saved board definition — "which org + team + window am I looking at". The
 * shareable unit: exporting config exports profiles (never tokens or machine
 * preferences), so one person can configure the team's view and hand it out.
 */
export interface Profile {
  id: string;
  name: string;
  org: string;
  /** GitHub logins whose PRs the dashboard aggregates (empty = whole org). */
  authors: string[];
  range: DateRange;
  /** Include draft PRs on the board. */
  includeDrafts: boolean;
  /** Flag open PRs untouched for this many days. 0 disables. */
  staleDays: number;
}

export type ProfilePatch = Partial<Omit<Profile, 'id'>>;

export interface SweepConfig {
  profiles: Profile[];
  activeProfileId: string;
  /** 0 disables auto-refresh. */
  autoRefreshMinutes: number;
  /** Fire a desktop notification when a new PR lands in your review queue. */
  notifications: boolean;
  /** Closing the window hides to tray (keeps watching) instead of quitting. */
  closeToTray: boolean;
  /** Per-install override for the device-flow OAuth App client_id (advanced). */
  oauthClientId: string;
}

/** Pushed to the renderer mid-sign-in so it can show the code to enter. */
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
  /** Whether device-flow sign-in is available (a client_id is configured). */
  oauthAvailable(): Promise<boolean>;
  /** Run device-flow sign-in end to end; resolves with the resulting auth. */
  startOAuth(): Promise<AuthStatus>;
  /** Subscribe to the one-shot device code emitted mid-sign-in. */
  onOAuthCode(cb: (info: DeviceCodeInfo) => void): void;
  /**
   * Run a sweep. 'auto' (the refresh timer) may patch the cached snapshot
   * incrementally — only PRs updated since it — while 'full' (the default;
   * manual refresh, settings changes) always re-fetches everything.
   */
  fetchPrs(range: DateRange, mode?: 'full' | 'auto'): Promise<SweepResult>;
  /** Last sweep cached on disk, or null — for instant boot before the live refresh lands. */
  latestSweep(): Promise<SweepResult | null>;
  /** Push the latest queue to the tray for counts + review-request toasts. */
  syncTray(sync: { queue: PrRow[]; needsReviewCount: number }): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Write the profiles to a JSON file the user picks. Returns false if cancelled. */
  exportProfiles(): Promise<boolean>;
  /** Merge profiles from a JSON file the user picks. Returns the updated config, or null if cancelled. */
  importProfiles(): Promise<SweepConfig | null>;
}
