/**
 * Persists team config (org, authors, date range, refresh cadence) as JSON in
 * the Electron userData folder. Plain class — no Electron imports — so it
 * stays testable; main.ts supplies the file path.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { DateRange, SweepConfig, SweepConfigPatch } from '../../shared/types';

/**
 * First-run defaults are intentionally generic: no org, no authors (empty
 * means "everyone in the org"), and an open-ended window starting 30 days ago.
 */
export function defaultConfig(): SweepConfig {
  const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  return {
    org: '',
    authors: [],
    range: { start, end: null },
    autoRefreshMinutes: 5,
    includeDrafts: false,
    staleDays: 5,
    notifications: true,
    closeToTray: true,
    oauthClientId: '',
  };
}

export class ConfigService {
  constructor(private readonly file: string) {}

  get(): SweepConfig {
    if (!existsSync(this.file)) return defaultConfig();
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8'));
      const base = defaultConfig();
      return {
        org: stored.org ?? base.org,
        authors: stored.authors ?? base.authors,
        range: normalizeRange(stored) ?? base.range,
        autoRefreshMinutes: stored.autoRefreshMinutes ?? base.autoRefreshMinutes,
        includeDrafts: stored.includeDrafts ?? base.includeDrafts,
        staleDays: stored.staleDays ?? base.staleDays,
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
    writeFileSync(this.file, JSON.stringify(merged, null, 2));
    return merged;
  }
}

/**
 * Accepts the stored range, or migrates a config written by the old
 * sprint-based model (a `sprints` array) into the sprint covering today —
 * falling back to the most recent one.
 */
function normalizeRange(stored: {
  range?: { start?: string; end?: string | null };
  sprints?: Array<{ start?: string; end?: string }>;
}): DateRange | null {
  if (stored.range?.start) return { start: stored.range.start, end: stored.range.end ?? null };
  const sprints = (stored.sprints ?? []).filter((s) => s.start && s.end);
  if (!sprints.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const current =
    sprints.find((s) => s.start! <= today && today <= s.end!) ?? sprints[sprints.length - 1];
  return { start: current.start!, end: current.end! };
}
