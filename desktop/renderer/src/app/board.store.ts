import { Injectable, computed, signal } from '@angular/core';
import {
  AuthStatus,
  DateRange,
  PrRow,
  Profile,
  ProfilePatch,
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

  readonly profiles = computed<Profile[]>(() => this.config()?.profiles ?? []);

  /** The selected profile (org + team + window), or null before config loads. */
  readonly activeProfile = computed<Profile | null>(() => {
    const cfg = this.config();
    if (!cfg) return null;
    return cfg.profiles.find((p) => p.id === cfg.activeProfileId) ?? cfg.profiles[0] ?? null;
  });

  readonly range = computed<DateRange | null>(() => this.activeProfile()?.range ?? null);

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
      const p = this.activeProfile();
      if (
        snapshot &&
        p &&
        snapshot.org === p.org &&
        snapshot.range.start === p.range.start &&
        (snapshot.range.end ?? null) === (p.range.end ?? null)
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
      // Timer refreshes go incremental (cheap for big orgs); manual ones are
      // always a full resweep so Refresh doubles as the recovery lever.
      const result = await this.api.fetchPrs(range, opts.auto ? 'auto' : 'full');
      this.result.set(result);
      this.error.set(null);
      // Hand the tray its slices: the queue (counts + review-request toasts)
      // and my own open PRs (approval / changes-requested / CI-failure toasts).
      // Both use the raw result, not the filtered view, so background toasts
      // don't depend on whatever author/text filter is active.
      const needsReview = result.open.filter((r) => r.bucket === 'needs-review').length;
      const login = this.auth()?.login;
      const mine = login ? result.open.filter((r) => r.author === login) : [];
      void this.api.syncTray({ queue: result.queue, mine, needsReviewCount: needsReview });
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
    this.patchProfile({ includeDrafts: !this.activeProfile()?.includeDrafts });
    void this.refresh();
  }

  /** Persist a range edit and refetch. An empty end means open-ended. */
  setRange(patch: Partial<DateRange>): void {
    const current = this.range() ?? { start: '', end: null };
    const next: DateRange = { ...current, ...patch };
    if (!next.start) return;
    if (next.end && next.end < next.start) next.end = null;
    this.patchProfile({ range: next });
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

  /** Device-flow sign-in; resolves once GitHub returns a token (or it fails). */
  async startOAuth(): Promise<AuthStatus> {
    const status = await this.api.startOAuth();
    this.auth.set(status);
    if (status.login && !status.error) await this.refresh();
    return status;
  }

  async clearToken(): Promise<void> {
    this.auth.set(await this.api.clearToken());
    this.result.set(null);
  }

  /**
   * Persist the org into the active profile before token validation runs — the
   * main process reads config from disk, so fire-and-forget would race authStatus.
   */
  async setOrg(org: string): Promise<void> {
    const patch = this.withProfilePatch({ org });
    if (patch) this.config.set(await this.api.setConfig(patch));
  }

  /** Update a field on the active profile; instant local update, async persist. */
  patchProfile(patch: ProfilePatch): void {
    const cfg = this.withProfilePatch(patch);
    if (!cfg) return;
    this.config.set(cfg);
    this.api.setConfig({ profiles: cfg.profiles }).catch(() => void 0);
  }

  /** Global (machine) settings — refresh cadence, notifications, tray, oauth. */
  patchConfig(patch: SweepConfigPatch): void {
    const current = this.config();
    if (!current) return;
    this.config.set({ ...current, ...patch });
    this.api.setConfig(patch).catch(() => void 0);
    if (patch.autoRefreshMinutes !== undefined) this.armAutoRefresh();
  }

  /** Build a full config with `patch` applied to the active profile (or null). */
  private withProfilePatch(patch: ProfilePatch): SweepConfig | null {
    const cfg = this.config();
    const active = this.activeProfile();
    if (!cfg || !active) return null;
    const profiles = cfg.profiles.map((p) =>
      p.id === active.id ? { ...p, ...patch, range: { ...p.range, ...(patch.range ?? {}) } } : p,
    );
    return { ...cfg, profiles };
  }

  // ----- profile management -----

  async switchProfile(id: string): Promise<void> {
    const cfg = this.config();
    if (!cfg || id === cfg.activeProfileId) return;
    this.config.set({ ...cfg, activeProfileId: id });
    this.result.set(null);
    void this.api.setConfig({ activeProfileId: id });
    await this.refresh();
  }

  async addProfile(name: string): Promise<void> {
    const cfg = this.config();
    const active = this.activeProfile();
    if (!cfg || !name.trim()) return;
    // Seed from the active profile's org/range so a new team is a quick tweak.
    const profile: Profile = {
      id: `p-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      name: name.trim(),
      org: active?.org ?? '',
      authors: [],
      range: active?.range ?? { start: new Date().toISOString().slice(0, 10), end: null },
      includeDrafts: false,
      staleDays: active?.staleDays ?? 5,
    };
    const next = { ...cfg, profiles: [...cfg.profiles, profile], activeProfileId: profile.id };
    this.config.set(next);
    this.result.set(null);
    await this.api.setConfig({ profiles: next.profiles, activeProfileId: profile.id });
    await this.refresh();
  }

  renameProfile(id: string, name: string): void {
    const cfg = this.config();
    if (!cfg || !name.trim()) return;
    const profiles = cfg.profiles.map((p) => (p.id === id ? { ...p, name: name.trim() } : p));
    this.config.set({ ...cfg, profiles });
    void this.api.setConfig({ profiles });
  }

  async deleteProfile(id: string): Promise<void> {
    const cfg = this.config();
    if (!cfg || cfg.profiles.length <= 1) return; // never delete the last one
    const profiles = cfg.profiles.filter((p) => p.id !== id);
    const activeProfileId = cfg.activeProfileId === id ? profiles[0].id : cfg.activeProfileId;
    const switched = activeProfileId !== cfg.activeProfileId;
    this.config.set({ ...cfg, profiles, activeProfileId });
    if (switched) this.result.set(null);
    await this.api.setConfig({ profiles, activeProfileId });
    if (switched) await this.refresh();
  }

  exportProfiles(): Promise<boolean> {
    return this.api.exportProfiles();
  }

  async importProfiles(): Promise<void> {
    const cfg = await this.api.importProfiles();
    if (!cfg) return; // cancelled
    this.config.set(cfg);
    this.result.set(null);
    await this.refresh();
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
