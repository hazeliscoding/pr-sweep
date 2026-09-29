/**
 * Persists config as JSON in the Electron userData folder. Config is a set of
 * board "profiles" (org + team + window) plus machine-level preferences. Plain
 * class — no Electron imports — so it stays testable; main.ts supplies the path.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { DateRange, Period, Profile, SprintSchedule, SweepConfig, SweepConfigPatch } from '../../shared/types';

function rollingStart(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
}

function defaultProfile(): Profile {
  return {
    id: 'default',
    name: 'Default',
    org: '',
    authors: [],
    range: { start: rollingStart(), end: null },
    includeDrafts: false,
    staleDays: 5,
    sprints: null,
    period: 'custom',
  };
}

export function defaultConfig(): SweepConfig {
  return {
    profiles: [defaultProfile()],
    activeProfileId: 'default',
    autoRefreshMinutes: 5,
    notifications: true,
    closeToTray: true,
    oauthClientId: '',
  };
}

/** The selected profile, falling back to the first (config never has zero). */
export function activeProfile(config: SweepConfig): Profile {
  return config.profiles.find((p) => p.id === config.activeProfileId) ?? config.profiles[0];
}

export class ConfigService {
  constructor(private readonly file: string) {}

  get(): SweepConfig {
    if (!existsSync(this.file)) return defaultConfig();
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8'));
      const base = defaultConfig();
      const profiles = readProfiles(stored);
      const activeProfileId = profiles.some((p) => p.id === stored.activeProfileId)
        ? stored.activeProfileId
        : profiles[0].id;
      return {
        profiles,
        activeProfileId,
        autoRefreshMinutes: stored.autoRefreshMinutes ?? base.autoRefreshMinutes,
        notifications: stored.notifications ?? base.notifications,
        closeToTray: stored.closeToTray ?? base.closeToTray,
        oauthClientId: stored.oauthClientId ?? base.oauthClientId,
      };
    } catch {
      return defaultConfig();
    }
  }

  set(patch: SweepConfigPatch): SweepConfig {
    const merged = { ...this.get(), ...patch };
    // Never let a write leave zero profiles or a dangling active id.
    if (!merged.profiles?.length) merged.profiles = [defaultProfile()];
    if (!merged.profiles.some((p) => p.id === merged.activeProfileId)) {
      merged.activeProfileId = merged.profiles[0].id;
    }
    writeFileSync(this.file, JSON.stringify(merged, null, 2));
    return merged;
  }
}

/** Read stored profiles, or migrate a pre-v0.7 flat config into one profile. */
function readProfiles(stored: Record<string, unknown>): Profile[] {
  const raw = stored['profiles'];
  if (Array.isArray(raw) && raw.length) return raw.map((p) => normalizeProfile(p));
  // Migration: wrap the old flat fields (org/authors/range/…) as "Default".
  return [
    normalizeProfile({
      id: 'default',
      name: 'Default',
      org: stored['org'],
      authors: stored['authors'],
      range: migrateRange(stored),
      includeDrafts: stored['includeDrafts'],
      staleDays: stored['staleDays'],
    }),
  ];
}

function normalizeProfile(p: Record<string, unknown>): Profile {
  const d = defaultProfile();
  const range = (p['range'] as DateRange | undefined) ?? d.range;
  return {
    id: typeof p['id'] === 'string' && p['id'] ? (p['id'] as string) : d.id,
    name: typeof p['name'] === 'string' && p['name'] ? (p['name'] as string) : d.name,
    org: (p['org'] as string) ?? d.org,
    authors: Array.isArray(p['authors']) ? (p['authors'] as string[]) : d.authors,
    range: { start: range.start || d.range.start, end: range.end ?? null },
    includeDrafts: (p['includeDrafts'] as boolean) ?? d.includeDrafts,
    staleDays: (p['staleDays'] as number) ?? d.staleDays,
    // Profiles from before v0.12 have neither: no schedule, their own range.
    sprints: normalizeSprints(p['sprints']),
    period: normalizePeriod(p['period']),
  };
}

/** A schedule that can be computed from, or null. A broken one is dropped, never guessed at. */
export function normalizeSprints(v: unknown): SprintSchedule | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const first = (s['first'] ?? {}) as Record<string, unknown>;
  const days = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 60;
  if (typeof first['start'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(first['start'])) return null;
  if (!Number.isInteger(first['number']) || (first['number'] as number) < 0) return null;
  if (!days(s['lengthDays'])) return null;
  const byNumber = <T>(m: unknown, ok: (x: unknown) => x is T): Record<number, T> =>
    Object.fromEntries(Object.entries((m ?? {}) as Record<string, unknown>).filter(([k, x]) => /^\d+$/.test(k) && ok(x))) as Record<number, T>;
  const pattern = typeof s['pattern'] === 'string' && s['pattern'].trim() ? s['pattern'] : 'Sprint {n}';
  return {
    pattern,
    first: { number: first['number'] as number, start: first['start'] },
    lengthDays: s['lengthDays'] as number,
    lengths: byNumber(s['lengths'], days),
    names: byNumber(s['names'], (x): x is string => typeof x === 'string' && x.trim() !== ''),
  };
}

function normalizePeriod(v: unknown): Period {
  if (v === 'current' || v === 'custom') return v;
  const sprint = (v as { sprint?: unknown } | null)?.sprint;
  return Number.isInteger(sprint) ? { sprint: sprint as number } : 'custom';
}

/** Accepts a v0.6 flat range, or a pre-v0.6 sprint list covering today. */
function migrateRange(stored: Record<string, unknown>): DateRange | undefined {
  const range = stored['range'] as DateRange | undefined;
  if (range?.start) return range;
  const sprints = (stored['sprints'] as Array<{ start?: string; end?: string }> | undefined) ?? [];
  const valid = sprints.filter((s) => s.start && s.end);
  if (!valid.length) return undefined;
  const today = new Date().toISOString().slice(0, 10);
  const cur = valid.find((s) => s.start! <= today && today <= s.end!) ?? valid[valid.length - 1];
  return { start: cur.start!, end: cur.end! };
}
