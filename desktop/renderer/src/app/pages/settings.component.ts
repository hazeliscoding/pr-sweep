import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BoardStore } from '../board.store';

/**
 * Settings. Org / team members / stale threshold belong to the active profile
 * (the board's "what am I looking at"); notifications / tray / refresh / OAuth
 * are machine-wide. The Profiles section switches, renames, adds, deletes, and
 * shares (export/import) profiles.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="settings">
      <section>
        <h2>Profiles</h2>
        <p class="muted">A profile is a saved org + team + date range. Switch from the header.</p>
        <table class="sprint-table">
          <thead>
            <tr><th>Name</th><th>Org</th><th></th><th></th></tr>
          </thead>
          <tbody>
            @for (p of store.profiles(); track p.id) {
              <tr>
                <td>
                  {{ p.name }}
                  @if (p.id === store.activeProfile()?.id) { <span class="draft-tag">active</span> }
                </td>
                <td>{{ p.org || '—' }}</td>
                <td>
                  @if (p.id !== store.activeProfile()?.id) {
                    <a href="#" (click)="switch($event, p.id)">use</a>
                  }
                </td>
                <td>
                  <a href="#" (click)="rename($event, p.id, p.name)">rename</a>
                  @if (store.profiles().length > 1) {
                    · <a href="#" (click)="remove($event, p.id)">delete</a>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        <div class="add-row">
          <input placeholder="New profile name" [value]="newProfile()" (input)="newProfile.set($any($event.target).value)" (keydown.enter)="addProfile()" />
          <button (click)="addProfile()">Add profile</button>
          <span class="spacer"></span>
          <button (click)="store.exportProfiles()">Export…</button>
          <button (click)="store.importProfiles()">Import…</button>
        </div>
      </section>

      <section>
        <h2>Active profile — {{ store.activeProfile()?.name }}</h2>
        <label class="field">
          GitHub organization
          <input [value]="store.activeProfile()?.org ?? ''" (change)="store.patchProfile({ org: $any($event.target).value.trim() })" />
        </label>
        <p class="muted">
          Team members — PRs by these logins show on the board. Leave empty to see the whole org.
        </p>
        <ul class="tag-list">
          @for (login of store.activeProfile()?.authors ?? []; track login) {
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
        <label class="field">
          Flag open PRs as stale after (days, 0 = off)
          <input
            type="number"
            min="0"
            [value]="store.activeProfile()?.staleDays ?? 5"
            (change)="store.patchProfile({ staleDays: +$any($event.target).value })"
          />
        </label>
      </section>

      <section>
        <h2>GitHub</h2>
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
        <label class="field">
          OAuth App client ID (optional — enables "Sign in with GitHub")
          <input
            placeholder="Ov23… / Iv1.…"
            [value]="store.config()?.oauthClientId ?? ''"
            (change)="store.patchConfig({ oauthClientId: $any($event.target).value.trim() })"
          />
        </label>
      </section>

      <section>
        <h2>App</h2>
        <label class="field">
          Auto-refresh every (minutes, 0 = off)
          <input
            type="number"
            min="0"
            [value]="store.config()?.autoRefreshMinutes ?? 5"
            (change)="store.patchConfig({ autoRefreshMinutes: +$any($event.target).value })"
          />
        </label>
        <label class="check">
          <input
            type="checkbox"
            [checked]="store.config()?.notifications ?? true"
            (change)="store.patchConfig({ notifications: $any($event.target).checked })"
          />
          Notify me when a PR lands in my review queue
        </label>
        <label class="check">
          <input
            type="checkbox"
            [checked]="store.config()?.closeToTray ?? true"
            (change)="store.patchConfig({ closeToTray: $any($event.target).checked })"
          />
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

  switch(e: Event, id: string): void {
    e.preventDefault();
    void this.store.switchProfile(id);
  }

  rename(e: Event, id: string, current: string): void {
    e.preventDefault();
    const name = window.prompt('Rename profile', current);
    if (name) this.store.renameProfile(id, name);
  }

  remove(e: Event, id: string): void {
    e.preventDefault();
    void this.store.deleteProfile(id);
  }

  disconnect(e: Event): void {
    e.preventDefault();
    void this.store.clearToken();
  }
}
