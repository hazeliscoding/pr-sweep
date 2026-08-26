import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BoardStore } from '../board.store';
import { Sprint } from '../models';

/**
 * Settings: org, tracked authors, sprint windows, refresh cadence, and the
 * stored token. "Add next sprint" prefills from the last sprint's cadence so
 * rollover is one click instead of date arithmetic.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="settings">
      <section>
        <h2>GitHub</h2>
        <label class="field">
          Organization
          <input [value]="store.config()?.org ?? ''" (change)="store.patchConfig({ org: $any($event.target).value.trim() })" />
        </label>
        @if (store.auth(); as auth) {
          <p class="muted">
            @if (auth.login) {
              Connected as <strong>{{ auth.login }}</strong> ·
              <a href="#" (click)="disconnect($event)">disconnect</a>
            } @else {
              Not connected.
            }
          </p>
        }
      </section>

      <section>
        <h2>Team members</h2>
        <p class="muted">PRs authored by these GitHub logins show on the board.</p>
        <ul class="tag-list">
          @for (login of store.config()?.authors ?? []; track login) {
            <li>
              {{ login }}
              <button class="tag-x" (click)="removeAuthor(login)" aria-label="Remove">×</button>
            </li>
          }
        </ul>
        <div class="add-row">
          <input placeholder="github-login" [value]="newAuthor()" (input)="newAuthor.set($any($event.target).value)" (keydown.enter)="addAuthor()" />
          <button (click)="addAuthor()">Add</button>
        </div>
      </section>

      <section>
        <h2>Sprints</h2>
        <table class="sprint-table">
          <thead>
            <tr><th>Name</th><th>Start</th><th>End</th><th></th></tr>
          </thead>
          <tbody>
            @for (s of store.config()?.sprints ?? []; track s.id) {
              <tr>
                <td>{{ s.name }}</td>
                <td>{{ s.start }}</td>
                <td>{{ s.end }}</td>
                <td><button class="tag-x" (click)="removeSprint(s.id)" aria-label="Remove">×</button></td>
              </tr>
            }
          </tbody>
        </table>
        <div class="add-row">
          <input placeholder="Name" [value]="draft().name" (input)="patchDraft({ name: $any($event.target).value })" />
          <input type="date" [value]="draft().start" (input)="patchDraft({ start: $any($event.target).value })" />
          <input type="date" [value]="draft().end" (input)="patchDraft({ end: $any($event.target).value })" />
          <button (click)="addSprint()">Add</button>
          <button (click)="suggestNext()">Suggest next</button>
        </div>
      </section>

      <section>
        <h2>Refresh</h2>
        <label class="field">
          Auto-refresh every (minutes, 0 = off)
          <input
            type="number"
            min="0"
            [value]="store.config()?.autoRefreshMinutes ?? 5"
            (change)="store.patchConfig({ autoRefreshMinutes: +$any($event.target).value })"
          />
        </label>
      </section>
    </div>
  `,
})
export class SettingsComponent {
  readonly store = inject(BoardStore);
  readonly newAuthor = signal('');
  readonly draft = signal<Sprint>({ id: '', name: '', start: '', end: '' });

  patchDraft(patch: Partial<Sprint>): void {
    this.draft.set({ ...this.draft(), ...patch });
  }

  addAuthor(): void {
    const login = this.newAuthor().trim();
    const authors = this.store.config()?.authors ?? [];
    if (!login || authors.includes(login)) return;
    this.store.patchConfig({ authors: [...authors, login] });
    this.newAuthor.set('');
  }

  removeAuthor(login: string): void {
    const authors = (this.store.config()?.authors ?? []).filter((a) => a !== login);
    this.store.patchConfig({ authors });
  }

  addSprint(): void {
    const d = this.draft();
    if (!d.name.trim() || !d.start || !d.end || d.end < d.start) return;
    const sprints = [...(this.store.config()?.sprints ?? []), { ...d, id: d.name.trim() }];
    sprints.sort((a, b) => a.start.localeCompare(b.start));
    this.store.patchConfig({ sprints });
    this.draft.set({ id: '', name: '', start: '', end: '' });
  }

  removeSprint(id: string): void {
    const sprints = (this.store.config()?.sprints ?? []).filter((s) => s.id !== id);
    if (sprints.length) this.store.patchConfig({ sprints });
  }

  /** Next sprint = starts the day after the last one ends, same length, name+1. */
  suggestNext(): void {
    const sprints = this.store.config()?.sprints ?? [];
    const last = sprints[sprints.length - 1];
    if (!last) return;
    const dayMs = 86_400_000;
    const lengthDays = Math.round((Date.parse(last.end) - Date.parse(last.start)) / dayMs);
    const start = new Date(Date.parse(last.end) + dayMs);
    const end = new Date(start.getTime() + lengthDays * dayMs);
    const numMatch = last.name.match(/(\d+)\s*$/);
    const name = numMatch
      ? last.name.replace(/\d+\s*$/, String(Number(numMatch[1]) + 1))
      : `${last.name} +1`;
    this.draft.set({
      id: '',
      name,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    });
  }

  disconnect(e: Event): void {
    e.preventDefault();
    void this.store.clearToken();
  }
}
