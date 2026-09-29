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

export interface SprintSchedule {
  pattern: string;
  first: { number: number; start: string };
  lengthDays: number;
  lengths: Record<number, number>;
  names: Record<number, string>;
}

export type Period = 'current' | { sprint: number } | 'custom';

export interface Sprint {
  number: number;
  name: string;
  start: string;
  end: string;
}

/** The sprints around today for the schedule editor in Settings. */
export interface SprintPreview {
  sprints: PreviewSprint[];
  /** The sprint holding today, or null before the schedule starts. */
  current: number | null;
}

/** A sprint with what the editor shows for it, worked out in main like every sprint date. */
export interface PreviewSprint extends Sprint {
  /** "Sep 28 – Oct 11", with the year when it isn't this one. */
  dates: string;
  days: number;
}

export interface ResolvedPeriod {
  kind: 'sprint' | 'custom';
  label: string;
  range: DateRange;
  sprint: Sprint | null;
  isCurrent: boolean;
  previous: Sprint | null;
  next: Sprint | null;
  current: Sprint | null;
  hasSchedule: boolean;
}

export interface Profile {
  id: string;
  name: string;
  org: string;
  authors: string[];
  range: DateRange;
  includeDrafts: boolean;
  staleDays: number;
  sprints: SprintSchedule | null;
  period: Period;
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

export type AttentionReason =
  | 'CI_FAILING'
  | 'MERGE_CONFLICT'
  | 'CHANGES_NOT_ADDRESSED'
  | 'NEEDS_RE_REVIEW'
  | 'APPROVED_NOT_MERGED'
  | 'NO_REVIEWERS'
  | 'WAITING_FOR_REVIEW'
  | 'STALE'
  | 'DRAFT_TOO_LONG';

export interface Attention {
  reason: AttentionReason;
  /** 1 is the most severe; a row's attention list is sorted by it. */
  severity: number;
  since: string | null;
  action: string;
  href: string;
}

export interface SprintRisk {
  /** 0 = the range ends today. */
  endsInDays: number;
  notApproved: number;
}

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
  /** Latest commit's check rollup as a traffic light; null = no checks configured. */
  ci: 'success' | 'failure' | 'pending' | null;
  /** When the signed-in user's review was requested — set on queue rows, null elsewhere. */
  reviewRequestedAt: string | null;
  requestCount: number;
  lastCommitAt: string | null;
  mergeable: 'mergeable' | 'conflicting' | 'unknown' | null;
  approvedAt: string | null;
  changesRequestedAt: string | null;
  reviewCount: number | null;
  attention: Attention[];
  quiet: boolean;
}

export interface SweepResult {
  schema: number;
  fetchedAt: string;
  org: string;
  range: DateRange;
  open: PrRow[];
  merged: PrRow[];
  queue: PrRow[];
  sprintRisk: SprintRisk | null;
}

/** Auto-update progress pushed from main; null = nothing in flight. */
export interface UpdateState {
  status: 'downloading' | 'ready';
  version: string;
  /** 0–100 while downloading; 100 once ready. */
  percent: number;
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
  resolvePeriod(): Promise<ResolvedPeriod>;
  previewSprints(schedule: SprintSchedule): Promise<SprintPreview>;
  syncTray(sync: { queue: PrRow[]; mine: PrRow[]; needsReviewCount: number; attentionCount: number }): Promise<void>;
  openExternal(url: string): Promise<void>;
  onUpdateState(cb: (state: UpdateState | null) => void): void;
  installUpdate(): Promise<void>;
  exportProfiles(): Promise<boolean>;
  importProfiles(): Promise<SweepConfig | null>;
}
