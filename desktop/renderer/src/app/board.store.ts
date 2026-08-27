import { Injectable, computed, signal } from '@angular/core';
import {
  AuthStatus,
  DateRange,
  PrRow,
  SweepConfig,
  SweepConfigPatch,
  SweepResult,
} from './models';

/**
 * App-wide state: config (org/authors/sprints), auth status, and the latest
 * sweep. The board re-slices the fetched result client-side (author chips,
 * text filter) — network only happens on boot, on Refresh, on sprint change,
 * and on the auto-refresh timer.
 */
@Injectable({ providedIn: 'root' })
export class BoardStore {
  private get api() {
    return window.api;
  }

  readonly config = signal<SweepConfig | null>(null);
  readonly auth = signal<AuthStatus | null>(null);
  readonly result = signal<SweepResult | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Author chips: empty set = everyone. */
  readonly authorFilter = signal<ReadonlySet<string>>(new Set());
  readonly search = signal('');

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  readonly range = computed<DateRange | null>(() => this.config()?.range ?? null);

  /** True until a token is stored and fully working — drives the onboarding overlay. */
  readonly needsToken = computed(() => {
    const auth = this.auth();
    return !!auth && (!auth.login || !!auth.error);
  });

  /**
   * PRs waiting on *my* review — org-wide, so the author chips don't apply;
   * only the free-text filter does.
   */
  readonly queue = computed(() => {
    const q = this.search().trim().toLowerCase();
    return (this.result()?.queue ?? [])
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.repo.toLowerCase().includes(q))
      .sort(byNewest((r) => r.updatedAt));
  });

  readonly needsReview = computed(() => this.slice('needs-review'));
  readonly changesRequested = computed(() => this.slice('changes-requested'));
  readonly approved = computed(() => this.slice('approved'));
  readonly merged = computed(() =>
    this.applyFilters(this.result()?.merged ?? []).sort(byNewest((r) => r.mergedAt ?? r.updatedAt)),
  );

  readonly openCount = computed(
    () => this.needsReview().length + this.changesRequested().length + this.approved().length,
  );

  readonly fetchedAgeMin = computed<number | null>(() => {
    const ts = this.result()?.fetchedAt;
    return ts ? Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 60000)) : null;
  });

  private slice(bucket: PrRow['bucket']): PrRow[] {
    const rows = (this.result()?.open ?? []).filter((r) => r.bucket === bucket);
    return this.applyFilters(rows).sort(byNewest((r) => r.updatedAt));
  }

  private applyFilters(rows: PrRow[]): PrRow[] {
    const authors = this.authorFilter();
    const q = this.search().trim().toLowerCase();
    return rows.filter(
      (r) =>
        (authors.size === 0 || authors.has(r.author)) &&
        (!q || r.title.toLowerCase().includes(q) || r.repo.toLowerCase().includes(q)),
    );
  }

  async init(): Promise<void> {
    try {
      // Config + cached snapshot are local reads — paint the board with them
      // immediately. The auth probe and live sweep (both network) come after,
      // quietly replacing the stale data.
      const [config, snapshot] = await Promise.all([this.api.getConfig(), this.api.latestSweep()]);
      this.config.set(config);
      if (
        snapshot &&
        snapshot.org === config.org &&
        snapshot.range.start === config.range.start &&
        (snapshot.range.end ?? null) === (config.range.end ?? null)
      ) {
        this.result.set(snapshot);
      }
      const auth = await this.api.authStatus();
      this.auth.set(auth);
      if (auth.login) await this.refresh({ auto: true });
      this.armAutoRefresh();
    } catch (e) {
      this.error.set(`Failed to load: ${(e as Error).message}`);
    }
  }

  async refresh(opts: { auto?: boolean } = {}): Promise<void> {
    const range = this.range();
    if (!range?.start || this.loading()) return;
    this.loading.set(true);
    if (!opts.auto) this.error.set(null);
    try {
      this.result.set(await this.api.fetchPrs(range));
      this.error.set(null);
    } catch (e) {
      // A background refresh failing (laptop offline) shouldn't blank a board
      // that's already showing data — surface quietly only for manual actions.
      if (!opts.auto) this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  /** Drafts visibility is part of the search queries, so toggling refetches. */
  toggleDrafts(): void {
    this.patchConfig({ includeDrafts: !this.config()?.includeDrafts });
    void this.refresh();
  }

  /** Persist a range edit and refetch. An empty end means open-ended. */
  setRange(patch: Partial<DateRange>): void {
    const current = this.range() ?? { start: '', end: null };
    const next: DateRange = { ...current, ...patch };
    if (!next.start) return;
    if (next.end && next.end < next.start) next.end = null;
    this.patchConfig({ range: next });
    void this.refresh();
  }

  toggleAuthor(login: string): void {
    const next = new Set(this.authorFilter());
    if (!next.delete(login)) next.add(login);
    this.authorFilter.set(next);
  }

  async saveToken(token: string): Promise<AuthStatus> {
    const status = await this.api.setToken(token);
    this.auth.set(status);
    if (status.login) await this.refresh();
    return status;
  }

  async clearToken(): Promise<void> {
    this.auth.set(await this.api.clearToken());
    this.result.set(null);
  }

  /**
   * Persist the org before token validation runs — the main process reads
   * config from disk, so fire-and-forget here would race authStatus.
   */
  async setOrg(org: string): Promise<void> {
    this.config.set(await this.api.setConfig({ org }));
  }

  /** Instant local update; persistence is fire-and-forget. */
  patchConfig(patch: SweepConfigPatch): void {
    const current = this.config();
    if (!current) return;
    this.config.set({ ...current, ...patch });
    this.api.setConfig(patch).catch(() => void 0);
    if (patch.autoRefreshMinutes !== undefined) this.armAutoRefresh();
  }

  openPr(row: PrRow): void {
    void this.api.openExternal(row.url);
  }

  private armAutoRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    const minutes = this.config()?.autoRefreshMinutes ?? 0;
    if (minutes > 0) {
      this.refreshTimer = setInterval(() => void this.refresh({ auto: true }), minutes * 60_000);
    }
  }
}

function byNewest(key: (r: PrRow) => string): (a: PrRow, b: PrRow) => number {
  return (a, b) => key(b).localeCompare(key(a));
}
