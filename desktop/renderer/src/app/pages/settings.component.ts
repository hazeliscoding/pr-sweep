import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { BoardStore } from '../board.store';
import { SprintPreview, SprintSchedule } from '../models';
import { IconComponent } from '../ui/icon.component';

/** What a new schedule starts from before anyone edits it. */
function newSchedule(): SprintSchedule {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { pattern: 'Sprint {n}', first: { number: 1, start: today }, lengthDays: 14, lengths: {}, names: {} };
}

/** Whole days within the range config.service accepts, or null. A schedule outside it is dropped on save. */
function sprintDays(value: string): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 60 ? n : null;
}

/**
 * Settings. Org, team members, stale threshold and sprints belong to the
 * active profile (the board's "what am I looking at"); notifications, tray,
 * refresh and OAuth are machine-wide. The Profiles card switches, renames,
 * adds, removes and shares (export/import) profiles.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="settings">
      <section class="q-card" aria-labelledby="profiles-title">
        <header class="q-card__head">
          <h2 id="profiles-title" class="q-card__title">Profiles</h2>
          <p class="q-card__desc">A profile is a saved org, team and period. Switch between them from the top bar.</p>
        </header>
        <div class="q-table-wrap">
          <table class="q-table" data-density="compact">
            <thead>
              <tr>
                <th scope="col" class="col-title">Name</th>
                <th scope="col">Org</th>
                <th scope="col" class="col-actions"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (p of store.profiles(); track p.id) {
                <tr>
                  <td class="col-title">
                    @if (editingId() === p.id) {
                      <input
                        class="q-input q-input--sm rename-input"
                        aria-label="Profile name"
                        [value]="editingName()"
                        (input)="editingName.set($any($event.target).value)"
                        (keydown.enter)="commitRename(p.id)"
                        (keydown.escape)="cancelRename()"
                        (blur)="commitRename(p.id)"
                      />
                    } @else {
                      <span class="title-cell">
                        {{ p.name }}
                        @if (p.id === store.activeProfile()?.id) {
                          <span class="q-tag q-tag--accent">active</span>
                        }
                      </span>
                    }
                  </td>
                  <td class="mono">{{ p.org || '–' }}</td>
                  <td class="col-actions">
                    <span class="row-actions">
                      @if (p.id !== store.activeProfile()?.id) {
                        <button class="q-btn q-btn--sm" [attr.aria-label]="'Use ' + p.name" (click)="store.switchProfile(p.id)">
                          Use
                        </button>
                      }
                      <button
                        class="q-btn q-btn--ghost q-btn--sm"
                        [attr.aria-label]="'Rename ' + p.name"
                        (click)="startRename(p.id, p.name)"
                      >
                        Rename
                      </button>
                      @if (store.profiles().length > 1) {
                        <button
                          class="q-btn q-btn--danger q-btn--sm"
                          [attr.aria-label]="'Remove ' + p.name"
                          (click)="store.deleteProfile(p.id)"
                        >
                          Remove
                        </button>
                      }
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="q-card__foot">
          <input
            class="q-input"
            placeholder="New profile name"
            aria-label="New profile name"
            [value]="newProfile()"
            (input)="newProfile.set($any($event.target).value)"
            (keydown.enter)="addProfile()"
          />
          <button class="q-btn" (click)="addProfile()">
            <q-icon name="plus" />
            Add profile
          </button>
          <span class="spacer"></span>
          <button class="q-btn q-btn--ghost" (click)="store.exportProfiles()">
            <q-icon name="download" />
            Export…
          </button>
          <button class="q-btn q-btn--ghost" (click)="store.importProfiles()">
            <q-icon name="upload" />
            Import…
          </button>
        </div>
      </section>

      <section class="q-card" aria-labelledby="profile-title">
        <header class="q-card__head">
          <h2 id="profile-title" class="q-card__title">
            Active profile <span class="q-card__meta">{{ store.activeProfile()?.name }}</span>
          </h2>
        </header>
        <div class="q-field">
          <label class="q-field__label" for="profile-org">GitHub organization</label>
          <input
            id="profile-org"
            class="q-input q-input--mono"
            [value]="store.activeProfile()?.org ?? ''"
            (change)="store.patchProfile({ org: $any($event.target).value.trim() })"
          />
        </div>
        <div class="q-field">
          <span class="q-field__label" id="members-label">Team members</span>
          <span class="q-field__hint">The board shows PRs by these logins. Leave it empty to see the whole org.</span>
          @if ((store.activeProfile()?.authors ?? []).length > 0) {
            <ul class="author-tags" aria-labelledby="members-label">
              @for (login of store.activeProfile()?.authors ?? []; track login) {
                <li class="q-tag q-tag--mono">
                  {{ login }}
                  <button class="q-tag__x" [attr.aria-label]="'Remove ' + login" (click)="removeAuthor(login)">
                    <q-icon name="x" [size]="12" />
                  </button>
                </li>
              }
            </ul>
          }
          <div class="inline-row">
            <input
              class="q-input q-input--mono"
              placeholder="github-login"
              aria-label="GitHub login to add"
              [value]="newAuthor()"
              (input)="newAuthor.set($any($event.target).value)"
              (keydown.enter)="addAuthor()"
            />
            <button class="q-btn" (click)="addAuthor()">
              <q-icon name="plus" />
              Add
            </button>
          </div>
        </div>
        <div class="q-field">
          <label class="q-field__label" for="profile-stale">Flag open PRs as stale after</label>
          <span class="with-unit">
            <input
              id="profile-stale"
              class="q-input q-input--mono q-input--num"
              type="number"
              min="0"
              [value]="store.activeProfile()?.staleDays ?? 5"
              (change)="store.setStaleDays(+$any($event.target).value)"
            />
            days
          </span>
          <span class="q-field__hint">
            0 turns it off. The Sweep uses it too, for PRs waiting on review, stale PRs and old drafts.
          </span>
        </div>
      </section>

      <section class="q-card" id="sprints" aria-labelledby="sprints-title">
        <header class="q-card__head">
          <h2 id="sprints-title" class="q-card__title">Sprints</h2>
          <p class="q-card__desc">
            Set when the first sprint starts and how long sprints run, and the board opens on the current one.
            Every sprint is worked out from these, so there's no list to keep up to date.
          </p>
        </header>
        <div class="field-grid">
          <div class="q-field">
            <label class="q-field__label" for="sprint-pattern">Name pattern</label>
            <input
              id="sprint-pattern"
              class="q-input"
              [value]="shown().pattern"
              (change)="setPattern($any($event.target))"
            />
            <span class="q-field__hint"><code>{{ '{n}' }}</code> becomes the sprint number.</span>
          </div>
          <div class="q-field">
            <label class="q-field__label" for="sprint-length">Length</label>
            <span class="with-unit">
              <input
                id="sprint-length"
                class="q-input q-input--mono q-input--num"
                type="number"
                min="1"
                max="60"
                [value]="shown().lengthDays"
                (change)="setLength($any($event.target))"
              />
              days
            </span>
          </div>
          <div class="q-field">
            <label class="q-field__label" for="sprint-first">First sprint number</label>
            <input
              id="sprint-first"
              class="q-input q-input--mono q-input--num"
              type="number"
              min="0"
              [value]="shown().first.number"
              (change)="setFirstNumber($any($event.target))"
            />
          </div>
          <div class="q-field">
            <label class="q-field__label" for="sprint-start">First sprint starts</label>
            <input
              id="sprint-start"
              class="q-input q-input--mono"
              type="date"
              [value]="shown().first.start"
              (change)="setFirstStart($any($event.target))"
            />
          </div>
        </div>

        @if (preview(); as p) {
          <h3 class="q-card__subtitle">{{ schedule() ? 'Around today' : 'Preview' }}</h3>
          @if (schedule()) {
            <p class="q-field__hint preview-hint">Rename a sprint or change its length here. Later sprints move to follow.</p>
          }
          <div class="q-table-wrap">
            <table class="q-table" data-density="compact">
              <thead>
                <tr>
                  <th scope="col" class="col-title">Sprint</th>
                  <th scope="col">Dates</th>
                  <th scope="col" class="num">Days</th>
                </tr>
              </thead>
              <tbody>
                @for (s of p.sprints; track s.number) {
                  <tr>
                    <td class="col-title">
                      <span class="title-cell">
                        @if (schedule()) {
                          <input
                            class="q-input q-input--inline"
                            [value]="s.name"
                            [attr.aria-label]="'Name of sprint ' + s.number"
                            (change)="renameSprint(s.number, $any($event.target))"
                          />
                        } @else {
                          {{ s.name }}
                        }
                        @if (s.number === p.current) {
                          <span class="q-tag q-tag--accent">current</span>
                        }
                      </span>
                    </td>
                    <td class="mono">{{ s.dates }}</td>
                    <td class="num">
                      @if (schedule()) {
                        <input
                          class="q-input q-input--inline q-input--mono q-input--num"
                          type="number"
                          min="1"
                          max="60"
                          [value]="s.days"
                          [attr.aria-label]="'Days in ' + s.name"
                          (change)="setSprintLength(s.number, $any($event.target))"
                        />
                      } @else {
                        <span class="mono">{{ s.days }}</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <div class="q-card__foot">
          @if (schedule()) {
            <button class="q-btn q-btn--danger" (click)="store.setSchedule(null)">
              <q-icon name="trash-2" />
              Clear schedule
            </button>
            <span class="q-field__hint">The board goes back to a custom date range.</span>
          } @else {
            <button class="q-btn q-btn--primary" (click)="store.setSchedule(pending())">
              <q-icon name="calendar" />
              Use this schedule
            </button>
          }
        </div>
      </section>

      <section class="q-card" aria-labelledby="github-title">
        <header class="q-card__head">
          <h2 id="github-title" class="q-card__title">GitHub</h2>
        </header>
        @if (store.auth(); as auth) {
          <p class="connection">
            @if (auth.login) {
              <span class="q-dot q-dot--healthy" aria-hidden="true"></span>
              Connected as <strong class="mono">{{ auth.login }}</strong>
              <button class="q-btn q-btn--ghost q-btn--sm" (click)="store.clearToken()">Disconnect</button>
            } @else {
              <span class="q-dot q-dot--warning" aria-hidden="true"></span>
              Not connected
            }
          </p>
        }
        <div class="q-field">
          <label class="q-field__label" for="oauth-client">OAuth App client ID</label>
          <input
            id="oauth-client"
            class="q-input q-input--mono"
            placeholder="Ov23… or Iv1.…"
            [value]="store.config()?.oauthClientId ?? ''"
            (change)="store.patchConfig({ oauthClientId: $any($event.target).value.trim() })"
          />
          <span class="q-field__hint">Optional. Turns on "Sign in with GitHub".</span>
        </div>
      </section>

      <section class="q-card" aria-labelledby="app-title">
        <header class="q-card__head">
          <h2 id="app-title" class="q-card__title">App</h2>
          <p class="q-card__desc">These apply to every profile on this machine.</p>
        </header>
        <div class="q-field">
          <label class="q-field__label" for="app-refresh">Refresh automatically every</label>
          <span class="with-unit">
            <input
              id="app-refresh"
              class="q-input q-input--mono q-input--num"
              type="number"
              min="0"
              [value]="store.config()?.autoRefreshMinutes ?? 5"
              (change)="store.patchConfig({ autoRefreshMinutes: +$any($event.target).value })"
            />
            minutes
          </span>
          <span class="q-field__hint">0 turns it off.</span>
        </div>
        <label class="q-switch">
          <input
            type="checkbox"
            role="switch"
            [checked]="store.config()?.notifications ?? true"
            (change)="store.patchConfig({ notifications: $any($event.target).checked })"
          />
          <span class="q-switch__track" aria-hidden="true"></span>
          Notify me when a PR lands in my review queue
        </label>
        <label class="q-switch">
          <input
            type="checkbox"
            role="switch"
            [checked]="store.config()?.closeToTray ?? true"
            (change)="store.patchConfig({ closeToTray: $any($event.target).checked })"
          />
          <span class="q-switch__track" aria-hidden="true"></span>
          Keep running in the tray when I close the window
        </label>
      </section>
    </div>
  `,
})
export class SettingsComponent {
  readonly store = inject(BoardStore);
  readonly newAuthor = signal('');
  readonly newProfile = signal('');
  readonly editingId = signal<string | null>(null);
  readonly editingName = signal('');

  /** The saved schedule, or null. */
  readonly schedule = computed(() => this.store.activeProfile()?.sprints ?? null);
  /** A schedule being set up, before "Use this schedule" saves it. */
  readonly pending = signal<SprintSchedule>(newSchedule());
  /** What the Sprints fields and preview show: the saved schedule, else the one being set up. */
  readonly shown = computed(() => this.schedule() ?? this.pending());
  readonly preview = signal<SprintPreview | null>(null);

  constructor() {
    // Main works out the sprints; a slower answer for an older edit is dropped.
    let asked = 0;
    effect(() => {
      const schedule = this.shown();
      const ask = ++asked;
      void this.store.previewSprints(schedule).then((p) => {
        if (ask === asked) this.preview.set(p);
      });
    });
    // "Set up sprints" in the top bar links here. The page scrolls in .main,
    // not the window, so the router's own anchor scrolling can't reach it.
    inject(ActivatedRoute)
      .fragment.pipe(takeUntilDestroyed())
      .subscribe((fragment) => {
        if (fragment === 'sprints') setTimeout(() => this.showSprints());
      });
  }

  addAuthor(): void {
    const login = this.newAuthor().trim();
    const authors = this.store.activeProfile()?.authors ?? [];
    if (!login || authors.includes(login)) return;
    this.store.patchProfile({ authors: [...authors, login] });
    this.newAuthor.set('');
  }

  removeAuthor(login: string): void {
    const authors = (this.store.activeProfile()?.authors ?? []).filter((a) => a !== login);
    this.store.patchProfile({ authors });
  }

  addProfile(): void {
    if (!this.newProfile().trim()) return;
    void this.store.addProfile(this.newProfile().trim());
    this.newProfile.set('');
  }

  startRename(id: string, current: string): void {
    this.editingName.set(current);
    this.editingId.set(id);
    // Focus the freshly-rendered input so blur/Enter behave as expected.
    setTimeout(() => document.querySelector<HTMLInputElement>('.rename-input')?.focus(), 0);
  }

  commitRename(id: string): void {
    if (this.editingId() !== id) return; // already committed/cancelled
    const name = this.editingName().trim();
    if (name) this.store.renameProfile(id, name);
    this.editingId.set(null);
  }

  cancelRename(): void {
    this.editingId.set(null);
  }

  setPattern(input: HTMLInputElement): void {
    const pattern = input.value.trim();
    if (!pattern) return this.revert(input, this.shown().pattern);
    this.editSchedule({ pattern });
  }

  setLength(input: HTMLInputElement): void {
    const days = sprintDays(input.value);
    if (days === null) return this.revert(input, this.shown().lengthDays);
    this.editSchedule({ lengthDays: days });
  }

  setFirstNumber(input: HTMLInputElement): void {
    const n = Math.round(Number(input.value));
    if (!Number.isFinite(n) || n < 0) return this.revert(input, this.shown().first.number);
    this.editSchedule({ first: { ...this.shown().first, number: n } });
  }

  setFirstStart(input: HTMLInputElement): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return this.revert(input, this.shown().first.start);
    this.editSchedule({ first: { ...this.shown().first, start: input.value } });
  }

  /** A one-off name; clearing it, or typing the pattern's own name, drops the override. */
  renameSprint(n: number, input: HTMLInputElement): void {
    const s = this.shown();
    const names = { ...s.names };
    const name = input.value.trim();
    const usual = s.pattern.replace('{n}', String(n));
    if (!name || name === usual) delete names[n];
    else names[n] = name;
    // An emptied field shows the usual name again, even when nothing changed.
    input.value = name || usual;
    this.editSchedule({ names });
  }

  /** A one-off length; the usual length drops the override. */
  setSprintLength(n: number, input: HTMLInputElement): void {
    const s = this.shown();
    const days = sprintDays(input.value);
    if (days === null) return this.revert(input, s.lengths[n] ?? s.lengthDays);
    const lengths = { ...s.lengths };
    if (days === s.lengthDays) delete lengths[n];
    else lengths[n] = days;
    this.editSchedule({ lengths });
  }

  /** A saved schedule saves on every edit; one being set up waits for "Use this schedule". */
  private editSchedule(patch: Partial<SprintSchedule>): void {
    const saved = this.schedule();
    if (saved) this.store.setSchedule({ ...saved, ...patch });
    else this.pending.update((s) => ({ ...s, ...patch }));
  }

  private revert(input: HTMLInputElement, value: string | number): void {
    input.value = String(value);
  }

  private showSprints(): void {
    document.getElementById('sprints')?.scrollIntoView({ block: 'start' });
    document.getElementById('sprint-pattern')?.focus({ preventScroll: true });
  }
}
