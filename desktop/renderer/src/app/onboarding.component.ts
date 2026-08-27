import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BoardStore } from './board.store';

/**
 * First-run overlay: shown until an org is configured and a GitHub token is
 * stored and fully validates (including that it can actually see the org).
 * Offers device-flow sign-in ("Sign in with GitHub") when an OAuth App is
 * configured, with a personal-access-token path as the fallback. Nothing here
 * leaves the machine — the main process stores the token encrypted.
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
            The board needs your GitHub organization and permission to read its pull requests.
            Credentials are stored encrypted on this machine and never leave it.
          </p>

          <div class="field">
            GitHub organization
            <input
              placeholder="your-github-org"
              [value]="org() || store.activeProfile()?.org || ''"
              (input)="org.set($any($event.target).value)"
            />
          </div>

          @if (oauthAvailable()) {
            @if (userCode(); as code) {
              <div class="device-code">
                <p>Enter this code at <a href="#" (click)="openVerify($event)">github.com/login/device</a> (it should have opened):</p>
                <div class="code">{{ code }}</div>
                <p class="muted">Waiting for you to authorize…</p>
              </div>
            } @else {
              <button class="btn-primary btn-block" [disabled]="verifying() || !org().trim() && !store.activeProfile()?.org" (click)="signIn()">
                {{ verifying() ? 'Starting…' : 'Sign in with GitHub' }}
              </button>
            }
            <p class="muted alt">
              or <a href="#" (click)="showToken($event)">use a personal access token</a>
            </p>
          }

          @if (!oauthAvailable() || tokenMode()) {
            <ol>
              <li>
                Open
                <a href="#" (click)="openTokenPage($event)">github.com/settings/tokens</a>
                (Personal access tokens → Tokens classic).
              </li>
              <li>Generate a token with the <code>repo</code> and <code>read:org</code> scopes.</li>
              <li>If the org uses SAML SSO: "Configure SSO" next to the token → authorize the org.</li>
            </ol>
            <div class="token-row">
              <input
                type="password"
                placeholder="ghp_…"
                [value]="token()"
                (input)="token.set($any($event.target).value)"
                (keydown.enter)="saveToken()"
              />
              <button class="btn-primary" [disabled]="saving() || !tokenReady()" (click)="saveToken()">
                {{ saving() ? 'Checking…' : 'Connect' }}
              </button>
            </div>
          }

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
  readonly verifying = signal(false);
  readonly error = signal<string | null>(null);
  readonly oauthAvailable = signal(false);
  readonly userCode = signal<string | null>(null);
  private verificationUri = 'https://github.com/login/device';
  /** True once the user chooses the token path (when OAuth is also available). */
  readonly tokenMode = signal(false);

  constructor() {
    void window.api.oauthAvailable().then((v) => this.oauthAvailable.set(v));
    window.api.onOAuthCode((info) => {
      this.userCode.set(info.userCode);
      this.verificationUri = info.verificationUri;
    });
  }

  private hasOrg(): boolean {
    return !!(this.org().trim() || this.store.activeProfile()?.org);
  }
  tokenReady(): boolean {
    return !!this.token().trim() && this.hasOrg();
  }

  private async persistOrg(): Promise<void> {
    const org = this.org().trim();
    if (org && org !== this.store.activeProfile()?.org) await this.store.setOrg(org);
  }

  async signIn(): Promise<void> {
    if (this.verifying() || !this.hasOrg()) return;
    this.verifying.set(true);
    this.error.set(null);
    try {
      await this.persistOrg();
      const status = await this.store.startOAuth();
      if (!status.login || status.error) this.error.set(status.error ?? 'Sign-in failed.');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.verifying.set(false);
      this.userCode.set(null);
    }
  }

  async saveToken(): Promise<void> {
    if (this.saving() || !this.tokenReady()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.persistOrg();
      const status = await this.store.saveToken(this.token().trim());
      if (!status.login || status.error) this.error.set(status.error ?? 'GitHub rejected that token.');
      else this.token.set('');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  showToken(e: Event): void {
    e.preventDefault();
    this.tokenMode.set(true);
  }
  openTokenPage(e: Event): void {
    e.preventDefault();
    void window.api.openExternal('https://github.com/settings/tokens');
  }
  openVerify(e: Event): void {
    e.preventDefault();
    void window.api.openExternal(this.verificationUri);
  }
}
