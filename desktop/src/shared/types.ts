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
 * A profile's sprint schedule. Every sprint is computed from it (core/sprints.ts);
 * none is stored, so "Current" rolls over by itself.
 */
export interface SprintSchedule {
  /** Name pattern; {n} becomes the sprint number: "Sprint {n}". */
  pattern: string;
  /** The first sprint: its number and start date (local yyyy-mm-dd). */
  first: { number: number; start: string };
  /** Days per sprint, 1–60. */
  lengthDays: number;
  /** One-off lengths by sprint number; later sprints shift to follow. */
  lengths: Record<number, number>;
  /** One-off names by sprint number. */
  names: Record<number, string>;
}

/** What a profile's board looks at: today's sprint, a pinned sprint, or its own date range. */
export type Period = 'current' | { sprint: number } | 'custom';

export interface Sprint {
  number: number;
  name: string;
  /** First and last day, local yyyy-mm-dd, both included. */
  start: string;
  end: string;
}

/** The sprints around today for the schedule editor in Settings (see sprints:preview). */
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

/** A profile's period resolved against today by the main process (see period:resolve). */
export interface ResolvedPeriod {
  kind: 'sprint' | 'custom';
  /** "Sprint 24 · Sep 14–27", "Sep 17 – Oct 1" or "Since Sep 17". */
  label: string;
  /** What the sweep covers: the sprint's days, or the custom range. */
  range: DateRange;
  /** The sprint shown, when kind is 'sprint'. */
  sprint: Sprint | null;
  /** The sprint shown is the one containing today. */
  isCurrent: boolean;
  /** Neighbours for the picker's arrows; null before the first sprint. */
  previous: Sprint | null;
  next: Sprint | null;
  /** The sprint containing today, if the schedule has started. */
  current: Sprint | null;
  /** False until the profile has a sprint schedule. */
  hasSchedule: boolean;
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
  /** Null until the team sets one up in Settings. */
  sprints: SprintSchedule | null;
  period: Period;
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

/** Why an open PR needs a human, from the attention engine (core/attention.ts). */
export interface Attention {
  reason: AttentionReason;
  /** 1 is the most severe; a row's attention list is sorted by it. */
  severity: number;
  /** When the reason started to hold, as far as GitHub says. Null for merge conflicts. */
  since: string | null;
  /** The next step's label, and the page it opens. */
  action: string;
  href: string;
}

/**
 * The sprint's story for the health strip, worked out in main after every sweep
 * (core/summary.ts). Team-wide: author chips, search and snoozes never change it.
 */
export interface SprintSummary {
  /** Where today falls against the range. */
  when: 'before' | 'during' | 'after';
  /** Whole days from today to the range's last day, 0 on the last day; null without an end. */
  daysLeft: number | null;
  /** In the range's last two days, when PRs that aren't approved deserve a warning. */
  endingSoon: boolean;
  /** "Sep 17" or "Oct 1", with the year when it isn't this one. */
  startLabel: string;
  endLabel: string | null;
  open: number;
  /** Open PRs that aren't drafts and aren't approved. */
  notApproved: number;
  /** Flagged and not quiet: the standup's Blocked plus Needs attention. */
  needsAttention: number;
  blocked: number;
  /** Flagged but quiet, so left out of needsAttention. */
  quiet: number;
  merged: number;
  /** Merged since the last working day began: "3 since Monday". */
  mergedSince: number;
  /** That day's name, or the range's start date when the range began after it. */
  sinceLabel: string;
  /** The last working day came before the range began, so "since" means since the start. */
  sinceStart: boolean;
  /** Median of merge time minus open time over the merged PRs; null when none merged. */
  medianMergeMs: number | null;
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
  /** Logins (and org/team slugs) with an outstanding review request. */
  requestedReviewers: string[];
  /** Latest commit's check rollup as a traffic light; null = no checks configured. */
  ci: 'success' | 'failure' | 'pending' | null;
  /** When the signed-in user's review was requested — set on queue rows, null elsewhere. */
  reviewRequestedAt: string | null;
  /** Review requests to people and teams (requestedReviewers lists at most 10). */
  requestCount: number;
  /** When the latest commit was made; null on merged rows. */
  lastCommitAt: string | null;
  // Fetched only for approved, changes-requested and unrequested needs-review
  // rows (see needsDetails in github.service.ts); null elsewhere.
  mergeable: 'mergeable' | 'conflicting' | 'unknown' | null;
  approvedAt: string | null;
  changesRequestedAt: string | null;
  reviewCount: number | null;
  /** The attention engine's reasons, most severe first. Always empty on merged and queue rows. */
  attention: Attention[];
  /** Flagged, but only for slow reasons or after a month untouched: shown behind a toggle. */
  quiet: boolean;
}

/**
 * Version of the SweepResult / PrRow shape. Bump it whenever either changes:
 * incremental refreshes keep cached rows until each PR changes on GitHub, so a
 * snapshot from an older build must be swept afresh, never painted or patched.
 */
export const SWEEP_SCHEMA = 6;

export interface SweepResult {
  /** SWEEP_SCHEMA when this was written; absent in snapshots from before v0.11. */
  schema: number;
  fetchedAt: string;
  /** Org the sweep ran against — lets a cached snapshot prove it's still relevant. */
  org: string;
  range: DateRange;
  open: PrRow[];
  merged: PrRow[];
  /** Open PRs org-wide with the signed-in user's review requested — any author, any age. */
  queue: PrRow[];
  summary: SprintSummary | null;
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
  /** The active profile's period (sprint or custom range) resolved against today. */
  resolvePeriod(): Promise<ResolvedPeriod>;
  /** A schedule's sprints around today, for previewing edits before (and after) they're saved. */
  previewSprints(schedule: SprintSchedule): Promise<SprintPreview>;
  /**
   * Push the latest sweep's tray-relevant slices: the review queue (counts +
   * review-request toasts), the viewer's own open PRs (approval / changes-
   * requested / CI-failure toasts), and the counts behind the menu lines.
   */
  syncTray(sync: { queue: PrRow[]; mine: PrRow[]; needsReviewCount: number; attentionCount: number }): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Subscribe to auto-update state pushes (download progress, ready-to-restart). */
  onUpdateState(cb: (state: UpdateState | null) => void): void;
  /** Quit and install the downloaded update (no-op if none is ready). */
  installUpdate(): Promise<void>;
  /** Write the profiles to a JSON file the user picks. Returns false if cancelled. */
  exportProfiles(): Promise<boolean>;
  /** Merge profiles from a JSON file the user picks. Returns the updated config, or null if cancelled. */
  importProfiles(): Promise<SweepConfig | null>;
}
