/**
 * The attention engine: the single definition of "this PR needs a human". The
 * Sweep section, the tray line, the sprint summary and the standup all read its
 * output. It runs in the main process after every sweep, over every open row,
 * cached ones included: reasons depend on the clock, so a verdict saved once on
 * a row would go stale while the row sat unchanged in the snapshot.
 *
 * Pure: no I/O, and the clock comes in through the context.
 */
import { Attention, AttentionReason, PrRow, SweepResult } from '../../shared/types';

export interface AttentionContext {
  now: number;
  /** The profile's stale threshold. 0 turns off the slow reasons: waiting, stale, old draft. */
  staleDays: number;
}

/** Most severe first. An Attention's severity is its 1-based place here. */
const ORDER: AttentionReason[] = [
  'CI_FAILING',
  'MERGE_CONFLICT',
  'CHANGES_NOT_ADDRESSED',
  'NEEDS_RE_REVIEW',
  'APPROVED_NOT_MERGED',
  'NO_REVIEWERS',
  'WAITING_FOR_REVIEW',
  'STALE',
  'DRAFT_TOO_LONG',
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A fresh review, push or approval gets a day before it counts as stuck. */
const SETTLE_MS = DAY;
/** Time for the author to add reviewers before a PR counts as unassigned. */
const NO_REVIEWERS_GRACE_MS = HOUR;
/** Waiting, stale and old draft: reasons that only say time has passed. */
const SLOW_SEVERITY = ORDER.indexOf('WAITING_FOR_REVIEW') + 1;
/** Untouched this long, a PR is unlikely to get action this sprint, whatever its reasons. */
const QUIET_IDLE_MS = 30 * DAY;

export function attention(row: PrRow, ctx: AttentionContext): Attention[] {
  const age = (ts: string): number => ctx.now - Date.parse(ts);
  const slow = ctx.staleDays > 0 ? ctx.staleDays * DAY : Infinity;
  const out: Attention[] = [];
  const add = (reason: AttentionReason, since: string | null, action: string, path = ''): void => {
    out.push({ reason, severity: ORDER.indexOf(reason) + 1, since, action, href: row.url + path });
  };

  // A draft is work in progress: failing CI or a conflict there is expected.
  // Only its age is worth a nudge.
  if (row.isDraft) {
    if (age(row.createdAt) > slow) add('DRAFT_TOO_LONG', row.createdAt, 'Mark ready or close');
    return out;
  }

  if (row.ci === 'failure') add('CI_FAILING', row.lastCommitAt, 'Fix CI', '/checks');
  if (row.mergeable === 'conflicting') add('MERGE_CONFLICT', null, 'Resolve conflict');

  // Changes requested has two next steps: the author's until they push, the
  // reviewer's after.
  if (row.bucket === 'changes-requested' && row.changesRequestedAt) {
    const pushed = row.lastCommitAt !== null && Date.parse(row.lastCommitAt) > Date.parse(row.changesRequestedAt);
    if (!pushed && age(row.changesRequestedAt) > SETTLE_MS) {
      add('CHANGES_NOT_ADDRESSED', row.changesRequestedAt, 'Address feedback');
    }
    if (pushed && age(row.lastCommitAt as string) > SETTLE_MS) {
      add('NEEDS_RE_REVIEW', row.lastCommitAt, 'Re-review', '/files');
    }
  }

  const mergeable = (row.ci === 'success' || row.ci === null) && row.mergeable !== 'conflicting';
  if (row.bucket === 'approved' && row.approvedAt && mergeable && age(row.approvedAt) > SETTLE_MS) {
    add('APPROVED_NOT_MERGED', row.approvedAt, 'Merge');
  }

  if (row.bucket === 'needs-review') {
    // reviewCount is null when the details weren't fetched: no verdict then.
    if (row.requestCount === 0 && row.reviewCount === 0 && age(row.createdAt) > NO_REVIEWERS_GRACE_MS) {
      add('NO_REVIEWERS', row.createdAt, 'Request reviewers');
    }
    if (row.requestCount > 0 && age(row.createdAt) > slow) add('WAITING_FOR_REVIEW', row.createdAt, 'Nudge reviewers');
  }

  if (age(row.updatedAt) > slow) add('STALE', row.updatedAt, 'Nudge');
  return out.sort((a, b) => a.severity - b.severity);
}

/**
 * Quiet rows sit behind a toggle in the Sweep and stay out of the tray count, so
 * the main list stays short: the worst reason is a slow one, or nobody has
 * touched the PR in a month.
 */
export function isQuiet(row: PrRow, reasons: Attention[], ctx: AttentionContext): boolean {
  if (reasons.length === 0) return false;
  return reasons[0].severity >= SLOW_SEVERITY || ctx.now - Date.parse(row.updatedAt) > QUIET_IDLE_MS;
}

/** Reasons someone has to fix before the PR can move: the standup's Blocked group. */
const BLOCKED: ReadonlySet<AttentionReason> = new Set(['CI_FAILING', 'MERGE_CONFLICT', 'CHANGES_NOT_ADDRESSED']);

export type StandupGroup = 'blocked' | 'attention' | 'review';

/**
 * Where a judged open row goes in the standup, and so which count it adds to in
 * the health strip: Blocked, then the rest of the Sweep, then In review, which
 * takes quiet rows and anything not flagged. Drafts aren't in the standup.
 */
export function standupGroup(row: PrRow): StandupGroup | null {
  if (row.isDraft) return null;
  if (row.quiet || row.attention.length === 0) return 'review';
  return row.attention.some((a) => BLOCKED.has(a.reason)) ? 'blocked' : 'attention';
}

/** The sweep with every open row judged afresh. Merged and queue rows never need attention. */
export function annotate(result: SweepResult, ctx: AttentionContext): SweepResult {
  return {
    ...result,
    open: result.open.map((row) => {
      const reasons = attention(row, ctx);
      return { ...row, attention: reasons, quiet: isQuiet(row, reasons, ctx) };
    }),
  };
}
