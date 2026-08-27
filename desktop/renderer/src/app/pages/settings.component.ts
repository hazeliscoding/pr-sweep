import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BoardStore } from '../board.store';

/**
 * Settings: org, tracked authors, refresh cadence, and the stored token.
 * The board's date range lives in the header, not here — it's the thing
 * people change most, so it stays one click away.
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
        <p class="muted">
          PRs authored by these GitHub logins show on the board. Leave the list empty to see the
          whole organization.
        </p>
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
        <h2>Board</h2>
        <label class="field">
          Auto-refresh every (minutes, 0 = off)
          <input
            type="number"
            min="0"
            [value]="store.config()?.autoRefreshMinutes ?? 5"
            (change)="store.patchConfig({ autoRefreshMinutes: +$any($event.target).value })"
          />
        </label>
        <label class="field">
          Flag open PRs as stale after (days, 0 = off)
          <input
            type="number"
            min="0"
            [value]="store.config()?.staleDays ?? 5"
            (change)="store.patchConfig({ staleDays: +$any($event.target).value })"
          />
        </label>
      </section>
    </div>
  `,
})
export class SettingsComponent {
  readonly store = inject(BoardStore);
  readonly newAuthor = signal('');

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

  disconnect(e: Event): void {
    e.preventDefault();
    void this.store.clearToken();
  }
}
