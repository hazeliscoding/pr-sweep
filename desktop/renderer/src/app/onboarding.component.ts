import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BoardStore } from './board.store';

/**
 * First-run overlay: shown until an org is configured and a GitHub token is
 * stored and fully validates (including that it can actually see the org).
 * The token never leaves the machine — the main process stores it encrypted.
 */
@Component({
  selector: 'app-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.needsToken()) {
      <div class="modal-overlay">
        <div class="modal">
          <h2>Connect GitHub</h2>
          <p>
            The board needs your GitHub organization and a token that can read its pull requests.
            The token is stored encrypted on this machine and never leaves it.
          </p>
          <ol>
            <li>
              Open
              <a href="#" (click)="openTokenPage($event)">github.com/settings/tokens</a>
              (Personal access tokens → Tokens classic).
            </li>
            <li>Generate a new token with the <code>repo</code> and <code>read:org</code> scopes.</li>
            <li>If the org uses SAML SSO: "Configure SSO" next to the token → authorize the org.</li>
          </ol>
          <div class="field">
            GitHub organization
            <input
              placeholder="your-github-org"
              [value]="org() || store.config()?.org || ''"
              (input)="org.set($any($event.target).value)"
            />
          </div>
          <div class="token-row">
            <input
              type="password"
              placeholder="ghp_…"
              [value]="token()"
              (input)="token.set($any($event.target).value)"
              (keydown.enter)="save()"
            />
            <button class="btn-primary" [disabled]="saving() || !ready()" (click)="save()">
              {{ saving() ? 'Checking…' : 'Connect' }}
            </button>
          </div>
          @if (error() ?? store.auth()?.error; as err) {
            <p class="status error">{{ err }}</p>
          }
        </div>
      </div>
    }
  `,
})
export class OnboardingComponent {
  readonly store = inject(BoardStore);
  readonly org = signal('');
  readonly token = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  ready(): boolean {
    return !!this.token().trim() && !!(this.org().trim() || this.store.config()?.org);
  }

  openTokenPage(e: Event): void {
    e.preventDefault();
    void window.api.openExternal('https://github.com/settings/tokens');
  }

  async save(): Promise<void> {
    if (this.saving() || !this.ready()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const org = this.org().trim();
      if (org && org !== this.store.config()?.org) await this.store.setOrg(org);
      const status = await this.store.saveToken(this.token().trim());
      if (!status.login || status.error) {
        this.error.set(status.error ?? 'GitHub rejected that token.');
      } else {
        this.token.set('');
      }
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }
}
