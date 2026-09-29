/**
 * Fixture mode: a canned sweep for reviewing the UI in every state without
 * GitHub or a token (PRSWEEP_FIXTURE=<name>, unpackaged builds only). Fixture
 * files live in e2e/fixtures/ and write times relative to now ("-3d", "-2h",
 * "+2d"), so ages and dates stay right whenever the screenshots are taken.
 * Rows list only what matters to them; everything else gets a default. Pure:
 * the caller supplies how a fixture name is read.
 */
import { Period, PrRow, ReviewBucket, SprintSchedule, UpdateState } from '../../shared/types';

export interface FixtureProfile {
  org: string;
  authors: string[];
  range: { start: string; end: string | null };
  includeDrafts: boolean;
  staleDays: number;
  /** A schedule's first start may be relative too. */
  sprints: SprintSchedule | null;
  /** Defaults to 'current' when there's a schedule. */
  period: Period;
}

export interface Fixture {
  /** Seeded into config.json by the screenshot script. */
  profile: FixtureProfile;
  /** 'no-token' shows onboarding. */
  auth: 'signed-in' | 'no-token';
  sweep: { open: PrRow[]; merged: PrRow[]; queue: PrRow[] };
  /** Sweeps after this many succeed fail with `error`. */
  failAfter: number | null;
  error: string;
  /** Hold every sweep this long: the loading state. */
  delayMs: number;
  /** Header update states, pushed `afterMs` after the window loads. */
  update: Array<{ afterMs: number; state: UpdateState | null }>;
}

type Json = Record<string, unknown>;

const BUCKETS: ReviewBucket[] = ['needs-review', 'changes-requested', 'approved', 'merged'];
const CI = ['success', 'failure', 'pending', null];
const MERGEABLE = ['mergeable', 'conflicting', 'unknown', null];
const TIME_FIELDS = ['createdAt', 'updatedAt', 'mergedAt', 'lastCommitAt', 'reviewRequestedAt', 'approvedAt', 'changesRequestedAt'] as const;
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

function offsetMs(value: string): number | null {
  const m = /^([+-])(\d+(?:\.\d+)?)([mhd])$/.exec(value);
  return m ? (m[1] === '-' ? -1 : 1) * Number(m[2]) * UNIT_MS[m[3]] : null;
}

/** "-3d" → an ISO timestamp that long before `now`. Absolute timestamps pass through. */
export function relativeTime(value: string, now: number): string {
  const offset = offsetMs(value);
  if (offset !== null) return new Date(now + offset).toISOString();
  if (!Number.isNaN(Date.parse(value))) return value;
  throw new Error(`"${value}" is not a relative time like -3d, -2h or +30m`);
}

/** "+2d" → the local calendar date (yyyy-mm-dd) that far from `now`, like the header's date inputs. */
export function relativeDate(value: string, now: number): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const offset = offsetMs(value);
  if (offset === null) throw new Error(`"${value}" is not a date or a relative date like +2d`);
  const d = new Date(now + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Load fixture `name`, resolving `extends` through `read` (which returns the parsed JSON for a name). */
export function loadFixture(name: string, read: (name: string) => unknown, now: number): Fixture {
  const raw = flatten(name, read, new Set());
  const where = (path: string): string => `${name}: ${path}`;
  const profile = (raw.profile ?? {}) as Json;
  const range = (profile.range ?? {}) as Json;
  if (typeof range.start !== 'string') throw new Error(where('profile.range.start is required'));
  const org = String(profile.org ?? '');
  const sprints = profile.sprints as Json | undefined;
  const first = (sprints?.first ?? {}) as Json;
  const rows = (key: 'open' | 'merged' | 'queue', bucket: ReviewBucket): PrRow[] =>
    ((raw[key] ?? []) as Json[]).map((r, i) => toRow(r, `${key}[${i}]`, org, bucket, now, where));
  return {
    profile: {
      org,
      authors: (profile.authors as string[]) ?? [],
      range: {
        start: relativeDate(range.start, now),
        end: typeof range.end === 'string' ? relativeDate(range.end, now) : null,
      },
      includeDrafts: Boolean(profile.includeDrafts),
      staleDays: typeof profile.staleDays === 'number' ? profile.staleDays : 5,
      sprints: sprints
        ? {
            pattern: String(sprints.pattern ?? 'Sprint {n}'),
            first: { number: Number(first.number), start: relativeDate(String(first.start), now) },
            lengthDays: Number(sprints.lengthDays),
            lengths: (sprints.lengths ?? {}) as Record<number, number>,
            names: (sprints.names ?? {}) as Record<number, string>,
          }
        : null,
      period: (profile.period as Period | undefined) ?? (sprints ? 'current' : 'custom'),
    },
    auth: raw.auth === 'no-token' ? 'no-token' : 'signed-in',
    sweep: { open: rows('open', 'needs-review'), merged: rows('merged', 'merged'), queue: rows('queue', 'needs-review') },
    failAfter: typeof raw.failAfter === 'number' ? raw.failAfter : null,
    error: String(raw.error ?? 'GitHub API error: HTTP 502'),
    delayMs: typeof raw.delayMs === 'number' ? raw.delayMs : 0,
    update: ((raw.update ?? []) as Array<{ afterMs: number; state: UpdateState | null }>).map((u) => ({ ...u })),
  };
}

/** The fixture with its `extends` chain applied: the base first, each extending file's keys on top. */
function flatten(name: string, read: (name: string) => unknown, seen: Set<string>): Json {
  if (seen.has(name)) throw new Error(`${name}: extends itself`);
  seen.add(name);
  const own = read(name) as Json;
  if (typeof own.extends !== 'string') return own;
  const { extends: base, ...rest } = own;
  return { ...flatten(base as string, read, seen), ...rest };
}

function toRow(r: Json, path: string, org: string, fallbackBucket: ReviewBucket, now: number, where: (p: string) => string): PrRow {
  const oneOf = (field: string, allowed: unknown[], fallback: unknown): unknown => {
    const value = field in r ? r[field] : fallback;
    if (!allowed.includes(value)) {
      throw new Error(where(`${path}.${field} ${JSON.stringify(value)} is not one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`));
    }
    return value;
  };
  if (typeof r.repo !== 'string' || typeof r.number !== 'number' || typeof r.title !== 'string') {
    throw new Error(where(`${path} needs repo, number and title`));
  }
  const times: Record<string, string | null> = {};
  for (const field of TIME_FIELDS) {
    const v = r[field];
    times[field] = typeof v === 'string' ? relativeTime(v, now) : null;
  }
  const createdAt = times.createdAt ?? relativeTime('-2h', now);
  const reviewers = (r.requestedReviewers as string[]) ?? [];
  return {
    repo: r.repo,
    number: r.number,
    title: r.title,
    url: `https://github.com/${org}/${r.repo}/pull/${r.number}`,
    isDraft: Boolean(r.isDraft),
    author: String(r.author ?? 'dana'),
    authorAvatarUrl: '',
    bucket: oneOf('bucket', BUCKETS, fallbackBucket) as ReviewBucket,
    createdAt,
    updatedAt: times.updatedAt ?? createdAt,
    mergedAt: times.mergedAt,
    comments: typeof r.comments === 'number' ? r.comments : 0,
    additions: typeof r.additions === 'number' ? r.additions : 24,
    deletions: typeof r.deletions === 'number' ? r.deletions : 6,
    requestedReviewers: reviewers,
    requestCount: typeof r.requestCount === 'number' ? r.requestCount : reviewers.length,
    // Merged rows never carry CI in a real sweep (their search skips it).
    ci: oneOf('ci', CI, fallbackBucket === 'merged' ? null : 'success') as PrRow['ci'],
    lastCommitAt: times.lastCommitAt ?? createdAt,
    reviewRequestedAt: times.reviewRequestedAt,
    mergeable: oneOf('mergeable', MERGEABLE, null) as PrRow['mergeable'],
    approvedAt: times.approvedAt,
    changesRequestedAt: times.changesRequestedAt,
    reviewCount: typeof r.reviewCount === 'number' ? r.reviewCount : null,
    attention: [],
    quiet: false,
  };
}
