/**
 * The tray's wording, kept apart from tray.ts (which needs Electron) so it's
 * testable. The tooltip names the most urgent count: your review queue, then
 * the team's Sweep, then PRs waiting for review.
 */

export interface TrayCounts {
  /** Open PRs org-wide with your review requested. */
  queue: number;
  /** Sweep rows the user hasn't snoozed. */
  attention: number;
  needsReview: number;
}

const needAttention = (n: number): string => `${n} ${n === 1 ? 'needs' : 'need'} attention`;

export function trayTooltip(c: TrayCounts): string {
  const line =
    c.queue > 0
      ? `${c.queue} awaiting your review`
      : c.attention > 0
        ? needAttention(c.attention)
        : c.needsReview > 0
          ? `${c.needsReview} need review`
          : 'nothing waiting';
  return `PR Sweep — ${line}`;
}

export function trayMenuLines(c: TrayCounts): string[] {
  return [`${c.queue} awaiting your review`, `${needAttention(c.attention)} (team)`, `${c.needsReview} need review (team)`];
}
