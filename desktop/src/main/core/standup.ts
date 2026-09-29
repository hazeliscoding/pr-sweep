/**
 * The standup: the sweep on screen, grouped for a team post, as Markdown and as
 * HTML for the clipboard. Slack and Teams paste the HTML; Discord and plain-text
 * places take the Markdown. Checked by pasting into Teams and Discord
 * (2026-09-29): links as `[ref](<url>)` keep Discord from stacking a preview
 * card per link, and non-ASCII goes into the HTML as entities so no app can
 * misread the clipboard's encoding.
 *
 * Team-wide like the summary: no author chips, search or snoozes. Each open PR
 * appears once, in its standupGroup. Pure: today, the clock and the period come
 * from the caller.
 */
import { Attention, AttentionReason, PrRow, ResolvedPeriod, StandupCounts, SweepResult } from '../../shared/types';
import { standupGroup } from './attention';
import { rangeLabel } from './sprints';
import { mergedOn, sinceOf, summarize } from './summary';

/** The board's reason labels, lower-cased to sit mid-line. The renderer keeps its own copy. */
const REASONS: Record<AttentionReason, string> = {
  CI_FAILING: 'CI failing',
  MERGE_CONFLICT: 'merge conflict',
  CHANGES_NOT_ADDRESSED: 'changes not addressed',
  NEEDS_RE_REVIEW: 'needs re-review',
  APPROVED_NOT_MERGED: 'approved, not merged',
  NO_REVIEWERS: 'no reviewers',
  WAITING_FOR_REVIEW: 'waiting for review',
  STALE: 'stale',
  DRAFT_TOO_LONG: 'old draft',
};

export interface Standup {
  text: string;
  html: string;
  counts: StandupCounts;
}

interface Section {
  heading: string;
  rows: PrRow[];
  /** What a row adds after its title, before the author: a reason and its age, or a status. */
  detail: (row: PrRow) => string;
  /** Said instead of an empty list; sections without one are left out when empty. */
  empty?: string;
}

export function buildStandup(
  result: SweepResult,
  ctx: { now: number; today: string; period: ResolvedPeriod },
): Standup {
  const summary = summarize(result, { today: ctx.today });
  const year = Number(ctx.today.slice(0, 4));
  const sprint = ctx.period.kind === 'sprint' ? ctx.period.sprint : null;
  const { since, sinceStart } = sinceOf(result.range, ctx.today);
  const group = (g: string): PrRow[] => result.open.filter((r) => standupGroup(r) === g);
  const reason = (a: Attention): string => (a.since ? `${REASONS[a.reason]} ${age(a.since, ctx.now)}` : REASONS[a.reason]);

  const merged = result.merged.filter((r) => mergedOn(r) >= since).sort(byNewest((r) => r.mergedAt ?? r.updatedAt));
  const blocked = group('blocked').sort(bySeverityThenAge);
  const attention = group('attention').sort(bySeverityThenAge);
  const review = group('review').sort(byNewest((r) => r.updatedAt));
  const all: Section[] = [
    {
      heading: sinceStart && sprint ? 'Merged this sprint' : `Merged since ${summary.sinceLabel}`,
      rows: merged,
      detail: () => '',
      empty: 'Nothing yet.',
    },
    { heading: 'Blocked', rows: blocked, detail: (r) => reason(r.attention[0]) },
    { heading: 'Needs attention', rows: attention, detail: (r) => reason(r.attention[0]) },
    {
      heading: 'In review',
      rows: review,
      // Quiet rows still say what they're waiting on; the rest say where review stands.
      detail: (r) =>
        r.attention[0]
          ? reason(r.attention[0])
          : r.bucket === 'approved'
            ? 'approved'
            : r.bucket === 'changes-requested'
              ? 'changes requested'
              : '',
    },
  ];
  const sections = all.filter((s) => s.rows.length > 0 || s.empty);

  const title = sprint ? `${sprint.name} standup` : 'Standup';
  const subtitle = [daysLeft(summary.daysLeft, summary.when), rangeLabel(result.range, year)].filter(Boolean).join(' · ');
  const tail = (s: Section, r: PrRow): string[] => [s.detail(r), r.author].filter(Boolean);

  const text = [
    `**${md(title)}** · ${md(subtitle)}`,
    ...sections.map((s) =>
      [
        `**${md(s.heading)} (${s.rows.length})**`,
        ...(s.rows.length
          ? s.rows.map((r) => [`- [${ref(r)}](<${r.url}>) ${md(r.title)}`, ...tail(s, r).map(md)].join(' · '))
          : [md(s.empty ?? '')]),
      ].join('\n'),
    ),
  ].join('\n\n');

  // Teams runs paragraphs together but spaces out lists, so a <br> keeps a gap
  // after the title, and after a section that ends in a paragraph.
  const blocks = sections.map((s) => {
    const heading = `<p><b>${esc(s.heading)} (${s.rows.length})</b></p>`;
    if (!s.rows.length) return `${heading}<p>${esc(s.empty ?? '')}</p><br>`;
    const items = s.rows.map(
      (r) => `<li><a href="${esc(r.url)}">${esc(ref(r))}</a> ${[esc(r.title), ...tail(s, r).map(esc)].join(' · ')}</li>`,
    );
    return `${heading}<ul>${items.join('')}</ul>`;
  });
  const html = `<p><b>${esc(title)}</b> · ${esc(subtitle)}</p><br>${blocks.join('')}`.replace(/<br>$/, '');

  return {
    text,
    html: `<meta charset="utf-8">${html.replace(/[^\x00-\x7f]/g, (c) => `&#${c.codePointAt(0)};`)}`,
    counts: { merged: merged.length, blocked: blocked.length, attention: attention.length, review: review.length },
  };
}

function daysLeft(days: number | null, when: 'before' | 'during' | 'after'): string {
  if (days === null || when !== 'during') return '';
  return days === 0 ? 'Ends today' : days === 1 ? '1 day left' : `${days} days left`;
}

const ref = (r: PrRow): string => `${r.repo}#${r.number}`;

/** Backslash-escapes what Markdown (CommonMark, and Discord's) would read as formatting. */
const md = (s: string): string => s.replace(/([\\`*_[\]<>&#|~])/g, '\\$1');

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "12m", "5h", "3d": how long a reason has held, as the board shows it. */
function age(since: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(since)) / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function bySeverityThenAge(a: PrRow, b: PrRow): number {
  const [x, y] = [a.attention[0], b.attention[0]];
  return x.severity - y.severity || (x.since ?? a.updatedAt).localeCompare(y.since ?? b.updatedAt);
}

function byNewest(key: (r: PrRow) => string): (a: PrRow, b: PrRow) => number {
  return (a, b) => key(b).localeCompare(key(a));
}
