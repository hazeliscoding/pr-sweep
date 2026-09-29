/**
 * Sprint schedules: every sprint is computed from a profile's schedule, none is
 * stored, so "Current" rolls over by itself and nobody keeps a list up to date
 * (the reason sprints were removed on 2026-08-27). Dates are local calendar
 * days (yyyy-mm-dd), and a sprint's end is its last day. Pure: "today" comes
 * from the caller.
 */
import { DateRange, PreviewSprint, Profile, ResolvedPeriod, Sprint, SprintPreview, SprintSchedule } from '../../shared/types';

const DAY = 86_400_000;
/** Guards the walks below against a runaway schedule. */
const MAX_SPRINTS = 2000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// yyyy-mm-dd arithmetic through UTC midnights, so DST never shifts a day.
const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const lengthOf = (s: SprintSchedule, n: number): number => s.lengths[n] ?? s.lengthDays;
const nameOf = (s: SprintSchedule, n: number): string => s.names[n] ?? s.pattern.replace('{n}', String(n));

/** Today's local date as yyyy-mm-dd, like the header's date inputs. */
export function localDate(ms: number = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Sprint `n`, or null before the schedule's first sprint. */
export function sprintAt(s: SprintSchedule, n: number): Sprint | null {
  if (!Number.isInteger(n) || n < s.first.number || n - s.first.number > MAX_SPRINTS) return null;
  let start = s.first.start;
  for (let k = s.first.number; k < n; k++) start = addDays(start, lengthOf(s, k));
  return { number: n, name: nameOf(s, n), start, end: addDays(start, lengthOf(s, n) - 1) };
}

/** The sprint whose days include `date`, or null before the schedule starts. */
export function sprintOn(s: SprintSchedule, date: string): Sprint | null {
  if (date < s.first.start) return null;
  let start = s.first.start;
  for (let n = s.first.number; n - s.first.number <= MAX_SPRINTS; n++) {
    const end = addDays(start, lengthOf(s, n) - 1);
    if (date <= end) return { number: n, name: nameOf(s, n), start, end };
    start = addDays(end, 1);
  }
  return null;
}

/**
 * The sprints around today: `before` earlier ones, the current one and `after`
 * later ones, never before the first. Before the schedule starts, its first few.
 */
export function sprintsAround(s: SprintSchedule, today: string, before = 2, after = 3): SprintPreview {
  const current = sprintOn(s, today)?.number ?? null;
  const middle = current ?? s.first.number;
  const year = Number(today.slice(0, 4));
  const sprints: PreviewSprint[] = [];
  for (let n = middle - before; n <= middle + after; n++) {
    const sprint = sprintAt(s, n);
    if (sprint) sprints.push({ ...sprint, dates: span(sprint.start, sprint.end, year), days: lengthOf(s, n) });
  }
  return { sprints, current };
}

/** What the board shows for a profile today: its sprint (current or pinned), or its custom range. */
export function resolvePeriod(profile: Profile, today: string): ResolvedPeriod {
  const s = profile.sprints;
  const year = Number(today.slice(0, 4));
  const current = s ? sprintOn(s, today) : null;
  if (!s || profile.period === 'custom') {
    return {
      kind: 'custom',
      label: rangeLabel(profile.range, year),
      range: profile.range,
      sprint: null,
      isCurrent: false,
      previous: null,
      next: null,
      current,
      hasSchedule: !!s,
    };
  }
  // Before the schedule starts, "Current" shows its first sprint; a pinned
  // sprint that no longer exists (the schedule moved) does the same.
  const pinned = profile.period === 'current' ? current : sprintAt(s, profile.period.sprint);
  const sprint = pinned ?? (sprintAt(s, s.first.number) as Sprint);
  return {
    kind: 'sprint',
    label: `${sprint.name} · ${span(sprint.start, sprint.end, year)}`,
    range: { start: sprint.start, end: sprint.end },
    sprint,
    isCurrent: current?.number === sprint.number,
    previous: sprintAt(s, sprint.number - 1),
    next: sprintAt(s, sprint.number + 1),
    current,
    hasSchedule: true,
  };
}

function parts(date: string): { y: number; m: string; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m: MONTHS[m - 1], d };
}

/** "Sep 14–27", "Sep 28 – Oct 11", with the year when it isn't this one. */
function span(start: string, end: string, thisYear: number): string {
  const a = parts(start);
  const b = parts(end);
  if (a.y !== b.y) return `${a.m} ${a.d}, ${a.y} – ${b.m} ${b.d}, ${b.y}`;
  const year = a.y !== thisYear ? `, ${a.y}` : '';
  return a.m === b.m ? `${a.m} ${a.d}–${b.d}${year}` : `${a.m} ${a.d} – ${b.m} ${b.d}${year}`;
}

function rangeLabel(range: DateRange, thisYear: number): string {
  if (range.end) return span(range.start, range.end, thisYear);
  const a = parts(range.start);
  return `Since ${a.m} ${a.d}${a.y !== thisYear ? `, ${a.y}` : ''}`;
}
