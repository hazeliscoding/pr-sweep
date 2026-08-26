/**
 * Persists team config (org, authors, sprints, refresh cadence) as JSON in the
 * Electron userData folder. Plain class — no Electron imports — so it stays
 * testable; main.ts supplies the file path.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Sprint, SweepConfig, SweepConfigPatch } from '../../shared/types';

/**
 * First-run defaults are intentionally generic: no org, no authors (empty
 * means "everyone in the org"), and a rolling window standing in for a sprint
 * until real sprint dates are configured in Settings.
 */
export function defaultConfig(): SweepConfig {
  return { org: '', authors: [], sprints: [rollingSprint()], autoRefreshMinutes: 5 };
}

function rollingSprint(): Sprint {
  const day = 86_400_000;
  const now = Date.now();
  return {
    id: 'last-30-days',
    name: 'Last 30 days',
    start: new Date(now - 30 * day).toISOString().slice(0, 10),
    end: new Date(now + 60 * day).toISOString().slice(0, 10),
  };
}

export class ConfigService {
  constructor(private readonly file: string) {}

  get(): SweepConfig {
    if (!existsSync(this.file)) return defaultConfig();
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8'));
      const merged: SweepConfig = { ...defaultConfig(), ...stored };
      // A config edited down to zero sprints would leave the board with nothing
      // to select — fall back to the rolling window.
      if (!merged.sprints?.length) merged.sprints = [rollingSprint()];
      return merged;
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
