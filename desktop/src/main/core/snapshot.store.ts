/**
 * Caches the last sweep result to disk so the next launch paints the board
 * instantly with slightly-stale data while the live refresh runs behind it.
 * Purely a cache: failures to read or write are never worth surfacing.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { SWEEP_SCHEMA, SweepResult } from '../../shared/types';

export class SnapshotStore {
  constructor(private readonly file: string) {}

  /** The cached sweep, or null when there is none or it's from an older schema. */
  get(): SweepResult | null {
    if (!existsSync(this.file)) return null;
    try {
      const snapshot = JSON.parse(readFileSync(this.file, 'utf8'));
      return snapshot?.schema === SWEEP_SCHEMA ? snapshot : null;
    } catch {
      return null;
    }
  }

  set(result: SweepResult): void {
    try {
      writeFileSync(this.file, JSON.stringify(result));
    } catch {
      /* cache only */
    }
  }
}
