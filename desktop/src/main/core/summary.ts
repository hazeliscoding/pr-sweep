/**
 * The sprint's story for the health strip: how long is left, what's open, what
 * needs attention, what merged and how fast. Team-wide by design: it reads the
 * whole sweep, never the renderer's author chips, search or snoozes, so picking
 * one author can't turn time to merge into an individual cycle time.
 *
 * Pure: today (a local yyyy-mm-dd date) comes from the caller.
 */
import { DateRange, PrRow, SprintSummary, SweepResult } from '../../shared/types';
import { standupGroup } from './attention';
import { addDays, dayLabel, daysBetween, localDate, weekday } from './sprints';

/** The range's last days, the end day included, when PRs that aren't approved get a warning. */
const ENDING_SOON_DAYS = 2;

/** The weekday before today, Monday to Friday: a Monday standup looks back to Friday. */
export function lastWorkingDay(today: string): string {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, day === 1 ? -3 : day === 0 ? -2 : -1);
}

/**
 * Where "merged since" starts: the last working day, or the range's start when
 * the range began after it. The sweep only fetched merges inside the range, so
 * counting from earlier would miss some without saying so.
 */
export function sinceOf(range: DateRange, today: string): { since: string; sinceStart: boolean } {
  const workday = lastWorkingDay(today);
  return workday < range.start ? { since: range.start, sinceStart: true } : { since: workday, sinceStart: false };
}

/** The local day a merged row merged on, comparable with `since`. */
export const mergedOn = (row: PrRow): string => localDate(Date.parse(row.mergedAt ?? row.updatedAt));

export function summarize(result: SweepResult, ctx: { today: string }): SprintSummary {
  const { start, end } = result.range;
  const year = Number(ctx.today.slice(0, 4));
  const when = ctx.today < start ? 'before' : end && ctx.today > end ? 'after' : 'during';
  const daysLeft = end ? daysBetween(ctx.today, end) : null;
  const groups = result.open.map(standupGroup);
  const blocked = groups.filter((g) => g === 'blocked').length;
  const attention = groups.filter((g) => g === 'attention').length;
  const { since, sinceStart } = sinceOf(result.range, ctx.today);
  return {
    when,
    daysLeft,
    endingSoon: when === 'during' && daysLeft !== null && daysLeft <= ENDING_SOON_DAYS,
    startLabel: dayLabel(start, year),
    endLabel: end ? dayLabel(end, year) : null,
    open: result.open.length,
    notApproved: result.open.filter((r) => !r.isDraft && r.bucket !== 'approved').length,
    needsAttention: blocked + attention,
    blocked,
    quiet: result.open.filter((r) => r.quiet).length,
    merged: result.merged.length,
    mergedSince: result.merged.filter((r) => mergedOn(r) >= since).length,
    sinceLabel: sinceStart ? dayLabel(start, year) : weekday(since),
    sinceStart,
    medianMergeMs: median(
      result.merged.map((r) => Date.parse(r.mergedAt ?? r.updatedAt) - Date.parse(r.createdAt)),
    ),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
