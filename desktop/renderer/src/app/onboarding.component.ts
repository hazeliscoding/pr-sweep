import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BoardStore } from './board.store';
import { IconComponent } from './ui/icon.component';

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
  imports: [IconComponent],
  template: `
    @if (store.needsToken()) {
      <div class="q-scrim">
        <div class="q-modal" role="dialog" aria-modal="true" aria-labelledby="onboardTitle">
          <header class="q-modal__head">
            <h2 id="onboardTitle" class="q-modal__title">Connect GitHub</h2>
            <p class="q-modal__desc">
              PR Sweep reads your organization's pull requests. Your credentials are stored encrypted on
              this machine and never leave it.
            </p>
          </header>

          <div class="q-field">
            <label class="q-field__label" for="onboard-org">GitHub organization</label>
            <input
              id="onboard-org"
              class="q-input q-input--mono"
              placeholder="your-github-org"
              [value]="org() || store.activeProfile()?.org || ''"
              (input)="org.set($any($event.target).value)"
            />
          </div>

          @if (oauthAvailable()) {
            @if (userCode(); as code) {
              <div class="device-code">
                <p>
                  Enter this code at <a href="#" (click)="openVerify($event)">github.com/login/device</a>. It should
                  have opened in your browser.
                </p>
                <div class="device-code__code">{{ code }}</div>
                <p class="q-field__hint">Waiting for you to authorize…</p>
              </div>
            } @else {
              <button
                class="q-btn q-btn--primary q-btn--block"
                [disabled]="verifying() || (!org().trim() && !store.activeProfile()?.org)"
                (click)="signIn()"
              >
                <q-icon name="log-in" />
                {{ verifying() ? 'Starting…' : 'Sign in with GitHub' }}
              </button>
            }
            <p class="q-modal__alt">
              or <a href="#" (click)="showToken($event)">use a personal access token</a>
            </p>
          }

          @if (!oauthAvailable() || tokenMode()) {
            <ol class="token-steps">
              <li>
                Open <a href="#" (click)="openTokenPage($event)">github.com/settings/tokens</a> and choose
                Tokens (classic).
              </li>
              <li>Generate a token with the <code>repo</code> and <code>read:org</code> scopes.</li>
              <li>If the org uses SAML SSO, choose Configure SSO next to the token and authorize the org.</li>
            </ol>
            <div class="inline-row">
              <input
                class="q-input q-input--mono token-input"
                type="password"
                placeholder="ghp_…"
                aria-label="Personal access token"
                [value]="token()"
                (input)="token.set($any($event.target).value)"
                (keydown.enter)="saveToken()"
              />
              <button class="q-btn q-btn--primary" [disabled]="saving() || !tokenReady()" (click)="saveToken()">
                <q-icon name="key-round" />
                {{ saving() ? 'Checking…' : 'Connect' }}
              </button>
            </div>
          }

          @if (error() ?? store.auth()?.error; as err) {
            <p class="q-inline-error" role="alert">
              <q-icon name="circle-alert" />
              {{ err }}
            </p>
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
