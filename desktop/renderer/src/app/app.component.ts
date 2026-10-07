import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BoardStore } from './board.store';
import { OnboardingComponent } from './onboarding.component';
import { PeriodPickerComponent } from './period-picker.component';
import { FreshnessComponent } from './ui/freshness.component';
import { IconComponent } from './ui/icon.component';

type Theme = 'light' | 'dark';
const THEME_KEY = 'prsweep-theme';

/**
 * Root shell: Quorum's top bar. Left, what this page is and the Board/Settings
 * tabs; right, how fresh the data is, which period it covers, Refresh and the
 * theme. Everything binds to the shared BoardStore, so the controls work from
 * any page.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, OnboardingComponent, PeriodPickerComponent, FreshnessComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app">
      <header class="topbar">
        <h1 class="topbar__title">{{ pageTitle() }}</h1>
        <nav class="q-tabs" aria-label="Pages">
          <a class="q-tab" routerLink="/board" routerLinkActive="active" ariaCurrentWhenActive="page">Board</a>
          <a class="q-tab" routerLink="/settings" routerLinkActive="active" ariaCurrentWhenActive="page">Settings</a>
        </nav>
        @if (store.profiles().length > 1) {
          <label class="topbar__profile">
            <span class="q-label">Profile</span>
            <select
              class="q-input"
              [disabled]="store.loading()"
              (change)="store.switchProfile($any($event.target).value)"
            >
              @for (p of store.profiles(); track p.id) {
                <option [value]="p.id" [selected]="p.id === store.activeProfile()?.id">{{ p.name }}</option>
              }
            </select>
          </label>
        }
        <span class="spacer"></span>
        @if (store.updateState(); as update) {
          @if (update.status === 'available') {
            <button
              class="q-btn q-btn--sm"
              title="v{{ update.version }} is out. This portable copy doesn't update itself: download the new one from GitHub."
              (click)="store.openUrl(update.url!)"
            >
              <q-icon name="download" [size]="12" />
              Download v{{ update.version }}
            </button>
          } @else if (update.status === 'downloading') {
            <span class="q-badge q-badge--info" title="A new version is downloading in the background">
              <q-icon name="download" [size]="12" />
              Downloading v{{ update.version }} · {{ update.percent }}%
            </span>
          } @else {
            <button
              class="q-btn q-btn--primary q-btn--sm"
              title="v{{ update.version }} is downloaded. Restart to apply it."
              (click)="store.installUpdate()"
            >
              <q-icon name="refresh-cw" [size]="12" />
              Restart to update
            </button>
          }
        }
        @if (store.result() || store.loading()) {
          <q-freshness [state]="store.freshness()" [age]="ageLabel()" [title]="fetchedAtTitle()" />
        }
        <app-period-picker />
        <button class="q-btn q-btn--primary" [disabled]="store.loading()" (click)="store.refresh()">
          <q-icon name="refresh-cw" />
          Refresh
        </button>
        <button
          class="q-btn q-btn--ghost q-btn--icon"
          [attr.aria-label]="'Switch to ' + otherTheme() + ' theme'"
          [title]="'Switch to ' + otherTheme() + ' theme'"
          (click)="toggleTheme()"
        >
          <q-icon [name]="otherTheme() === 'dark' ? 'moon' : 'sun'" />
        </button>
        @if (store.loading()) {
          <span class="loadbar" aria-hidden="true"></span>
        }
      </header>

      @if (store.error(); as err) {
        <div class="q-banner q-banner--critical" role="alert">
          <q-icon name="circle-alert" [size]="16" />
          <div>
            <p class="q-banner__title">Couldn't refresh</p>
            <p class="q-banner__desc">{{ err }}</p>
            @if (ageLabel(); as age) {
              <p class="q-banner__meta">Showing data from {{ age }}.</p>
            }
          </div>
        </div>
      }

      <main class="main">
        <router-outlet />
      </main>
      <app-onboarding />
    </div>
  `,
})
export class AppComponent {
  readonly store = inject(BoardStore);

  private readonly url = signal('');
  readonly theme = signal<Theme>(initialTheme());
  readonly otherTheme = computed<Theme>(() => (this.theme() === 'light' ? 'dark' : 'light'));

  readonly pageTitle = computed(() => {
    if (this.url().includes('settings')) return 'Settings';
    // Prefix the active profile's name only when there's more than one.
    const profiles = this.store.profiles();
    return profiles.length > 1 ? `${this.store.activeProfile()?.name} · Pull requests` : 'Pull requests';
  });

  constructor() {
    void this.store.init();
    const router = inject(Router);
    this.url.set(router.url);
    router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects);
    });
    effect(() => {
      document.documentElement.dataset['theme'] = this.theme();
      const period = this.store.period()?.label;
      document.title = period && !this.url().includes('settings') ? `${this.pageTitle()} · ${period}` : this.pageTitle();
      localStorage.setItem(THEME_KEY, this.theme());
    });
  }

  toggleTheme(): void {
    this.theme.set(this.otherTheme());
  }

  /** "2m ago" since the last successful sweep; null before the first. */
  ageLabel(): string | null {
    const min = this.store.fetchedAgeMin();
    if (min === null) return null;
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }

  fetchedAtTitle(): string | null {
    const ts = this.store.result()?.fetchedAt;
    return ts ? `Last swept ${new Date(ts).toLocaleString()}` : null;
  }
}

/** Stored choice wins; first run follows the OS. */
function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
